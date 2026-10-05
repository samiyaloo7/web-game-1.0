/**
 * GameAudio — a procedural Web Audio engine for Neon Courier.
 *
 * ## Why Web Audio and not Phaser's sound system
 *
 * There are no audio files in this project: every sound here is synthesised from
 * oscillators and a single noise buffer, so there is nothing to load, decode or
 * keep in memory. Owning the graph directly also means one AudioContext, one set
 * of gain nodes, and one place that has to obey the browser's autoplay policy —
 * Phaser's own audio manager is disabled in `config.ts` for exactly that reason.
 *
 * ## Autoplay policy
 *
 * A context is created lazily and starts `suspended`, like every browser will make
 * it. Nothing is scheduled until React reports a real user gesture
 * (`cmd:unlock-audio`); until then `play()` is a silent no-op rather than a queue
 * that dumps a second of sound on the first click.
 *
 * ## Lifecycle
 *
 * One instance per scene boot. `destroy()` is idempotent and is the *only* thing
 * that closes the context: it stops the music scheduler, stops every scheduled
 * source, disconnects the graph and closes the AudioContext, so unmounting the
 * game releases the audio device instead of leaving a context (and a timer)
 * behind.
 */

import {
  channelGain,
  readAudioSettings,
  sanitizeAudioSettings,
  type AudioSettings,
  type AudioStorage,
} from './AudioSettings';

/**
 * Every one-shot the game can ask for. Names describe the *gameplay moment*, not
 * the timbre — the scene says "pickup", never "beep at 660 Hz".
 */
export type SfxName =
  | 'pickup'
  | 'deliver'
  | 'damage'
  | 'explode'
  | 'ui'
  | 'missionComplete'
  | 'missionFailed'
  | 'rankUp'
  | 'gameOver';

/** What the HUD needs to know. Mirrors `audio:state-changed` on the EventBus. */
export interface AudioEngineState {
  /** True once a user gesture has let the AudioContext start running. */
  unlocked: boolean;
  musicPlaying: boolean;
  muted: boolean;
}

export interface GameAudioOptions {
  /** Explicit settings win over storage, storage over the defaults. */
  settings?: Partial<AudioSettings>;
  /** Where persisted settings are read from. `null` (server, tests) means defaults. */
  storage?: AudioStorage | null;
  /** Injected context for tests. Omitted → the browser's AudioContext, lazily built. */
  context?: AudioContextLike | null;
  /** Called on unlock / mute / music start-stop so the scene can mirror it outward. */
  onStateChange?: (state: AudioEngineState) => void;
}


/**
 * Structural slices of the Web Audio API.
 *
 * The real `AudioContext` satisfies these, and so does the small fake the unit
 * tests use — which is what lets scheduling, voice budgeting and teardown be
 * tested without a browser or an audio device.
 */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike): AudioNodeLike;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  start(when?: number): unknown;
  stop(when?: number): unknown;
  onended: (() => void) | null;
}

export interface BufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  readonly playbackRate: AudioParamLike;
  start(when?: number, offset?: number, duration?: number): unknown;
  stop(when?: number): unknown;
  onended: (() => void) | null;
}

export interface FilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: AudioContextState;
  readonly destination: AudioNodeLike;
  readonly sampleRate: number;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createBiquadFilter(): FilterNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

/** How far ahead the music scheduler looks, in seconds of AudioContext time. */
const SCHEDULER_LOOKAHEAD_S = 0.15;
/** How often it wakes up to look that far ahead, in wall-clock milliseconds. */
const SCHEDULER_INTERVAL_MS = 40;
/** Simultaneous one-shot *sources* allowed. Past this, new SFX are dropped rather
 * than stacked — an explosion already spans three sources, so the budget counts
 * sources on purpose: that is what bounds graph size, and so memory.
 *
 * Exported so the voice-budget test can assert the real number rather than a
 * copy of it that would drift.
 */
export const MAX_SFX_VOICES = 24;
/** Music keeps a low pulse while the simulation is suspended instead of cutting out. */
const MUSIC_DUCK = 0.25;
/** 100 BPM in eighth notes — a driving synthwave pulse without being frantic. */
const STEP_SECONDS = 60 / 100 / 2;
const STEPS_PER_BAR = 8;

/** Roots and triads of the loop: Am – F – C – G, the classic neon-drive progression. */
const PROGRESSION: ReadonlyArray<{ root: number; chord: readonly [number, number, number] }> = [
  { root: 45, chord: [57, 60, 64] },
  { root: 41, chord: [53, 57, 60] },
  { root: 36, chord: [55, 60, 64] },
  { root: 43, chord: [55, 59, 62] },
];

const TOTAL_STEPS = PROGRESSION.length * STEPS_PER_BAR;

/** MIDI note → Hz (A4 = 440). */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** The browser's AudioContext constructor, or `undefined` where audio is unavailable. */
function resolveContextCtor(): (new () => AudioContextLike) | undefined {
  const scope = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return ctor as (new () => AudioContextLike) | undefined;
}

/** One second of white noise, built once per context and reused by every rattle. */
function buildNoiseBuffer(ctx: AudioContextLike): AudioBufferLike {
  const length = Math.floor(ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    channel[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** Specification for a single oscillator voice. Times are absolute AudioContext time. */
interface BlipSpec {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  /** Peak level *relative to the SFX bus*, which already carries the volume slider. */
  gain: number;
  at?: number;
  filterHz?: number;
}

/** Specification for one pass of the noise buffer through a shaped filter. */
interface NoiseSpec {
  duration: number;
  gain: number;
  filter: BiquadFilterType;
  from: number;
  to: number;
  at?: number;
}

/** A scheduled note in the ambient score. */
interface MusicBlipSpec {
  type: OscillatorType;
  freq: number;
  duration: number;
  gain: number;
  at: number;
  filterHz?: number;
  /** Slow attack for pads; short blips leave this at its 10ms default. */
  attack?: number;
  detune?: number;
}



export class GameAudio {
  private settings: AudioSettings;
  private readonly onStateChange?: GameAudioOptions['onStateChange'];
  /** Test-supplied context; `null` in the browser, where one is built lazily. */
  private readonly injectedContext: AudioContextLike | null;

  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private musicGain: GainNodeLike | null = null;
  private sfxGain: GainNodeLike | null = null;
  /** One second of white noise, shared by every noise-based voice. */
  private noiseBuffer: AudioBufferLike | null = null;

  private unlocked = false;
  private paused = false;
  private disposed = false;

  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;

  private readonly sfxVoices = new Set<OscillatorNodeLike | BufferSourceNodeLike>();
  private readonly musicVoices = new Set<OscillatorNodeLike | BufferSourceNodeLike>();

  constructor(options: GameAudioOptions = {}) {
    this.onStateChange = options.onStateChange;
    this.injectedContext = options.context ?? null;
    // `sanitizeAudioSettings` fills anything missing, so a partial `settings` object
    // (or a corrupt stored row) lands on valid defaults, field by field.
    this.settings = sanitizeAudioSettings(options.settings ?? readAudioSettings(options.storage));
  }

  /** Snapshot for the HUD. Cheap and always in range, so it is safe to emit. */
  public getState(): AudioEngineState {
    return {
      unlocked: this.unlocked,
      musicPlaying: this.musicTimer !== null,
      muted: this.settings.muted,
    };
  }

  private notify(): void {
    this.onStateChange?.(this.getState());
  }

  /**
   * Builds the graph — `master → (music | sfx) → destination`.
   *
   * Deliberately lazy: merely booting the game must not create an AudioContext the
   * browser is going to warn about. The first call comes from `unlock()`, i.e. from
   * inside a real user gesture.
   */
  private ensureContext(): AudioContextLike | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;

    let ctx = this.injectedContext;
    if (!ctx) {
      const Ctor = resolveContextCtor();
      if (!Ctor) return null;
      try {
        ctx = new Ctor();
      } catch {
        return null;
      }
    }

    const master = ctx.createGain();
    const music = ctx.createGain();
    const sfx = ctx.createGain();

    // Master is the single cut point; the channels carry the user's two sliders.
    master.gain.value = 1;
    music.gain.value = channelGain(this.settings, 'music');
    sfx.gain.value = channelGain(this.settings, 'sfx');

    music.connect(master);
    sfx.connect(master);
    master.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.musicGain = music;
    this.sfxGain = sfx;
    this.noiseBuffer = buildNoiseBuffer(ctx);

    return ctx;
  }


  /**
   * Attempts to start the graph, from a real user gesture.
   *
   * Returns `true` only if audio is running *now*. A policy-blocked context keeps
   * `unlocked === false` so the HUD can show its "click to enable" hint instead of
   * the player silently wondering why the game has no sound.
   */
  public unlock(): boolean {
    if (this.disposed) return false;
    const ctx = this.ensureContext();
    if (!ctx) return false;

    if (ctx.state === 'running') {
      if (!this.unlocked) this.markUnlocked();
      return true;
    }

    void ctx
      .resume()
      .then(() => {
        // Re-check: the scene may have shut down while the promise was in flight.
        if (!this.disposed && !this.unlocked) this.markUnlocked();
      })
      .catch(() => {
        // Still refused (gesture requirement, or no output device). Stay silent —
        // the hint stays up and the next gesture simply tries again.
      });

    return this.unlocked;
  }

  private markUnlocked(): void {
    this.unlocked = true;
    this.startMusic();
    this.notify();
  }

  /**
   * Applies new settings: gains are rewritten in place, and the score starts or
   * stops to match the mute. Per-channel levels survive a mute, so unmuting lands
   * exactly where the sliders were left.
   */
  public setSettings(partial: Partial<AudioSettings>): void {
    if (this.disposed) return;
    this.settings = sanitizeAudioSettings({ ...this.settings, ...partial });
    this.applyGains();

    if (this.settings.muted) {
      this.stopMusic();
    } else {
      this.startMusic();
    }

    this.notify();
  }

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /** Writes the current mix into the graph. A no-op until the context exists. */
  private applyGains(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.sfxGain) return;

    const now = ctx.currentTime;
    const musicLevel = this.settings.muted
      ? 0
      : channelGain(this.settings, 'music') * (this.paused ? MUSIC_DUCK : 1);
    const sfxLevel = channelGain(this.settings, 'sfx');

    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(musicLevel, now);
    this.sfxGain.gain.cancelScheduledValues(now);
    this.sfxGain.gain.setValueAtTime(sfxLevel, now);
  }

  /**
   * Ducks the score while the simulation is suspended.
   *
   * A duck rather than a `suspend()` on the context: suspending freezes
   * `currentTime`, which would leave the music scheduler spinning against a clock
   * that never advances, and it would also swallow the click on RESUME itself.
   */
  public setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    this.applyGains();
  }

  /**
   * Fires a one-shot. Returns `true` only when a voice was actually scheduled.
   *
   * Three gates, in order: disposed, muted, and the autoplay policy (`unlocked`).
   * Refusing early — instead of queueing — is what stops a blocked context from
   * dumping a backlog of sound on the first click the browser does allow.
   */
  public play(name: SfxName, options: { gain?: number; rate?: number } = {}): boolean {
    if (this.disposed || this.settings.muted || !this.unlocked) return false;
    if (this.sfxVoices.size >= MAX_SFX_VOICES) return false;

    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return false;

    const weight = clamp01(options.gain ?? 1);
    if (weight <= 0) return false;
    const rate = options.rate !== undefined && options.rate > 0 ? options.rate : 1;

    this.synth(name, weight, rate, ctx.currentTime);
    return true;
  }

  /**
   * Registers a scheduled source so it is stopped, disconnected and uncounted the
   * moment it finishes — the whole anti-leak story for one-shots lives here.
   */
  private scheduleSfx(
    source: OscillatorNodeLike | BufferSourceNodeLike,
    stopAt: number,
    nodes: AudioNodeLike[]
  ): void {
    this.sfxVoices.add(source);
    source.onended = () => {
      this.sfxVoices.delete(source);
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Already torn down with the context; nothing to release.
        }
      }
      try {
        source.disconnect();
      } catch {
        // Already torn down with the context; nothing to release.
      }
    };
    try {
      source.stop(stopAt);
    } catch {
      // Stop scheduled before start: not a valid pair, and never fatal.
    }
  }

  /** Oscillator voice with an exponential attack/decay envelope. */
  private blip(spec: BlipSpec): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx) return;

    const start = spec.at ?? ctx.currentTime;
    const end = start + spec.duration;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = spec.type;
    osc.frequency.setValueAtTime(Math.max(1, spec.from), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), end);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, spec.gain),
      start + Math.min(0.02, spec.duration / 4)
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);

    const nodes: AudioNodeLike[] = [gain];
    if (spec.filterHz !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(spec.filterHz, start);
      gain.connect(filter);
      nodes.push(filter);
      filter.connect(sfx);
    } else {
      gain.connect(sfx);
    }

    osc.start(start);
    this.scheduleSfx(osc, end + 0.03, nodes);
  }

  /** One pass of the shared noise buffer through a sweeping filter. */
  private noise(spec: NoiseSpec): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    const buffer = this.noiseBuffer;
    if (!ctx || !sfx || !buffer) return;

    const start = spec.at ?? ctx.currentTime;
    const end = start + spec.duration;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter;
    filter.frequency.setValueAtTime(Math.max(20, spec.from), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), end);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, spec.gain), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(sfx);

    source.start(start, 0, spec.duration);
    this.scheduleSfx(source, end + 0.03, [filter, gain]);
  }

  /**
   * The sound recipes. Each moment gets a shape of its own so the ears can tell
   * them apart at a glance: rising for acquisition, falling for loss, noisy for
   * impact, and a full arpeggio for the rare, good news.
   */
  private synth(name: SfxName, weight: number, rate: number, now: number): void {
    switch (name) {
      // Grabbed the crate: two rising blips, the second an octave-spaced echo.
      case 'pickup':
        this.blip({
          type: 'square',
          from: 660 * rate,
          to: 1174 * rate,
          duration: 0.14,
          gain: 0.32 * weight,
          at: now,
        });
        this.blip({
          type: 'triangle',
          from: 988 * rate,
          to: 1568 * rate,
          duration: 0.16,
          gain: 0.18 * weight,
          at: now + 0.05,
        });
        break;

      // Delivered: a clean C–E–G–C arpeggio plus the crate-latch rattle.
      case 'deliver': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, index) => {
          this.blip({
            type: 'square',
            from: freq * rate,
            to: freq * rate * 1.01,
            duration: 0.16,
            gain: 0.2 * weight,
            at: now + index * 0.055,
          });
        });
        this.noise({
          duration: 0.08,
          gain: 0.22 * weight,
          filter: 'highpass',
          from: 1800,
          to: 5200,
          at: now,
        });
        break;
      }

      // Hull hit: a downward saw through a closing filter, plus an impact rattle.
      case 'damage':
        this.blip({
          type: 'sawtooth',
          from: 240 * rate,
          to: 62,
          duration: 0.3,
          gain: 0.42 * weight,
          at: now,
          filterHz: 1400,
        });
        this.noise({
          duration: 0.14,
          gain: 0.28 * weight,
          filter: 'bandpass',
          from: 900,
          to: 240,
          at: now,
        });
        break;

      // Wreckage: filtered noise body, a sub drop underneath, and a bright top.
      case 'explode':
        this.noise({
          duration: 0.7,
          gain: 0.5 * weight,
          filter: 'lowpass',
          from: 1400,
          to: 120,
          at: now,
        });
        this.blip({
          type: 'sine',
          from: 150,
          to: 36,
          duration: 0.55,
          gain: 0.55 * weight,
          at: now,
        });
        this.noise({
          duration: 0.22,
          gain: 0.26 * weight,
          filter: 'highpass',
          from: 2200,
          to: 5600,
          at: now,
        });
        break;

      // Interface tick: short enough to be felt, quiet enough to never nag.
      case 'ui':
        this.blip({
          type: 'triangle',
          from: 740 * rate,
          to: 560 * rate,
          duration: 0.07,
          gain: 0.16 * weight,
          at: now,
        });
        break;

      // The rare good news: a wide, deliberate ascending run.
      case 'missionComplete': {
        const notes = [659.25, 830.61, 987.77, 1318.51, 1567.98];
        notes.forEach((freq, index) => {
          this.blip({
            type: 'square',
            from: freq,
            to: freq,
            duration: 0.2,
            gain: 0.18 * weight,
            at: now + index * 0.07,
            filterHz: 4000,
          });
        });
        break;
      }

      // Contract voided: two low, closing notes.
      case 'missionFailed':
        this.blip({
          type: 'square',
          from: 196,
          to: 174,
          duration: 0.28,
          gain: 0.3 * weight,
          at: now,
          filterHz: 700,
        });
        this.blip({
          type: 'square',
          from: 146.8,
          to: 110,
          duration: 0.42,
          gain: 0.3 * weight,
          at: now + 0.24,
          filterHz: 600,
        });
        break;

      // Rank up: the delivery arpeggio's faster, brighter sibling.
      case 'rankUp': {
        const notes = [523.25, 698.46, 880, 1174.66];
        notes.forEach((freq, index) => {
          this.blip({
            type: 'triangle',
            from: freq,
            to: freq * 1.02,
            duration: 0.18,
            gain: 0.22 * weight,
            at: now + index * 0.06,
          });
        });
        break;
      }

      // Courier down: three descending notes, left to ring out.
      case 'gameOver': {
        const notes = [392, 311.13, 233.08];
        notes.forEach((freq, index) => {
          this.blip({
            type: 'sawtooth',
            from: freq,
            to: freq * 0.98,
            duration: 0.5,
            gain: 0.3 * weight,
            at: now + index * 0.24,
            filterHz: 900,
          });
        });
        break;
      }
    }
  }




  // ---------------------------------------------------------------------
  // Ambient score
  // ---------------------------------------------------------------------

  /**
   * Starts the lookahead scheduler.
   *
   * A timer wakes every 40ms and schedules any note that falls inside the next
   * 150ms of AudioContext time. Scheduling against `currentTime` rather than the
   * wall clock is what keeps the pulse steady — `setInterval` drift, background-tab
   * throttling and frame hitches all become somebody else's problem.
   */
  private startMusic(): void {
    if (this.disposed || this.musicTimer !== null) return;
    if (!this.unlocked || this.settings.muted) return;

    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    this.stepIndex = 0;
    this.nextStepTime = ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.tickMusic(), SCHEDULER_INTERVAL_MS);
    this.notify();
  }

  /**
   * Stops the scheduler and every source it scheduled.
   *
   * Called while the music bus is already at zero (mute) or while the context is
   * about to close (teardown), so cutting the voices short is inaudible — which is
   * exactly why there is no fade here to keep track of.
   */
  private stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }

    for (const source of this.musicVoices) {
      // Detach first: stopping fires `onended`, which mutates the set we are in.
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Never started, or already stopped with the context.
      }
      try {
        source.disconnect();
      } catch {
        // Already torn down with the context.
      }
    }
    this.musicVoices.clear();
  }

  private tickMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed || this.musicTimer === null) return;
    // A suspended context (tab hidden, or not yet unlocked) freezes `currentTime`,
    // so there is nothing new to schedule until it runs again.
    if (ctx.state !== 'running') return;

    while (this.nextStepTime < ctx.currentTime + SCHEDULER_LOOKAHEAD_S) {
      this.scheduleStep(this.stepIndex, this.nextStepTime);
      this.stepIndex = (this.stepIndex + 1) % TOTAL_STEPS;
      this.nextStepTime += STEP_SECONDS;

      // After a long stall (laptop lid, throttled tab) the cursor can fall far
      // behind real time; snap it forward instead of flooding the graph with every
      // note that was "missed".
      if (this.nextStepTime < ctx.currentTime) {
        this.nextStepTime = ctx.currentTime + 0.05;
      }
    }
  }

  /** Voices one eighth-note of the loop: bass, plus pad/arp/hat on their steps. */
  private scheduleStep(step: number, time: number): void {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const withinBar = step % STEPS_PER_BAR;
    const entry = PROGRESSION[bar];
    if (!entry) return;

    // Bass: the eighth-note pulse, accented on the downbeats.
    this.musicBlip({
      type: 'sawtooth',
      freq: midiToFreq(entry.root),
      duration: 0.22,
      gain: withinBar % 2 === 0 ? 0.26 : 0.15,
      at: time,
      filterHz: 520,
    });

    // Pad: one long chord per bar, entering on the downbeat with a slow attack.
    if (withinBar === 0) {
      for (const note of entry.chord) {
        this.musicBlip({
          type: 'triangle',
          freq: midiToFreq(note),
          duration: STEPS_PER_BAR * STEP_SECONDS,
          gain: 0.05,
          at: time,
          attack: 0.4,
          filterHz: 1800,
          detune: note % 5 === 0 ? 6 : -6,
        });
      }
    }

    // Arp: a bright counter-line on the offbeats of alternate bars.
    if (bar % 2 === 1 && withinBar % 2 === 1) {
      const chordNote = entry.chord[(step >> 1) % entry.chord.length];
      if (chordNote === undefined) return;
      const note = chordNote + 12;
      this.musicBlip({
        type: 'triangle',
        freq: midiToFreq(note),
        duration: 0.18,
        gain: 0.09,
        at: time,
        filterHz: 3200,
      });
    }

    // Hat: an offbeat noise tick — the half of the groove you feel first.
    if (withinBar % 2 === 1) {
      this.musicNoise(time, 0.05, 0.06);
    }
  }


  /** Oscillator note routed to the music bus and unregistered when it ends. */
  private musicBlip(spec: MusicBlipSpec): void {
    const ctx = this.ctx;
    const bus = this.musicGain;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const attack = spec.attack ?? 0.01;
    const end = spec.at + spec.duration;

    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, spec.at);
    if (spec.detune !== undefined) {
      osc.detune.setValueAtTime(spec.detune, spec.at);
    }

    gain.gain.setValueAtTime(0.0001, spec.at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, spec.gain), spec.at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);

    const nodes: AudioNodeLike[] = [gain];
    if (spec.filterHz !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(spec.filterHz, spec.at);
      gain.connect(filter);
      nodes.push(filter);
      filter.connect(bus);
    } else {
      gain.connect(bus);
    }

    osc.start(spec.at);
    this.scheduleMusic(osc, end + 0.05, nodes);
  }

  /** Hi-hat: a short slice of the shared noise buffer, high-passed. */
  private musicNoise(at: number, duration: number, gainValue: number): void {
    const ctx = this.ctx;
    const bus = this.musicGain;
    const buffer = this.noiseBuffer;
    if (!ctx || !bus || !buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6000, at);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    source.start(at, 0, duration + 0.02);
    this.scheduleMusic(source, at + duration + 0.03, [filter, gain]);
  }

  private scheduleMusic(
    source: OscillatorNodeLike | BufferSourceNodeLike,
    stopAt: number,
    nodes: AudioNodeLike[]
  ): void {
    this.musicVoices.add(source);
    source.onended = () => {
      this.musicVoices.delete(source);
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Already torn down with the context.
        }
      }
      try {
        source.disconnect();
      } catch {
        // Already torn down with the context.
      }
    };
    try {
      source.stop(stopAt);
    } catch {
      // Stop scheduled before start: never valid, never fatal.
    }
  }


  /**
   * Releases everything: the scheduler, every scheduled source, the graph, and the
   * AudioContext itself.
   *
   * Idempotent, because the scene calls it from SHUTDOWN and React may tear the
   * game down again a moment later. Closing the context is the part that matters —
   * browsers cap how many a page may hold, so a context left open by a destroyed
   * scene would eventually make the game silent for good.
   */
  public destroy(): void {
    if (this.disposed) return;

    this.stopMusic();

    for (const source of this.sfxVoices) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Never started, or already stopped with the context.
      }
      try {
        source.disconnect();
      } catch {
        // Already torn down with the context.
      }
    }
    this.sfxVoices.clear();

    const ctx = this.ctx;
    const master = this.master;
    const music = this.musicGain;
    const sfx = this.sfxGain;

    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.noiseBuffer = null;
    this.unlocked = false;
    this.disposed = true;

    safeDisconnect(master);
    safeDisconnect(music);
    safeDisconnect(sfx);

    if (ctx) {
      // `close()` rejects if the context is already closed; it is async, so this
      // needs a `.catch` rather than the `try/catch` that guards the sync call.
      void ctx.close().catch(() => {
        // Already closed — nothing to release.
      });
    }

    this.notify();
  }
}

function safeDisconnect(node: AudioNodeLike | null): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // Already torn down with the context.
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

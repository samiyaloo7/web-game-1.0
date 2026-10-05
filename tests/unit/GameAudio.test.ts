import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GameAudio,
  MAX_SFX_VOICES,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioEngineState,
  type AudioNodeLike,
  type AudioParamLike,
  type BufferSourceNodeLike,
  type FilterNodeLike,
  type GameAudioOptions,
  type GainNodeLike,
  type OscillatorNodeLike,
} from '@/game/audio/GameAudio';
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  encodeAudioSettings,
  type AudioStorage,
} from '@/game/audio/AudioSettings';

/* ------------------------------------------------------------------------- */
/* A minimal Web Audio double                                                */
/* ------------------------------------------------------------------------- */

/**
 * Implements just enough of the Web Audio API for `GameAudio` to drive it.
 *
 * Deliberately *dumb*: it records what was scheduled and never fires `onended`
 * on its own. That makes it the worst case for the engine's bookkeeping — voices
 * stay counted until `destroy()` explicitly releases them — which is exactly the
 * behaviour the leak tests want to observe.
 */
class FakeParam implements AudioParamLike {
  value = 0;
  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode implements AudioNodeLike {
  connections: AudioNodeLike[] = [];
  disconnected = false;

  connect(destination: AudioNodeLike | AudioParamLike): AudioNodeLike {
    if ('connect' in destination) this.connections.push(destination);
    return destination as AudioNodeLike;
  }

  disconnect(): void {
    this.connections = [];
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  start(): this {
    this.started = true;
    return this;
  }

  stop(): this {
    if (!this.started) throw new Error('InvalidStateError: stop() before start()');
    this.stopped = true;
    return this;
  }
}

class FakeBufferSource extends FakeNode implements BufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  readonly playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  start(): this {
    this.started = true;
    return this;
  }

  stop(): this {
    if (!this.started) throw new Error('InvalidStateError: stop() before start()');
    this.stopped = true;
    return this;
  }
}

class FakeFilter extends FakeNode implements FilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeBuffer implements AudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  private readonly data: Float32Array;

  constructor(length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  readonly destination = new FakeNode();
  sampleRate = 48000;

  closed = false;
  /** Creation order matters: master, music bus, sfx bus, then one per voice. */
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly buffers: FakeBufferSource[] = [];

  createGain(): GainNodeLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createOscillator(): OscillatorNodeLike {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }

  createBufferSource(): BufferSourceNodeLike {
    const source = new FakeBufferSource();
    this.buffers.push(source);
    return source;
  }

  createBiquadFilter(): FilterNodeLike {
    return new FakeFilter();
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    void channels;
    return new FakeBuffer(length, sampleRate);
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
  }

  /** The music bus, then the SFX bus — the order `ensureContext` builds them. */
  get musicGain(): FakeGain {
    const gain = this.gains[1];
    if (!gain) throw new Error('music bus has not been built yet');
    return gain;
  }

  get sfxGain(): FakeGain {
    const gain = this.gains[2];
    if (!gain) throw new Error('sfx bus has not been built yet');
    return gain;
  }
}

/** Lets the engine's `resume().then(...)` chain settle without wall-clock waiting. */
async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

/**
 * Every engine built through `makeAudio` is destroyed afterwards, so no test can
 * leave a `setInterval` (or an open context) behind for the next one — the same
 * discipline the scene itself applies on SHUTDOWN.
 */
const openEngines: GameAudio[] = [];

function makeAudio(
  ctx: AudioContextLike,
  options: Omit<GameAudioOptions, 'context'> = {}
): GameAudio {
  const audio = new GameAudio({ ...options, context: ctx });
  openEngines.push(audio);
  return audio;
}

afterEach(() => {
  while (openEngines.length > 0) {
    openEngines.pop()?.destroy();
  }
  vi.useRealTimers();
});

describe('GameAudio - autoplay policy', () => {
  it('builds nothing and sounds nothing until a gesture unlocks it', async () => {
    const ctx = new FakeAudioContext();
    const audio = makeAudio(ctx);

    expect(audio.play('pickup')).toBe(false);
    expect(audio.getState().unlocked).toBe(false);
    // Not even an AudioContext: a silent game must not hold an audio device.
    expect(ctx.gains.length).toBe(0);

    const runningImmediately = audio.unlock();
    expect(runningImmediately).toBe(false); // `resume()` is asynchronous

    await flushMicrotasks();
    expect(audio.getState().unlocked).toBe(true);
    expect(ctx.state).toBe('running');
    expect(audio.play('pickup')).toBe(true);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it('is silent while muted, whatever else is true', async () => {
    const ctx = new FakeAudioContext();
    const audio = makeAudio(ctx, { settings: { muted: true } });

    audio.unlock();
    await flushMicrotasks();

    expect(audio.getState().unlocked).toBe(true);
    expect(audio.play('explode')).toBe(false);
    expect(ctx.oscillators.length).toBe(0);
  });
});

describe('GameAudio - mix', () => {
  it('applies mute as a hard cut and keeps the levels underneath', async () => {
    const ctx = new FakeAudioContext();
    const audio = makeAudio(ctx, {
      settings: { muted: false, musicVolume: 0.6, sfxVolume: 0.9 },
    });

    audio.unlock();
    await flushMicrotasks();

    expect(ctx.musicGain.gain.value).toBeCloseTo(0.6);
    expect(ctx.sfxGain.gain.value).toBeCloseTo(0.9);

    audio.setSettings({ muted: true });
    expect(ctx.musicGain.gain.value).toBe(0);
    expect(ctx.sfxGain.gain.value).toBe(0);
    expect(audio.play('damage')).toBe(false);
    expect(audio.getState().musicPlaying).toBe(false);

    audio.setSettings({ muted: false });
    expect(ctx.musicGain.gain.value).toBeCloseTo(0.6);
    expect(ctx.sfxGain.gain.value).toBeCloseTo(0.9);
    expect(audio.play('damage')).toBe(true);
  });

  it('ducks the score while the simulation is suspended, leaving effects alone', async () => {
    const ctx = new FakeAudioContext();
    const audio = makeAudio(ctx, {
      settings: { muted: false, musicVolume: 0.8, sfxVolume: 0.9 },
    });

    audio.unlock();
    await flushMicrotasks();

    audio.setPaused(true);
    expect(ctx.musicGain.gain.value).toBeCloseTo(0.8 * 0.25);
    expect(ctx.sfxGain.gain.value).toBeCloseTo(0.9);

    audio.setPaused(false);
    expect(ctx.musicGain.gain.value).toBeCloseTo(0.8);
  });

  it('reads persisted preferences instead of the defaults', () => {
    const storage: AudioStorage = {
      getItem: (key) =>
        key === AUDIO_SETTINGS_STORAGE_KEY
          ? encodeAudioSettings({ muted: true, musicVolume: 0.2, sfxVolume: 0.7 })
          : null,
      setItem: () => undefined,
    };

    const audio = makeAudio(new FakeAudioContext(), { storage });

    expect(audio.getSettings()).toEqual({ muted: true, musicVolume: 0.2, sfxVolume: 0.7 });
  });
});

describe('GameAudio - voice budget', () => {
  it('drops new effects once the graph is full instead of stacking them', async () => {
    const ctx = new FakeAudioContext();
    const audio = makeAudio(ctx);

    audio.unlock();
    await flushMicrotasks();

    let played = 0;
    for (let i = 0; i < MAX_SFX_VOICES * 3; i++) {
      if (audio.play('ui')) played++;
    }

    expect(played).toBe(MAX_SFX_VOICES);
    expect(ctx.oscillators.length).toBe(MAX_SFX_VOICES);
  });
});

describe('GameAudio - ambient score', () => {
  it('schedules notes ahead of the clock and stops scheduling after destroy', async () => {
    vi.useFakeTimers();
    const ctx = new FakeAudioContext();
    const audio = makeAudio(ctx);

    audio.unlock();
    await flushMicrotasks();
    expect(audio.getState().musicPlaying).toBe(true);
    expect(ctx.oscillators.length).toBe(0); // nothing before the clock ticks

    // ~3 scheduler ticks, each looking 150ms of AudioContext time ahead.
    vi.advanceTimersByTime(120);
    expect(ctx.oscillators.length).toBeGreaterThan(0);

    const scheduled = ctx.oscillators.length;
    audio.destroy();

    expect(audio.getState()).toEqual({
      unlocked: false,
      musicPlaying: false,
      muted: false,
    });
    expect(ctx.closed).toBe(true);
    // Every source the score scheduled has been stopped — none left running.
    expect(ctx.oscillators.every((osc) => osc.stopped)).toBe(true);

    vi.advanceTimersByTime(2_000);
    expect(ctx.oscillators.length).toBe(scheduled);
  });
});

describe('GameAudio - teardown', () => {
  it('is idempotent and releases the context exactly once', async () => {
    const ctx = new FakeAudioContext();
    const audio = makeAudio(ctx);

    audio.unlock();
    await flushMicrotasks();
    expect(ctx.closed).toBe(false);

    audio.destroy();
    audio.destroy();
    audio.destroy();

    expect(ctx.closed).toBe(true);
    expect(audio.play('pickup')).toBe(false);
    expect(audio.unlock()).toBe(false);
  });

  it('reports engine state for the HUD', async () => {
    const states: AudioEngineState[] = [];
    const ctx = new FakeAudioContext();
    const audio = makeAudio(ctx, {
      onStateChange: (state) => {
        states.push(state);
      },
    });

    audio.unlock();
    await flushMicrotasks();
    expect(states.at(-1)).toMatchObject({ unlocked: true, musicPlaying: true, muted: false });

    audio.setSettings({ muted: true });
    expect(states.at(-1)).toMatchObject({ muted: true, musicPlaying: false });

    audio.destroy();
    expect(states.at(-1)).toMatchObject({ unlocked: false, musicPlaying: false });
  });
});


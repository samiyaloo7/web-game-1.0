/**
 * Audio settings — the pure half of the sound system.
 *
 * Nothing in this module touches Web Audio, Phaser or React. It exists so the rules
 * for "what the volumes actually are" live in one place that a unit test can drive
 * without a browser: sanitising whatever localStorage happened to contain, deciding
 * what a muted channel is worth, and serialising the result back out.
 *
 * `GameAudio` (the engine) and `useAudioSettings` (the React seam) both read and
 * write through here, so the HUD sliders and the audible result can never drift
 * apart — they are the same numbers.
 */

/** A single mix channel. Master volume is deliberately not a channel: it is derived. */
export type AudioChannel = 'music' | 'sfx';

/** User-facing audio state. Every field is always present and always in range. */
export interface AudioSettings {
  /** Cuts both channels at once. Per-channel volume is preserved underneath it. */
  muted: boolean;
  /** 0..1 ambient score level. */
  musicVolume: number;
  /** 0..1 sound-effects level. */
  sfxVolume: number;
}

/**
 * Settings used the first time the game is opened.
 *
 * Music sits slightly below SFX on purpose: the score is a continuous bed under
 * speech, game sounds and the player's own attention, while individual effects are
 * punctual and need to cut through.
 */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: false,
  musicVolume: 0.55,
  sfxVolume: 0.85,
};

/** localStorage key. Versioned so a future shape change can coexist with old rows. */
export const AUDIO_SETTINGS_STORAGE_KEY = 'neon-courier.audio.v1';

/**
 * The slice of `Storage` this module needs — declared structurally so tests can pass
 * a plain object and so a non-DOM environment never has to see `window`.
 */
export interface AudioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Clamps into 0..1, treating `NaN`/`Infinity`/junk as "leave it at the default". */
export function clampVolume(value: number, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Coerces an untrusted value (a stored JSON blob, a partially-filled form) into
 * settings that are safe to apply.
 *
 * Every field falls back independently: a row containing only `{ muted: true }`
 * keeps its default volumes rather than resetting the whole panel, and a corrupt
 * or hostile row degrades to the defaults instead of producing `NaN` gains in the
 * audio graph.
 */
export function sanitizeAudioSettings(input: unknown): AudioSettings {
  if (!isRecord(input)) return { ...DEFAULT_AUDIO_SETTINGS };

  return {
    muted: typeof input.muted === 'boolean' ? input.muted : DEFAULT_AUDIO_SETTINGS.muted,
    musicVolume:
      typeof input.musicVolume === 'number'
        ? clampVolume(input.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume)
        : DEFAULT_AUDIO_SETTINGS.musicVolume,
    sfxVolume:
      typeof input.sfxVolume === 'number'
        ? clampVolume(input.sfxVolume, DEFAULT_AUDIO_SETTINGS.sfxVolume)
        : DEFAULT_AUDIO_SETTINGS.sfxVolume,
  };
}

/** Serialises settings for storage. Always sanitises first, so what is written is valid. */
export function encodeAudioSettings(settings: Partial<AudioSettings>): string {
  return JSON.stringify(sanitizeAudioSettings({ ...DEFAULT_AUDIO_SETTINGS, ...settings }));
}

/** Parses a stored blob. Anything unreadable — including `null` — yields the defaults. */
export function decodeAudioSettings(raw: string | null | undefined): AudioSettings {
  if (typeof raw !== 'string' || raw.length === 0) return { ...DEFAULT_AUDIO_SETTINGS };

  try {
    return sanitizeAudioSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

/**
 * Reads persisted settings, or the defaults when there is no storage to read from.
 *
 * Passing `null` is the normal path on the server (there is no `window`) and in
 * tests; it is not an error, so this never throws for missing storage.
 */
export function readAudioSettings(storage: AudioStorage | null | undefined): AudioSettings {
  if (!storage) return { ...DEFAULT_AUDIO_SETTINGS };

  try {
    return decodeAudioSettings(storage.getItem(AUDIO_SETTINGS_STORAGE_KEY));
  } catch {
    // Storage can throw outright (privacy mode, disabled cookies). Preferences are
    // not worth breaking the game over.
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

/** Persists settings. Failures are swallowed — the session keeps its values either way. */
export function writeAudioSettings(
  settings: Partial<AudioSettings>,
  storage: AudioStorage | null | undefined
): void {
  if (!storage) return;

  try {
    storage.setItem(AUDIO_SETTINGS_STORAGE_KEY, encodeAudioSettings(settings));
  } catch {
    // Quota or privacy-mode failure: keep playing with the in-memory settings.
  }
}

/**
 * Final gain for a channel: what should actually be written into the audio graph.
 *
 * Muting returns exactly `0` rather than scaling the volume down, so a mute is a
 * hard cut even if a volume slider was left near the top — and unmuting restores
 * precisely the level the player had dialled in.
 */
export function channelGain(settings: AudioSettings, channel: AudioChannel): number {
  if (settings.muted) return 0;
  return clampVolume(channel === 'music' ? settings.musicVolume : settings.sfxVolume);
}

/**
 * `localStorage` if this environment has one, `null` otherwise.
 *
 * The game layer deliberately owns no DOM, so this is the single guarded access
 * point: the scene calls it while booting in a browser, and every non-DOM caller
 * (SSR, unit tests) simply gets `null` and falls back to the defaults.
 */
export function getBrowserStorage(): AudioStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}


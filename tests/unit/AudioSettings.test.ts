import { describe, expect, it } from 'vitest';
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  DEFAULT_AUDIO_SETTINGS,
  channelGain,
  clampVolume,
  decodeAudioSettings,
  encodeAudioSettings,
  getBrowserStorage,
  readAudioSettings,
  sanitizeAudioSettings,
  writeAudioSettings,
  type AudioStorage,
} from '@/game/audio/AudioSettings';

/** In-memory `Storage` stand-in; optionally hostile, to prove failures are survivable. */
function memoryStorage(
  initial: Record<string, string> = {},
  hooks: { throwOnSet?: boolean; throwOnGet?: boolean } = {}
): AudioStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      if (hooks.throwOnGet) throw new Error('SecurityError: denied');
      return data[key] ?? null;
    },
    setItem(key, value) {
      if (hooks.throwOnSet) throw new Error('QuotaExceededError');
      data[key] = value;
    },
  };
}
describe('clampVolume', () => {
  it('keeps values inside 0..1', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
    expect(clampVolume(-0.3)).toBe(0);
    expect(clampVolume(4)).toBe(1);
  });

  it('falls back for values a gain node cannot represent', () => {
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(Number.NaN, 0.7)).toBe(0.7);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampVolume('loud' as unknown as number)).toBe(0);
  });
});

describe('sanitizeAudioSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    expect(sanitizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeAudioSettings(undefined)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeAudioSettings('loud')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeAudioSettings(42)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('fills missing fields independently instead of resetting the whole panel', () => {
    const settings = sanitizeAudioSettings({ muted: true });

    expect(settings.muted).toBe(true);
    expect(settings.musicVolume).toBe(DEFAULT_AUDIO_SETTINGS.musicVolume);
    expect(settings.sfxVolume).toBe(DEFAULT_AUDIO_SETTINGS.sfxVolume);
  });

  it('clamps out-of-range volumes and discards wrong types', () => {
    const settings = sanitizeAudioSettings({
      musicVolume: 3,
      sfxVolume: -1,
      muted: 'yes',
    });

    expect(settings.musicVolume).toBe(1);
    expect(settings.sfxVolume).toBe(0);
    expect(settings.muted).toBe(DEFAULT_AUDIO_SETTINGS.muted);
  });
});

describe('encode / decode', () => {
  it('round-trips through JSON', () => {
    const original = { muted: true, musicVolume: 0.25, sfxVolume: 0.75 };
    expect(decodeAudioSettings(encodeAudioSettings(original))).toEqual(original);
  });

  it('sanitises on the way out, so what is stored is always valid', () => {
    const raw = encodeAudioSettings({ musicVolume: 9 });
    expect(decodeAudioSettings(raw).musicVolume).toBe(1);
  });

  it('degrades to defaults on corrupt, empty or absent input', () => {
    expect(decodeAudioSettings('{not json')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(decodeAudioSettings('')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(decodeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(decodeAudioSettings('[1,2,3]')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});

describe('read / write', () => {
  it('persists and reloads the preferences', () => {
    const storage = memoryStorage();
    const settings = { muted: false, musicVolume: 0.4, sfxVolume: 0.6 };

    writeAudioSettings(settings, storage);
    expect(storage.data[AUDIO_SETTINGS_STORAGE_KEY]).toBeDefined();
    expect(readAudioSettings(storage)).toEqual(settings);
  });

  it('uses the defaults when there is no storage at all', () => {
    // The server and the unit-test environment both have no `window`.
    expect(readAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(readAudioSettings(undefined)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('survives a storage that throws in either direction', () => {
    expect(readAudioSettings(memoryStorage({}, { throwOnGet: true }))).toEqual(
      DEFAULT_AUDIO_SETTINGS
    );
    expect(() =>
      writeAudioSettings({ muted: true }, memoryStorage({}, { throwOnSet: true }))
    ).not.toThrow();
  });
});

describe('channelGain', () => {
  const settings = { muted: false, musicVolume: 0.3, sfxVolume: 0.9 };

  it('passes each channel its own level', () => {
    expect(channelGain(settings, 'music')).toBeCloseTo(0.3);
    expect(channelGain(settings, 'sfx')).toBeCloseTo(0.9);
  });

  it('mutes to exactly zero without destroying the levels underneath', () => {
    const muted = { ...settings, muted: true };

    expect(channelGain(muted, 'music')).toBe(0);
    expect(channelGain(muted, 'sfx')).toBe(0);
    expect(channelGain(settings, 'music')).toBeCloseTo(0.3);
  });
});

describe('getBrowserStorage', () => {
  it('is null outside the browser', () => {
    // Vitest runs in the `node` environment: no `window`, so no storage.
    expect(getBrowserStorage()).toBeNull();
  });
});

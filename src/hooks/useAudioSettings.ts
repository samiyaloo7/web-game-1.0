'use client';

import { useEffect } from 'react';
import { EventBus, type GameToUiEvents } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';
import {
  getBrowserStorage,
  readAudioSettings,
  writeAudioSettings,
} from '@/game/audio/AudioSettings';

/**
 * useAudioSettings — the seam between the HUD's audio controls and `GameAudio`.
 *
 * Four jobs, each in its own effect so their lifecycles stay independent:
 *
 *  1. **Hydrate** — read the persisted preferences into the store on mount, so the
 *     sliders show the truth even though the engine read the same file earlier.
 *  2. **Push + persist** — every change goes into the scene over
 *     `cmd:set-audio-settings` *and* back into localStorage. The push reads
 *     `getState()` rather than the effect's captured value, because the hydrate
 *     effect above it may have just replaced the slice: capturing the stale copy
 *     would write the defaults over the player's saved volumes.
 *  3. **Unlock** — the browser will only start an AudioContext from inside a real
 *     gesture, so the first pointer/key event offers one to the engine. Until the
 *     engine confirms, the HUD keeps its "click to enable audio" hint.
 *  4. **Mirror** — `audio:state-changed` comes back with the engine's answer.
 *
 * Persistence lives here rather than in the store because the store is pure UI
 * state (the same split `useProgressionSync` draws for the career profile).
 */
export function useAudioSettings(): void {
  const settings = useGameStore((s) => s.audio);
  const setAudioSettings = useGameStore((s) => s.setAudioSettings);
  const setAudioUnlocked = useGameStore((s) => s.setAudioUnlocked);

  // 1. Hydrate once per mount. Non-DOM environments (SSR) simply get the defaults.
  useEffect(() => {
    setAudioSettings(readAudioSettings(getBrowserStorage()));
  }, [setAudioSettings]);

  // 2. Push into the engine and persist, on hydrate and on every edit.
  useEffect(() => {
    const current = useGameStore.getState().audio;
    EventBus.sendCommand('cmd:set-audio-settings', current);
    writeAudioSettings(current, getBrowserStorage());
  }, [settings]);

  // 3. First gesture → ask the engine to start. Capture phase so a HUD control
  //    that stops propagation cannot swallow the only unlock the player gets.
  useEffect(() => {
    const offerUnlock = () => {
      if (useGameStore.getState().audioUnlocked) return;
      EventBus.sendCommand('cmd:unlock-audio');
    };

    window.addEventListener('pointerdown', offerUnlock, { capture: true });
    window.addEventListener('keydown', offerUnlock, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', offerUnlock, { capture: true });
      window.removeEventListener('keydown', offerUnlock, { capture: true });
    };
  }, []);

  // 4. Mirror the engine's answer (and a full engine teardown) into the store.
  useEffect(() => {
    const handleState = (state: GameToUiEvents['audio:state-changed']) => {
      setAudioUnlocked(state.unlocked);
    };

    // A destroyed engine cannot be unlocked, even if a stale `true` was cached.
    const handleDestroyed = () => setAudioUnlocked(false);

    EventBus.onEvent('audio:state-changed', handleState);
    EventBus.onEvent('game:destroyed', handleDestroyed);

    return () => {
      EventBus.offEvent('audio:state-changed', handleState);
      EventBus.offEvent('game:destroyed', handleDestroyed);
    };
  }, [setAudioUnlocked]);
}

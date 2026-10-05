'use client';

import { EventBus } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';
import { OCCLUDED_PANEL_CLASS, usePanelOccluded } from '@/hooks/useHudOcclusion';
import { Volume2, VolumeX, Music2, AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AudioSettings } from '@/game/audio/AudioSettings';

/**
 * GameHudAudio — mute toggle, per-channel volume sliders, and the autoplay hint.
 *
 * Settings are pushed into the engine *synchronously* from the handlers (as well
 * as through the `useAudioSettings` effect) so the interaction is immediate: the
 * confirmation tick after unmuting must reach an engine that already has its new
 * gain, otherwise the first sound you hear after unmuting would be silence.
 */
export function GameHudAudio() {
  const audio = useGameStore((s) => s.audio);
  const unlocked = useGameStore((s) => s.audioUnlocked);
  const setAudioSettings = useGameStore((s) => s.setAudioSettings);

  const isOccluded = usePanelOccluded('hud-audio');

  /** Applies a change and ticks, in that order, so the tick is audible. */
  const apply = (next: AudioSettings, tick = false): void => {
    setAudioSettings(next);
    EventBus.sendCommand('cmd:set-audio-settings', next);
    if (tick) EventBus.sendCommand('cmd:play-sfx', { name: 'ui' });
  };

  const toggleMute = (): void => {
    apply({ ...audio, muted: !audio.muted }, true);
  };

  const setVolume = (field: 'musicVolume' | 'sfxVolume', percent: number): void => {
    const clamped = Math.max(0, Math.min(100, percent)) / 100;
    apply({ ...audio, [field]: clamped });
  };

  return (
    <div
      data-hud-panel="hud-audio"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 bg-cyber-dark/85 backdrop-blur-md border border-cyber-border rounded-lg px-3 py-2 font-mono shadow-lg transition-opacity duration-300',
        isOccluded && OCCLUDED_PANEL_CLASS
      )}
    >
      <button
        onClick={toggleMute}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-mono text-xs font-bold transition-all border shadow-lg cursor-pointer',
          audio.muted
            ? 'bg-cyber-surface text-neon-pink border-neon-pink/60'
            : 'bg-cyber-dark text-zinc-300 border-cyber-border hover:border-neon-cyan/60 hover:text-white'
        )}
        title={audio.muted ? 'Unmute all sound' : 'Mute all sound'}
        aria-pressed={audio.muted}
      >
        {audio.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        <span>{audio.muted ? 'UNMUTE' : 'MUTE'}</span>
      </button>

      <label className="flex items-center gap-1.5" title="Ambient score level">
        <Music2 className="w-3.5 h-3.5 text-neon-cyan shrink-0" />
        <span className="text-[10px] text-zinc-500">MUSIC</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(audio.musicVolume * 100)}
          onChange={(event) => setVolume('musicVolume', Number(event.target.value))}
          className="w-16 sm:w-20 accent-neon-cyan cursor-pointer"
          aria-label="Music volume"
        />
        <span className="text-[10px] text-zinc-500 w-6 text-right">
          {Math.round(audio.musicVolume * 100)}
        </span>
      </label>

      <label className="flex items-center gap-1.5" title="Sound effects level">
        <AudioLines className="w-3.5 h-3.5 text-neon-amber shrink-0" />
        <span className="text-[10px] text-zinc-500">SFX</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(audio.sfxVolume * 100)}
          onChange={(event) => setVolume('sfxVolume', Number(event.target.value))}
          className="w-16 sm:w-20 accent-neon-amber cursor-pointer"
          aria-label="Sound effects volume"
        />
        <span className="text-[10px] text-zinc-500 w-6 text-right">
          {Math.round(audio.sfxVolume * 100)}
        </span>
      </label>

      {/* Autoplay policy, made explicit: until a gesture starts the AudioContext
          the game really is silent, and saying so beats looking broken. */}
      {!unlocked && (
        <span className="flex items-center gap-1 text-[10px] text-neon-amber border border-neon-amber/40 bg-amber-950/30 px-2 py-0.5 rounded animate-pulse">
          <Volume2 className="w-3 h-3" />
          CLICK TO ENABLE AUDIO
        </span>
      )}
    </div>
  );
}

'use client';

import { EventBus } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';
import { useGameBridge } from '@/hooks/useGameBridge';
import { OCCLUDED_PANEL_CLASS, usePanelOccluded } from '@/hooks/useHudOcclusion';
import { Pause, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Interface tick for HUD buttons — silent while muted, so the mute is honoured. */
function playClick(): void {
  EventBus.sendCommand('cmd:play-sfx', { name: 'ui' });
}

/**
 * GameHudControls provides discrete command buttons (Pause, Resume, Reroll, New City)
 * that send commands back into Phaser via the EventBus bridge.
 */
export function GameHudControls() {
  const isPaused = useGameStore((s) => s.isPaused);
  const { togglePause, restartMission, regenerateCity } = useGameBridge();

  // Bottom-right of the top bar — the least likely occluder, but the drop pad area is
  // large enough to reach it on a narrow viewport.
  const isOccluded = usePanelOccluded('hud-controls');

  return (
    <div
      data-hud-panel="hud-controls"
      className={cn(
        'flex items-center gap-2 transition-opacity duration-300',
        isOccluded && OCCLUDED_PANEL_CLASS
      )}
    >
      {/* Pause / Resume Button */}
      <button
        onClick={() => {
          playClick();
          togglePause();
        }}
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 rounded-lg font-mono text-xs font-bold transition-all border shadow-lg cursor-pointer',
          isPaused
            ? 'bg-neon-cyan text-cyber-black border-neon-cyan neon-glow-cyan'
            : 'bg-cyber-dark/85 text-zinc-300 border-cyber-border hover:border-neon-cyan/60 hover:text-white'
        )}
        title={isPaused ? 'Resume Simulation' : 'Pause Simulation'}
      >
        {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
        <span>{isPaused ? 'RESUME' : 'PAUSE'}</span>
      </button>

      {/* Restart Mission Button */}
      <button
        onClick={() => {
          playClick();
          restartMission();
        }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-mono text-xs font-bold bg-cyber-dark/85 text-zinc-300 border border-cyber-border hover:border-neon-pink/60 hover:text-neon-pink transition-all shadow-lg cursor-pointer"
        title="Reroll / Restart Dispatch Assignment"
      >
        <RotateCcw className="w-4 h-4" />
        <span className="hidden sm:inline">REROLL</span>
      </button>

      {/* Regenerate City Button */}
      <button
        onClick={() => {
          playClick();
          regenerateCity();
        }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-mono text-xs font-bold bg-cyber-dark/85 text-zinc-300 border border-cyber-border hover:border-neon-cyan/60 hover:text-neon-cyan transition-all shadow-lg cursor-pointer"
        title="Generate a new procedural district (new seed)"
      >
        <RefreshCw className="w-4 h-4" />
        <span className="hidden sm:inline">NEW CITY</span>
      </button>
    </div>
  );
}

'use client';

import { useGameStore } from '@/stores/useGameStore';
import { useGameBridge } from '@/hooks/useGameBridge';
import { Pause, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * GameHudControls provides discrete command buttons (Pause, Resume, Reroll, New City)
 * that send commands back into Phaser via the EventBus bridge.
 */
export function GameHudControls() {
  const isPaused = useGameStore((s) => s.isPaused);
  const { togglePause, restartMission, regenerateCity } = useGameBridge();

  return (
    <div className="flex items-center gap-2">
      {/* Pause / Resume Button */}
      <button
        onClick={togglePause}
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
        onClick={restartMission}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-mono text-xs font-bold bg-cyber-dark/85 text-zinc-300 border border-cyber-border hover:border-neon-pink/60 hover:text-neon-pink transition-all shadow-lg cursor-pointer"
        title="Reroll / Restart Dispatch Assignment"
      >
        <RotateCcw className="w-4 h-4" />
        <span className="hidden sm:inline">REROLL</span>
      </button>

      {/* Regenerate City Button */}
      <button
        onClick={() => regenerateCity()}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-mono text-xs font-bold bg-cyber-dark/85 text-zinc-300 border border-cyber-border hover:border-neon-cyan/60 hover:text-neon-cyan transition-all shadow-lg cursor-pointer"
        title="Generate a new procedural district (new seed)"
      >
        <RefreshCw className="w-4 h-4" />
        <span className="hidden sm:inline">NEW CITY</span>
      </button>
    </div>
  );
}

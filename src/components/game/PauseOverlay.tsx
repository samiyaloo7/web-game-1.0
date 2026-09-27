'use client';

import { useGameStore } from '@/stores/useGameStore';
import { useGameBridge } from '@/hooks/useGameBridge';
import { Play } from 'lucide-react';

/**
 * PauseOverlay displays a cyber backdrop when the simulation is paused.
 */
export function PauseOverlay() {
  const isPaused = useGameStore((s) => s.isPaused);
  const { togglePause } = useGameBridge();

  if (!isPaused) return null;

  return (
    <div className="absolute inset-0 z-30 bg-cyber-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center font-mono">
      <div className="p-4 rounded-xl bg-cyber-dark/95 border border-neon-cyan/50 max-w-sm w-full shadow-2xl neon-glow-cyan">
        <div className="text-neon-cyan font-bold text-lg tracking-widest mb-1">
          SIMULATION SUSPENDED
        </div>
        <p className="text-zinc-400 text-xs mb-6">
          Hoverbike thrust systems idling. Active delivery countdown frozen.
        </p>

        <button
          onClick={togglePause}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-neon-cyan text-cyber-black font-bold text-sm tracking-wider hover:bg-cyan-300 transition-colors cursor-pointer"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>RESUME MISSION</span>
        </button>
      </div>
    </div>
  );
}

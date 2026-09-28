'use client';

import { useGameStore } from '@/stores/useGameStore';
import { useGameBridge } from '@/hooks/useGameBridge';
import { RotateCcw, MapPlus, Skull } from 'lucide-react';

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * GameOverOverlay raises the run-end screen when hull integrity reaches zero.
 *
 * Two distinct recoveries, mirroring the two distinct failure modes:
 *   - RETRY keeps the district, the mission, and the drone squad (fast, comparable repeat);
 *   - NEW DISTRICT rolls a fresh city, which is also the escape hatch if a run ever ends up
 *     wedged, since it rebuilds the scene's entities from scratch.
 */
export function GameOverOverlay() {
  const status = useGameStore((s) => s.run.status);
  const reason = useGameStore((s) => s.run.reason);
  const survivedSeconds = useGameStore((s) => s.run.survivedSeconds);
  const seedLabel = useGameStore((s) => s.city.seedLabel);
  const { restartRun, regenerateCity } = useGameBridge();

  if (status !== 'over') return null;

  return (
    <div className="absolute inset-0 z-30 bg-cyber-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center font-mono">
      <div className="p-4 rounded-xl bg-cyber-dark/95 border border-neon-pink/60 max-w-sm w-full shadow-2xl">
        <div className="flex items-center justify-center gap-2 text-neon-pink font-bold text-lg tracking-widest mb-1">
          <Skull className="w-5 h-5" />
          <span>COURIER DOWN</span>
        </div>

        <p className="text-zinc-400 text-xs mb-4">
          {reason === 'destroyed'
            ? 'Security droids tore the hull apart. The package was recovered by the guild.'
            : 'Run terminated.'}
        </p>

        <div className="flex items-center justify-between text-[11px] text-zinc-400 border border-cyber-border rounded bg-cyber-black/60 px-3 py-2 mb-5">
          <span>
            SURVIVED <span className="text-white font-bold">{formatDuration(survivedSeconds)}</span>
          </span>
          <span>
            SECTOR <span className="text-neon-cyan font-bold">{seedLabel}</span>
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={restartRun}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-neon-pink text-cyber-black font-bold text-sm tracking-wider hover:bg-pink-400 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>REBOOT &amp; RETRY</span>
          </button>

          <button
            onClick={() => regenerateCity()}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded border border-cyber-border text-zinc-300 hover:border-neon-cyan hover:text-neon-cyan font-bold text-xs tracking-wider transition-colors cursor-pointer"
          >
            <MapPlus className="w-4 h-4" />
            <span>JUMP TO NEW DISTRICT</span>
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useGameStore } from '@/stores/useGameStore';
import { Coins, Zap, Trophy } from 'lucide-react';

/**
 * GameHudStats displays persistent session stats (Credits, XP, Score, Runs).
 * Subscribes ONLY to `state.stats`, shielding it from high-frequency timer ticks.
 */
export function GameHudStats() {
  const credits = useGameStore((s) => s.stats.credits);
  const xp = useGameStore((s) => s.stats.xp);
  const score = useGameStore((s) => s.stats.score);
  const completed = useGameStore((s) => s.stats.completedCount);
  const failed = useGameStore((s) => s.stats.failedCount);

  return (
    <div className="flex items-center gap-2 sm:gap-4 bg-cyber-dark/85 backdrop-blur-md border border-cyber-border rounded-lg px-3 sm:px-4 py-2 font-mono text-xs shadow-lg">
      {/* Credits */}
      <div className="flex items-center gap-1.5">
        <Coins className="w-4 h-4 text-neon-amber" />
        <div>
          <span className="text-zinc-500 text-[10px] block leading-none">CREDITS</span>
          <span className="text-neon-amber font-bold text-sm">¢{credits.toLocaleString()}</span>
        </div>
      </div>

      <div className="w-[1px] h-6 bg-cyber-border" />

      {/* XP */}
      <div className="flex items-center gap-1.5">
        <Zap className="w-4 h-4 text-neon-cyan" />
        <div>
          <span className="text-zinc-500 text-[10px] block leading-none">XP</span>
          <span className="text-neon-cyan font-bold text-sm">{xp}</span>
        </div>
      </div>

      <div className="w-[1px] h-6 bg-cyber-border" />

      {/* Score & Runs */}
      <div className="flex items-center gap-1.5">
        <Trophy className="w-4 h-4 text-emerald-400" />
        <div>
          <span className="text-zinc-500 text-[10px] block leading-none">SCORE</span>
          <span className="text-white font-bold text-sm">{score}</span>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-2 pl-2 text-[11px] text-zinc-400">
        <span>RUNS:</span>
        <span className="text-emerald-400 font-bold">{completed}</span>
        <span>/</span>
        <span className="text-neon-pink font-bold">{failed}</span>
      </div>
    </div>
  );
}

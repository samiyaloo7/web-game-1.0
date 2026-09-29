'use client';

import { useGameStore } from '@/stores/useGameStore';
import { OCCLUDED_PANEL_CLASS, usePanelOccluded } from '@/hooks/useHudOcclusion';
import { Coins, Zap, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * GameHudStats renders the career wallet and rank beside the session score.
 *
 * The split is deliberate: `progression.*` is persistent *game state* mirrored from
 * `PlayerProgression` (money, XP, rank, derived stats — survives restarts), while
 * `stats.*` is the throwaway score of the current run. React only ever reads here;
 * every number is pushed in by the game over the EventBus bridge.
 */
export function GameHudStats() {
  const money = useGameStore((s) => s.progression.money);
  const level = useGameStore((s) => s.progression.level);
  const xpIntoLevel = useGameStore((s) => s.progression.xpIntoLevel);
  const xpToNextLevel = useGameStore((s) => s.progression.xpToNextLevel);
  const levelProgress = useGameStore((s) => s.progression.levelProgress);
  const score = useGameStore((s) => s.stats.score);
  const completed = useGameStore((s) => s.stats.completedCount);
  const failed = useGameStore((s) => s.stats.failedCount);

  // Top-right panel: fades when a drop pad or crate drifts under it.
  const isOccluded = usePanelOccluded('hud-stats');

  const progressPercent = Math.round(levelProgress * 100);
  const xpLabel = xpToNextLevel === 0 ? 'MAX RANK' : `${xpIntoLevel} / ${xpToNextLevel} XP`;

  return (
    <div
      data-hud-panel="hud-stats"
      className={cn(
        'flex items-center gap-2 sm:gap-4 bg-cyber-dark/85 backdrop-blur-md border border-cyber-border rounded-lg px-3 sm:px-4 py-2 font-mono text-xs shadow-lg transition-opacity duration-300',
        isOccluded && OCCLUDED_PANEL_CLASS
      )}
    >
      {/* Career wallet */}
      <div className="flex items-center gap-1.5">
        <Coins className="w-4 h-4 text-neon-amber" />
        <div>
          <span className="text-zinc-500 text-[10px] block leading-none">CREDITS</span>
          <span className="text-neon-amber font-bold text-sm">¢{money.toLocaleString()}</span>
        </div>
      </div>

      <div className="w-[1px] h-6 bg-cyber-border" />

      {/* Rank + XP progress */}
      <div className="flex items-center gap-1.5">
        <Zap className="w-4 h-4 text-neon-cyan" />
        <div>
          <span className="text-zinc-500 text-[10px] block leading-none">RANK</span>
          <span className="text-neon-cyan font-bold text-sm">LV {level}</span>
          <div className="w-20 h-1 mt-1 bg-cyber-border rounded-full overflow-hidden">
            <div
              className="h-full bg-neon-cyan rounded-full transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
        <span className="text-[10px] text-zinc-500 whitespace-nowrap">{xpLabel}</span>
      </div>

      <div className="w-[1px] h-6 bg-cyber-border" />

      {/* Session score */}
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

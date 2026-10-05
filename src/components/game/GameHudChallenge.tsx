'use client';

import { useGameStore } from '@/stores/useGameStore';
import { OCCLUDED_PANEL_CLASS, usePanelOccluded } from '@/hooks/useHudOcclusion';
import { CalendarClock, Gift, CheckCircle2, WifiOff, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChallengeSyncStatus } from '@/stores/useGameStore';
import type { ChallengeTier } from '@/game/types/challenge';

/**
 * GameHudChallenge renders today's daily objective.
 *
 * Everything it shows comes from the game over `challenge:progress` — React does
 * not re-derive the objective, count deliveries, or decide whether the window is
 * open. That keeps the challenge's rules in exactly one place (the tracker), and
 * means the panel cannot disagree with the simulation.
 */

/** Tier → accent colour, so difficulty reads at a glance. */
const TIER_STYLES: Record<
  ChallengeTier,
  { text: string; border: string; bar: string }
> = {
  standard: { text: 'text-neon-cyan', border: 'border-neon-cyan/40', bar: 'bg-neon-cyan' },
  advanced: { text: 'text-neon-amber', border: 'border-neon-amber/40', bar: 'bg-neon-amber' },
  elite: { text: 'text-neon-pink', border: 'border-neon-pink/40', bar: 'bg-neon-pink' },
};

/** `mm:ss` for the live countdown, so a 3:00 window does not read as `0:180`. */
function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function syncBadge(status: ChallengeSyncStatus) {
  switch (status) {
    case 'syncing':
      return { label: 'RECORDING...', className: 'text-zinc-400', Icon: CalendarClock };
    case 'granted':
      return { label: 'REWARD PAID', className: 'text-emerald-400', Icon: CheckCircle2 };
    case 'offline':
      return { label: 'LOCAL REWARD', className: 'text-neon-amber', Icon: WifiOff };
    case 'error':
      return { label: 'UPLINK ERROR', className: 'text-neon-pink', Icon: TriangleAlert };
    default:
      return null;
  }
}

export function GameHudChallenge() {
  const challengeId = useGameStore((s) => s.challenge.challengeId);
  const title = useGameStore((s) => s.challenge.title);
  const description = useGameStore((s) => s.challenge.description);
  const tier = useGameStore((s) => s.challenge.tier);
  const target = useGameStore((s) => s.challenge.target);
  const progress = useGameStore((s) => s.challenge.progress);
  const bestProgress = useGameStore((s) => s.challenge.bestProgress);
  const windowSeconds = useGameStore((s) => s.challenge.windowSeconds);
  const windowRemainingSeconds = useGameStore((s) => s.challenge.windowRemainingSeconds);
  const windowActive = useGameStore((s) => s.challenge.windowActive);
  const completed = useGameStore((s) => s.challenge.completed);
  const lapsed = useGameStore((s) => s.challenge.lapsed);
  const rewardCredits = useGameStore((s) => s.challenge.rewardCredits);
  const rewardXp = useGameStore((s) => s.challenge.rewardXp);
  const syncStatus = useGameStore((s) => s.challengeSyncStatus);

  const isOccluded = usePanelOccluded('hud-challenge');

  // Nothing to show until the server has supplied the day's challenge.
  if (!challengeId) return null;

  const styles = TIER_STYLES[tier ?? 'standard'];
  const proportion = target > 0 ? Math.min(1, (completed ? target : progress) / target) : 0;
  const bestProportion = target > 0 ? Math.min(1, bestProgress / target) : 0;
  const badge = syncBadge(syncStatus);

  return (
    <div
      data-hud-panel="hud-challenge"
      className={cn(
        'w-full bg-cyber-dark/85 backdrop-blur-md border rounded-lg p-3 font-mono shadow-xl transition-[opacity,border-color] duration-300',
        completed ? 'border-emerald-500/50' : styles.border,
        isOccluded && OCCLUDED_PANEL_CLASS
      )}
    >
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-cyber-border/70">
        <div className="flex items-center gap-1.5 min-w-0">
          <CalendarClock className={cn('w-3.5 h-3.5 shrink-0', styles.text)} />
          <span className={cn('text-[11px] font-bold tracking-wider truncate', styles.text)}>
            DAILY // {title}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {badge && (
            <span className={cn('flex items-center gap-1 text-[10px]', badge.className)}>
              <badge.Icon className="w-3 h-3" />
              {badge.label}
            </span>
          )}
          <span
            key={completed ? 'challenge-complete' : 'challenge-live'}
            className={cn(
              'px-2 py-0.5 rounded text-[11px] font-bold border',
              completed
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hud-pop'
                : lapsed
                  ? 'bg-neon-pink/15 text-neon-pink border-neon-pink/40'
                  : windowActive
                    ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/40'
                    : 'text-zinc-500 border-cyber-border'
            )}
          >
            {completed
              ? 'COMPLETE'
              : windowActive
                ? formatClock(windowRemainingSeconds)
                : formatClock(windowSeconds)}
          </span>
        </div>
      </div>

      <p className="text-xs text-zinc-300 mb-2">{description}</p>

      {/* Progress. `bestProgress` is the ghost bar, kept after a lapsed attempt. */}
      <div className="relative h-2 rounded bg-cyber-surface/70 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-zinc-600/50"
          style={{ width: `${bestProportion * 100}%` }}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 transition-[width] duration-300',
            completed ? 'bg-emerald-400' : styles.bar
          )}
          style={{ width: `${proportion * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 mt-2 text-[10px]">
        <span className="text-zinc-500">
          {completed ? target : progress}/{target}
          {lapsed && !completed && (
            <span className="text-neon-pink ml-2">LAPSED — NEXT DELIVERY RE-ARMS</span>
          )}
        </span>
        <span className="flex items-center gap-1 text-neon-amber">
          <Gift className="w-3 h-3" />¢{rewardCredits} + {rewardXp} XP
        </span>
      </div>
    </div>
  );
}

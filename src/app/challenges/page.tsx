import type { Metadata } from 'next';
import { CalendarClock, Flame, Gift, Timer, WifiOff, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChallengeHistory } from '@/components/challenges/ChallengeHistory';
import { loadChallengeHistory, loadTodayChallenge } from '@/lib/challenges/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { cn } from '@/lib/utils';
import type { ChallengeTier } from '@/game/types/challenge';

export const metadata: Metadata = {
  title: 'Daily Challenge // Neon Courier',
  description:
    "Today's citywide objective — one deterministic challenge per UTC day, generated from the date.",
};

/**
 * The day boundary is the server's clock, so this page can never be prerendered
 * or cached: the same URL answers differently either side of UTC midnight.
 */
export const dynamic = 'force-dynamic';

/**
 * THE DAILY CHALLENGE BOARD
 *
 * A Server Component for three reasons:
 *
 *  1. **The clock.** `loadTodayChallenge()` reads the *server's* clock and derives
 *     the day from it. Rendering this in the browser would hand the decision back
 *     to a machine whose time can be wrong — and whose `dayIndex` the API would
 *     then reject anyway.
 *  2. **The progress.** The row is read under RLS, so a courier sees their own
 *     history and nothing else; the anon server client cannot widen that.
 *  3. **No hydration mismatch.** Every number on the page (progress, countdown,
 *     payout) is computed once, on the server, from one timestamp.
 *
 * The challenge itself needs no database at all — it is *derived* from the date —
 * so a local-only install still sees today's objective. Only the courier's result
 * and history require Supabase, and their absence is stated rather than hidden.
 */

const TIER_BADGE: Record<ChallengeTier, { label: string; className: string }> = {
  standard: {
    label: 'STANDARD CONTRACT',
    className: 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10',
  },
  advanced: {
    label: 'PRIORITY CONTRACT',
    className: 'text-neon-amber border-neon-amber/40 bg-neon-amber/10',
  },
  elite: {
    label: 'BLACK MARKET CONTRACT',
    className: 'text-neon-pink border-neon-pink/40 bg-neon-pink/10',
  },
};

/**
 * Countdown to the reset, formatted here rather than with `Intl`/`toLocaleString`
 * so the text is identical on every runtime — the same rule the generator follows.
 */
function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export default async function ChallengesPage() {
  // One round-trip set, in parallel. `getCurrentUser` is request-cached, so the
  // layout and this page share a single identity check.
  const [today, history, user] = await Promise.all([
    loadTodayChallenge(),
    loadChallengeHistory(),
    getCurrentUser(),
  ]);

  // `loadTodayChallenge` returns the derived context plus the caller's own row, so
  // the challenge definition and the progress are destructured separately.
  const { challenge, secondsUntilReset } = today.context;
  const progress = today.progress;
  const tier = TIER_BADGE[challenge.tier];

  const completed = progress?.completed ?? false;
  const claimed = progress?.claimed ?? false;
  const attempted = progress?.progress ?? 0;
  const ratio =
    challenge.objective.target > 0
      ? Math.min(
          1,
          (completed ? challenge.objective.target : attempted) / challenge.objective.target
        )
      : 0;

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full p-4 sm:p-8">
      {/* Header: which day this is, and when it stops being this day. */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-cyber-border mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 text-neon-cyan text-xs font-mono uppercase tracking-wider mb-1">
            <Flame className="w-4 h-4" />
            <span>Citywide Objective // Rotates at 00:00 UTC</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">DAILY CHALLENGE</h1>
          <p className="text-sm text-zinc-500 font-mono mt-1">
            {challenge.date} · every courier plays the same objective
          </p>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-1">
          <span className="flex items-center gap-1.5 text-xs font-mono text-zinc-400 uppercase tracking-wider">
            <Timer className="w-3.5 h-3.5" /> Resets in
          </span>
          <span className="font-mono text-lg font-bold text-neon-amber">
            {formatCountdown(secondsUntilReset)}
          </span>
        </div>
      </div>

      {/* Uplink notices. Deliberately informative, never blocking: the challenge
          below is derived, so there is always something real to show. */}
      {!isSupabaseConfigured ? (
        <div className="flex items-start gap-3 border border-neon-amber/30 rounded-lg bg-neon-amber/5 p-4 mb-6">
          <WifiOff className="w-5 h-5 text-neon-amber/80 shrink-0 mt-0.5" />
          <p className="text-sm text-zinc-300 font-mono">
            Uplink not configured — this is a local-only session, so completion and history
            are not recorded. The objective itself is derived from the date and is still
            playable.
          </p>
        </div>
      ) : !user ? (
        <div className="flex items-start justify-between gap-4 border border-neon-cyan/30 rounded-lg bg-neon-cyan/5 p-4 mb-6 flex-wrap">
          <div className="flex items-start gap-3">
            <LogIn className="w-5 h-5 text-neon-cyan/80 shrink-0 mt-0.5" />
            <p className="text-sm text-zinc-300 font-mono">
              Jack in to bank the reward and keep a challenge log. Playing as a guest works,
              but nothing is recorded.
            </p>
          </div>
          <Button href="/login" size="sm">
            Jack In
          </Button>
        </div>
      ) : null}

      {/* TODAY */}
      <div
        className={cn(
          'rounded-lg border bg-cyber-dark/80 backdrop-blur-sm p-6 mb-10',
          completed ? 'border-emerald-500/40' : 'border-cyber-border'
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <CalendarClock
              className={cn('w-5 h-5', completed ? 'text-emerald-400' : 'text-neon-cyan')}
            />
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-wide">
              {challenge.title}
            </h2>
          </div>
          <span
            className={cn(
              'px-2.5 py-1 rounded border text-[11px] font-bold tracking-widest',
              tier.className
            )}
          >
            {tier.label}
          </span>
        </div>

        <p className="text-zinc-300 mb-6">{challenge.description}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 font-mono">
          <Stat label="Target" value={String(challenge.objective.target)} />
          <Stat label="Window" value={`${challenge.objective.windowSeconds}s`} />
          <Stat label="Reward" value={`¢${challenge.reward.credits}`} accent />
          <Stat label="XP" value={`${challenge.reward.xp}`} accent />
        </div>

        {/* Progress. Zero for a guest or a first attempt — which is honest, not an
            error: nothing has been recorded yet. */}
        <div className="mb-2 flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-400 uppercase tracking-wider">Attempt progress</span>
          <span className="text-zinc-300">
            {completed ? challenge.objective.target : attempted}/{challenge.objective.target}
          </span>
        </div>
        <div className="h-2 rounded bg-cyber-surface overflow-hidden mb-4">
          <div
            className={cn('h-full transition-[width]', completed ? 'bg-emerald-400' : 'bg-neon-cyan')}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className={cn(
              'px-2.5 py-1 rounded border text-[11px] font-bold tracking-widest',
              claimed
                ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                : completed
                  ? 'text-neon-amber border-neon-amber/30 bg-neon-amber/10'
                  : 'text-zinc-500 border-cyber-border'
            )}
          >
            {claimed ? 'REWARD PAID' : completed ? 'COMPLETED — REWARD PENDING' : 'IN PROGRESS'}
          </span>

          <Button href="/game">{completed ? 'Replay Run' : 'Deploy to the District'}</Button>
        </div>

        {/* The seed, shown on purpose: it is how a player can verify that their
            neighbour really did get the same objective. */}
        <p className="mt-5 pt-4 border-t border-cyber-border/60 text-[11px] font-mono text-zinc-600 break-all">
          seed {challenge.seedLabel} → {challenge.seed}
        </p>
      </div>

      {/* HISTORY */}
      <div className="mb-4 flex items-center gap-2">
        <Gift className="w-4 h-4 text-neon-amber" />
        <h2 className="text-lg font-bold text-white tracking-wide">CHALLENGE LOG</h2>
      </div>
      <ChallengeHistory entries={history} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded border border-cyber-border bg-cyber-surface/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={cn('text-base font-bold', accent ? 'text-neon-amber' : 'text-white')}>
        {value}
      </div>
    </div>
  );
}


import { Trophy, Medal, Award, Zap } from 'lucide-react';
import type { LeaderboardRow } from '@/lib/leaderboard/server';
import { cn } from '@/lib/utils';

/**
 * One courier's row on the dispatch board.
 *
 * Presentational only: it receives a row that the database already computed and
 * renders it. No ranking, no sorting, no aggregation happens here — those are
 * the view's job, and duplicating them in React is how a board ends up
 * disagreeing with itself.
 *
 * The caller's own row is highlighted using `profile_id` rather than a
 * client-supplied "is this me" flag, so the highlight cannot be spoofed to
 * decorate someone else's name.
 */
export function PlayerRanking({
  entry,
  isCurrentUser,
  reputationTierLabel,
}: {
  entry: LeaderboardRow;
  isCurrentUser: boolean;
  reputationTierLabel: string;
}) {
  const rank = entry.rank;

  return (
    <tr
      className={cn(
        'transition-colors',
        isCurrentUser
          ? 'bg-neon-cyan/10 hover:bg-neon-cyan/15'
          : 'hover:bg-cyber-surface/40'
      )}
    >
      <td className="py-3.5 px-4 font-mono font-bold whitespace-nowrap">
        {rank === 1 && <Trophy className="inline w-4 h-4 text-neon-amber mr-1.5" />}
        {rank === 2 && <Medal className="inline w-4 h-4 text-slate-300 mr-1.5" />}
        {rank === 3 && <Award className="inline w-4 h-4 text-amber-600 mr-1.5" />}
        #{rank}
      </td>

      <td className="py-3.5 px-4 font-semibold tracking-wide">
        <span className={isCurrentUser ? 'text-neon-cyan' : 'text-white'}>
          {entry.username}
        </span>
        {isCurrentUser && (
          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-mono bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan align-middle">
            YOU
          </span>
        )}
      </td>

      <td className="py-3.5 px-4 font-mono text-neon-cyan font-bold whitespace-nowrap">
        {entry.total_score.toLocaleString()}
      </td>

      <td className="py-3.5 px-4 font-mono text-neon-amber whitespace-nowrap">
        ¢{entry.total_credits.toLocaleString()}
      </td>

      <td className="py-3.5 px-4 font-mono text-zinc-300 whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          <Zap className="w-3 h-3 text-neon-green" />
          {entry.best_score.toLocaleString()}
        </span>
      </td>

      <td className="py-3.5 px-4 font-mono text-zinc-300 whitespace-nowrap">
        {entry.deliveries}
      </td>

      <td className="py-3.5 px-4 text-xs text-zinc-500 font-mono whitespace-nowrap">
        {formatDate(entry.last_delivery_at)}
      </td>

      <td className="py-3.5 px-4 whitespace-nowrap">
        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium border border-cyber-border bg-cyber-surface text-zinc-300">
          {reputationTierLabel}
        </span>
      </td>
    </tr>
  );
}

/** Column headers. Kept beside the row so they cannot drift apart. */
export const LEADERBOARD_COLUMNS = [
  'Rank',
  'Courier Call-Sign',
  'Score',
  'Credits',
  'Best Run',
  'Runs',
  'Last Active',
  'Rep Tier',
] as const;

/**
 * Formats an ISO timestamp as a short absolute date.
 *
 * Deliberately NOT a relative "3 days ago": the board is a public ranking, and a
 * relative date re-renders differently on the server and the client (timezone
 * drift, stale hydration), which produces a React hydration mismatch. An
 * absolute UTC date is stable in both places.
 */
function formatDate(iso: string | null): string {
  if (!iso) return '--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toISOString().slice(0, 10);
}

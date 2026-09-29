import type { Metadata } from 'next';
import { Flame, Trophy, WifiOff, ServerCrash } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { PlayerRanking, LEADERBOARD_COLUMNS } from '@/components/leaderboard/PlayerRanking';
import { LeaderboardPagination } from '@/components/leaderboard/LeaderboardPagination';
import {
  loadLeaderboardPage,
  countLeaderboardEntries,
  reputationTier,
  DEFAULT_PAGE_SIZE,
  type LeaderboardRow,
} from '@/lib/leaderboard/server';
import { clampPage, totalPagesFor } from '@/lib/leaderboard/pagination';
import { getCurrentUser } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Global Leaderboards // Neon Courier',
  description: 'Top courier times and delivery rankings across the neon sprawl.',
};

// The ranking depends on live data and the caller's identity, so this must never
// be prerendered or cached. `loading.tsx` covers the navigation gap.
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ page?: string }>;

/**
 * The dispatch board.
 *
 * A Server Component, so the ranking is read on the server and arrives as
 * finished HTML. It renders four distinct states rather than pretending a
 * failure is an empty board — "nobody has scored yet" and "the database is
 * unreachable" call for completely different user responses, and conflating them
 * is how a broken deploy looks like a successful empty game.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  // Parsed defensively: a hand-edited `?page=abc` falls back to page 1 rather
  // than throwing a 500.
  const parsedPage = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [firstPageResult, totalEntries, user] = await Promise.all([
    loadLeaderboardPage(page, DEFAULT_PAGE_SIZE),
    countLeaderboardEntries(),
    getCurrentUser(),
  ]);

  /*
   * Clamp an out-of-range deep link to the last real page.
   *
   * `?page=999` on a two-page board used to load zero rows and fall into the
   * EMPTY state — "NO TRANSMISSIONS LOGGED" on a board that is full — while the
   * controls underneath read "PAGE 999 OF 2". An empty page and an empty board
   * are different facts, and conflating them is the same failure this file
   * already refuses to make between empty and error.
   *
   * The count is fetched in parallel with the first page, so this costs a
   * second query only in the rare out-of-range case.
   */
  const pageSize = firstPageResult.ok ? firstPageResult.pageSize : DEFAULT_PAGE_SIZE;
  const effectivePage = clampPage(page, totalPagesFor(totalEntries, pageSize));
  const result =
    firstPageResult.ok && effectivePage !== page
      ? await loadLeaderboardPage(effectivePage, DEFAULT_PAGE_SIZE)
      : firstPageResult;

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-cyber-border mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 text-neon-amber text-xs font-mono uppercase tracking-wider mb-1">
            <Flame className="w-4 h-4" />
            <span>Syndicate High Frequency Rankings</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">CITYWIDE DISPATCH BOARD</h1>
        </div>
        <div className="text-xs text-zinc-400 bg-cyber-surface px-3 py-1.5 rounded border border-cyber-border font-mono">
          SCORES VERIFIED SERVER-SIDE
        </div>
      </div>

      {result.ok ? (
        <LeaderboardTable
          entries={result.entries}
          currentUserId={user?.id ?? null}
        />
      ) : result.reason === 'not-configured' ? (
        <NotConfiguredState />
      ) : (
        <ErrorState />
      )}

      {result.ok && (
        <LeaderboardPagination
          page={result.page}
          pageSize={result.pageSize}
          totalEntries={totalEntries}
        />
      )}
    </div>
  );
}

/** The happy path, plus the empty case, split out to keep each branch readable. */
function LeaderboardTable({
  entries,
  currentUserId,
}: {
  entries: LeaderboardRow[];
  currentUserId: string | null;
}) {
  if (entries.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-cyber-border bg-cyber-dark/80 backdrop-blur-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-cyber-surface/90 text-xs text-zinc-400 uppercase tracking-wider border-b border-cyber-border">
          <tr>
            {LEADERBOARD_COLUMNS.map((column) => (
              <th key={column} className="py-3 px-4 whitespace-nowrap">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cyber-border/50 text-zinc-300">
          {entries.map((entry) => (
            <PlayerRanking
              key={entry.profile_id}
              entry={entry}
              isCurrentUser={currentUserId !== null && entry.profile_id === currentUserId}
              reputationTierLabel={reputationTier(entry.total_credits)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Empty state. Distinct from the error state on purpose: this is a working board
 * that nobody has scored on yet, which is a good outcome for a new install.
 */
function EmptyState() {
  return (
    <div className="border border-cyber-border rounded-lg bg-cyber-dark/80 backdrop-blur-sm p-12 text-center">
      <Trophy className="w-10 h-10 text-zinc-700 mx-auto mb-4" />
      <p className="text-white font-bold text-lg mb-1">NO TRANSMISSIONS LOGGED</p>
      <p className="text-sm text-zinc-500 font-mono mb-6 max-w-md mx-auto">
        The dispatch board is empty. Every courier is currently anonymous.
      </p>
      <Button href="/game" size="lg">
        Claim First Place
      </Button>
    </div>
  );
}

/** Supabase is not configured — a local-only install, not a bug. */
function NotConfiguredState() {
  return (
    <div className="border border-neon-amber/30 rounded-lg bg-neon-amber/5 p-12 text-center">
      <WifiOff className="w-10 h-10 text-neon-amber/70 mx-auto mb-4" />
      <p className="text-white font-bold text-lg mb-1">UPLINK NOT CONFIGURED</p>
      <p className="text-sm text-zinc-400 font-mono mb-6 max-w-lg mx-auto">
        Supabase environment variables are missing, so there is no board to read. The game
        itself still runs as a local-only session.
      </p>
      <Button href="/" variant="outline" size="lg">
        Return to Menu
      </Button>
    </div>
  );
}

/** A real failure. Offers a retry rather than a dead end. */
function ErrorState() {
  return (
    <div className="border border-neon-pink/40 rounded-lg bg-neon-pink/5 p-12 text-center">
      <ServerCrash className="w-10 h-10 text-neon-pink/80 mx-auto mb-4" />
      <p className="text-white font-bold text-lg mb-1">DISPATCH FEED INTERRUPTED</p>
      <p className="text-sm text-zinc-400 font-mono mb-6 max-w-lg mx-auto">
        The ranking could not be retrieved. This is usually a transient network fault.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link href="/leaderboard" className="inline-block">
          <Button size="lg">Retry</Button>
        </Link>
        <Link href="/game">
          <Button variant="ghost" size="lg">
            Play Anyway
          </Button>
        </Link>
      </div>
    </div>
  );
}

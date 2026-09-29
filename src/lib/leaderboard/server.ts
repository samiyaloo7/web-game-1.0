import 'server-only';
import { createSupabaseServerClient } from '../supabase/server';
import { isSupabaseConfigured } from '../supabase/env';
import { DEFAULT_PAGE_SIZE, clampPageSize } from './pagination';
import type { Database } from '../supabase/database';

// Re-exported so the loader, the page and the page controls all share one
// definition of the page-size bounds. See `./pagination.ts`.
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  clampPage,
  clampPageSize,
  totalPagesFor,
} from './pagination';

/**
 * LEADERBOARD READS
 * =================
 *
 * ## Why a view instead of aggregating in the browser
 *
 * The `leaderboard` view folds every courier's `scores` rows into career totals
 * *inside Postgres*, so the client fetches a small page instead of downloading
 * the whole score history and summing it in JavaScript — on the free tier
 * (500 MB database, 5 GB egress) that difference is the difference between a
 * snappy board and an exhausted project.
 *
 * ## Why the view is `security_invoker`
 *
 * A Postgres view normally runs with its *owner's* privileges, which for a
 * Supabase-created view means `postgres` — i.e. RLS silently bypassed. Postgres
 * 15 added `security_invoker = on` so a view obeys the querying role's policies
 * instead. The migration sets it explicitly; without it the view would be a
 * privilege-escalation hole the moment anyone tightened the `scores` policies.
 *
 * ## Pagination
 *
 * Offset pagination via `leaderboard_page(offset, limit)`. Offset paging has the
 * well-known weakness that a new high score shifts every later row by one, so a
 * row can be duplicated or skipped when paging while the board changes. That is
 * acceptable here: the board is a browsing surface, not a financial ledger, and
 * a *keyset* cursor would need a stable tiebreak across `total_score` plus
 * `username`. The page size is capped at 50 in SQL so a caller cannot ask for
 * the entire table and burn the egress quota.
 */

export type LeaderboardRow = Database['public']['Views']['leaderboard']['Row'];

/**
 * One page of the board, or a typed failure. Returning a discriminated union
 * rather than throwing lets the page render a real error state instead of a
 * Next.js error boundary for what is usually a transient network blip.
 */
export type LeaderboardResult =
  | { ok: true; entries: LeaderboardRow[]; page: number; pageSize: number }
  | { ok: false; reason: 'not-configured' | 'error'; message?: string };

export async function loadLeaderboardPage(
  page = 1,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<LeaderboardResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, reason: 'not-configured' };
  }

  // Clamp locally as well as in SQL: it keeps the offset arithmetic sane and
  // means a hostile `?page=99999999` cannot become a huge OFFSET.
  const safeSize = clampPageSize(pageSize);
  const safePage = Math.max(Math.floor(page) || 1, 1);
  const offset = (safePage - 1) * safeSize;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, reason: 'not-configured' };

  const { data, error } = await supabase.rpc('leaderboard_page', {
    p_offset: offset,
    p_limit: safeSize,
  });

  if (error) {
    // The message is logged server-side, never returned: PostgREST error text can
    // disclose schema details.
    console.error('[leaderboard] page fetch failed:', error.message);
    return { ok: false, reason: 'error' };
  }

  return {
    ok: true,
    entries: (data ?? []) as LeaderboardRow[],
    page: safePage,
    pageSize: safeSize,
  };
}

/** Total ranked couriers — used only to render "Page x of y". */
export async function countLeaderboardEntries(): Promise<number> {
  if (!isSupabaseConfigured) return 0;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return 0;

  // A capped request is a cheap way to distinguish "one page" from "more" without
  // a COUNT(*) that scans the table.
  const { count } = await supabase.from('leaderboard').select('*', { count: 'exact', head: true });
  return count ?? 0;
}

/** Reputation tier, derived from lifetime credits. Pure so it can be unit-tested. */
export function reputationTier(totalCredits: number): string {
  if (totalCredits >= 250_000) return 'Legendary';
  if (totalCredits >= 100_000) return 'Master';
  if (totalCredits >= 50_000) return 'Elite';
  if (totalCredits >= 15_000) return 'Veteran';
  if (totalCredits >= 1_000) return 'Operator';
  return 'Rookie';
}


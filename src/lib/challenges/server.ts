import 'server-only';
import { createSupabaseServerClient } from '../supabase/server';
import { isSupabaseConfigured } from '../supabase/env';
import { buildDailyChallengeContext, dayIndexToIsoDate } from '@/game/systems/DailyChallenge';
import { challengeProgressFromRow, historyEntryFromRow } from './mapping';
import type { DailyChallengeContext } from '@/game/systems/DailyChallenge';
import type { ChallengeHistoryEntry, DailyChallengeProgress } from '@/game/types/challenge';

/**
 * DAILY CHALLENGE READS
 * =====================
 *
 * ## Where "today" comes from
 *
 * Exactly one place: `loadTodayChallenge()`. It calls `Date.now()` on the *server*
 * and hands the timestamp to the same pure `buildDailyChallengeContext` the API
 * route uses. Nothing in the browser can influence which day this is, which is the
 * requirement that makes cross-player reproducibility real rather than nominal —
 * a courier whose machine thinks it is 2031 still plays today's challenge.
 *
 * (A future hardening could read `now()` from Postgres instead of the Node
 * process. The important property is already in place: the decision is made
 * server-side, from a single timestamp, by pure functions.)
 *
 * ## Why the reads are RLS-shaped
 *
 * The challenge definition needs no database at all — it is derived. Only the
 * courier's *result* is read, through the anon server client, so
 * `daily_challenge_progress_select_own` reduces it to the caller's own row. A bug
 * in this file cannot leak another courier's challenge history.
 *
 * ## Why history is read, not regenerated
 *
 * The row carries `title`, `description`, `window_seconds` and `reward_*`. Reading
 * them back means editing the generator's templates later cannot rewrite a
 * courier's past — the same reason a receipt keeps the price it charged.
 */

export interface TodayChallenge {
  context: DailyChallengeContext;
  /** The caller's own progress, or `null` for a guest / first attempt. */
  progress: DailyChallengeProgress | null;
}

/**
 * Today's challenge plus the caller's progress.
 *
 * `nowMs` is injectable so the day boundary can be unit-tested and so a future
 * caller can supply the database's clock without touching this logic.
 */
export async function loadTodayChallenge(nowMs: number = Date.now()): Promise<TodayChallenge> {
  const context = buildDailyChallengeContext(nowMs);
  const progress = await loadChallengeProgress(context.challenge.id);
  return { context, progress };
}

/** The caller's row for one day, or `null`. Never throws — a failed read is "no progress". */
export async function loadChallengeProgress(
  challengeId: string
): Promise<DailyChallengeProgress | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('daily_challenge_progress')
    .select('*')
    .eq('challenge_id', challengeId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return challengeProgressFromRow(data);
}

/**
 * The caller's challenge history, newest day first.
 *
 * Bounded like every other list in this app so a deep link cannot ask for the
 * whole table and burn the free-tier egress budget.
 */
export async function loadChallengeHistory(limit = 14): Promise<ChallengeHistoryEntry[]> {
  if (!isSupabaseConfigured) return [];

  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const bounded = Math.min(Math.max(Math.floor(limit) || 0, 1), 60);

  const { data, error } = await supabase
    .from('daily_challenge_progress')
    .select('*')
    .order('day_index', { ascending: false })
    .limit(bounded);

  if (error) return [];
  return (data ?? []).map(historyEntryFromRow);
}

/** ISO date for a stored day index — re-exported so pages need one import. */
export { dayIndexToIsoDate };

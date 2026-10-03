import { dayIndexToIsoDate } from '@/game/systems/DailyChallenge';
import { isChallengeMetric } from '@/game/types/challenge';
import type {
  ChallengeHistoryEntry,
  ChallengeMetric,
  DailyChallengeProgress,
} from '@/game/types/challenge';
import type { Database } from '../supabase/database';

/**
 * PURE TRANSLATION between `daily_challenge_progress` rows and the game's
 * challenge types.
 *
 * No Supabase client, no React, no clock — which means the *rules* about what a
 * valid stored challenge looks like are unit-testable in plain Node, and the same
 * mapping runs on the server (SSR load) and on the route (RPC result). The
 * database enforces its own CHECK constraints too; this layer is the *friendly*
 * gate, the SQL is the hard one — exactly the arrangement `progression/mapping.ts`
 * uses.
 */

type ChallengeRow = Database['public']['Tables']['daily_challenge_progress']['Row'];
type RecordProgressRow =
  Database['public']['Functions']['record_challenge_progress']['Returns'][number];

function toNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

/** Falls back to the `deliveries` metric only if a row somehow lost its own. */
function toMetric(value: unknown): ChallengeMetric {
  return isChallengeMetric(value) ? value : 'deliveries';
}

function clampProgress(progress: number, target: number): number {
  return Math.min(Math.max(0, progress), target);
}

/** A persisted row, shaped for the HUD and the history list. */
export function challengeProgressFromRow(row: ChallengeRow): DailyChallengeProgress {
  const target = toNonNegativeInt(row.target);
  const progress = clampProgress(toNonNegativeInt(row.progress), target);

  return {
    challengeId: row.challenge_id,
    dayIndex: toNonNegativeInt(row.day_index),
    progress,
    target,
    completed: row.completed_at !== null,
    claimed: row.claimed_at !== null,
    completedAt: row.completed_at,
    claimedAt: row.claimed_at,
    rewardCredits: toNonNegativeInt(row.reward_credits),
    rewardXp: toNonNegativeInt(row.reward_xp),
  };
}

/** The `record_challenge_progress` RPC's own report of the row it just wrote. */
export function challengeProgressFromRpc(row: RecordProgressRow): DailyChallengeProgress {
  const target = toNonNegativeInt(row.target);
  const progress = clampProgress(toNonNegativeInt(row.progress), target);

  return {
    challengeId: row.challenge_id,
    dayIndex: toNonNegativeInt(row.day_index),
    progress,
    target,
    completed: Boolean(row.completed),
    claimed: Boolean(row.claimed),
    // The RPC returns the booleans, not the timestamps — the client only needs to
    // know that the transition happened, and `newly_claimed` is the authority on
    // whether THIS response is the one to pay.
    completedAt: null,
    claimedAt: null,
    rewardCredits: toNonNegativeInt(row.reward_credits),
    rewardXp: toNonNegativeInt(row.reward_xp),
  };
}

/**
 * A history row, including the challenge definition as it was stored.
 *
 * History is read from the row rather than regenerated, so editing the
 * generator's templates never rewrites the past.
 */
export function historyEntryFromRow(row: ChallengeRow): ChallengeHistoryEntry {
  const target = toNonNegativeInt(row.target);
  const dayIndex = toNonNegativeInt(row.day_index);

  return {
    challengeId: row.challenge_id,
    dayIndex,
    date: dayIndexToIsoDate(dayIndex),
    title: row.title,
    description: row.description,
    metric: toMetric(row.metric),
    target,
    windowSeconds: toNonNegativeInt(row.window_seconds),
    progress: clampProgress(toNonNegativeInt(row.progress), target),
    completed: row.completed_at !== null,
    claimed: row.claimed_at !== null,
    rewardCredits: toNonNegativeInt(row.reward_credits),
    rewardXp: toNonNegativeInt(row.reward_xp),
    updatedAt: row.updated_at,
  };
}

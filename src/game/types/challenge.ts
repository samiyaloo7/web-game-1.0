/**
 * DAILY CHALLENGE — pure domain types.
 *
 * A daily challenge is a small, rotating objective that every courier worldwide
 * shares for one UTC calendar day, generated deterministically from the date.
 *
 * Nothing in this module may import React, Phaser or the EventBus. The same
 * definitions are consumed by the generator (`systems/DailyChallenge`), the live
 * tracker (`systems/ChallengeTracker`), the Next.js route that derives the day
 * from the *server* clock, and the Supabase loader — so the rules can only be
 * written once. See `DAILY_CHALLENGES.md` for the date → seed derivation.
 */

/**
 * What the tracker counts.
 *
 * Deliberately restricted to quantities the server can also see in
 * `public.scores` (deliveries, credits, XP) rather than anything derived from the
 * live timer — a metric the database cannot reproduce is a metric we could never
 * audit later.
 */
export type ChallengeMetric = 'deliveries' | 'credits' | 'xp';

/** Difficulty band, used only for presentation (accent colour, badge). */
export type ChallengeTier = 'standard' | 'advanced' | 'elite';

/**
 * WHAT must be achieved, and HOW FAST.
 *
 * `windowSeconds` is the challenge's whole point: the objective must be reached
 * within this many seconds *of the first qualifying delivery*, not spread across
 * the day. "Deliver 5 packages in under 3 minutes" is
 * `{ metric: 'deliveries', target: 5, windowSeconds: 180 }`.
 */
export interface ChallengeObjective {
  metric: ChallengeMetric;
  target: number;
  windowSeconds: number;
}

/** What the courier is paid once the objective is met. Fixed server-side. */
export interface ChallengeReward {
  credits: number;
  xp: number;
}

/**
 * One day's challenge, fully reproducible from `dayIndex`.
 *
 * `seedLabel` is the human-readable string the RNG is seeded with
 * (`neon-courier:daily-challenge:2026-09-29`), and `seed` is its FNV-1a hash. Two
 * players who generate the same day get byte-for-byte identical fields, which is
 * what makes the challenge shareable ("today is RAPID DISPATCH, 5 in 3:00").
 */
export interface DailyChallenge {
  /** Stable id, e.g. `dc_2026-09-29`. Primary key of a player's challenge row. */
  id: string;
  /** Whole days since the fixed epoch — see `DAILY_CHALLENGES.md`. */
  dayIndex: number;
  /** UTC calendar date, `YYYY-MM-DD`. */
  date: string;
  /** The exact string the RNG is seeded from. */
  seedLabel: string;
  /** `seedLabel` hashed to a 32-bit integer. */
  seed: number;
  title: string;
  description: string;
  tier: ChallengeTier;
  objective: ChallengeObjective;
  reward: ChallengeReward;
}

/**
 * One courier's persisted outcome for one day's challenge.
 *
 * `completedAt` / `claimedAt` are stamped by the *database*, never the browser —
 * see the migration's `record_challenge_progress`. `claimed` and `completed` are
 * separate because a completed objective is paid exactly once, and the row is the
 * record of that having happened.
 */
export interface DailyChallengeProgress {
  challengeId: string;
  dayIndex: number;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  completedAt: string | null;
  claimedAt: string | null;
  rewardCredits: number;
  rewardXp: number;
}

/**
 * A past (or current) challenge plus the courier's result, ready for the history
 * list. The challenge fields are read back from the stored row rather than
 * re-generated, so history is stable even if the generator's templates change.
 */
export interface ChallengeHistoryEntry {
  challengeId: string;
  dayIndex: number;
  date: string;
  title: string;
  description: string;
  metric: ChallengeMetric;
  target: number;
  windowSeconds: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  rewardCredits: number;
  rewardXp: number;
  updatedAt: string;
}

/**
 * Live tracker snapshot mirrored across the game → UI seam.
 *
 * Emitted by `ChallengeTracker` (through `GameScene`) only on real state changes
 * or a change of the quantized window second — never per frame, per
 * `ARCHITECTURE.md` §11.
 */
export interface ChallengeProgressSnapshot {
  /** `null` until the server has told the game which challenge today is. */
  challengeId: string | null;
  dayIndex: number | null;
  metric: ChallengeMetric | null;
  title: string;
  description: string;
  tier: ChallengeTier | null;
  target: number;
  /** Progress of the CURRENT attempt; resets when the window lapses. */
  progress: number;
  /** Best progress seen today; survives a lapse so retries are encouraged. */
  bestProgress: number;
  windowSeconds: number;
  /** Whole seconds left in the current attempt (full window while inactive). */
  windowRemainingSeconds: number;
  /** True while a timed attempt is running (armed by the first delivery). */
  windowActive: boolean;
  completed: boolean;
  /** True when the last attempt ran out of time instead of completing. */
  lapsed: boolean;
  rewardCredits: number;
  rewardXp: number;
  /** True once the reward has been paid into the local career exactly once. */
  rewardGranted: boolean;
}

/** The neutral snapshot shown before any challenge has loaded. */
export const EMPTY_CHALLENGE_SNAPSHOT: ChallengeProgressSnapshot = {
  challengeId: null,
  dayIndex: null,
  metric: null,
  title: '',
  description: '',
  tier: null,
  target: 0,
  progress: 0,
  bestProgress: 0,
  windowSeconds: 0,
  windowRemainingSeconds: 0,
  windowActive: false,
  completed: false,
  lapsed: false,
  rewardCredits: 0,
  rewardXp: 0,
  rewardGranted: false,
};

/** The three metric values, as a runtime array for guards and tests. */
export const CHALLENGE_METRICS: readonly ChallengeMetric[] = ['deliveries', 'credits', 'xp'];

/**
 * Narrowing guard for values that arrived as plain strings (a database row, a
 * JSON body). Keeps unknown metric text from reaching the tracker's `switch`.
 */
export function isChallengeMetric(value: unknown): value is ChallengeMetric {
  return typeof value === 'string' && (CHALLENGE_METRICS as readonly string[]).includes(value);
}

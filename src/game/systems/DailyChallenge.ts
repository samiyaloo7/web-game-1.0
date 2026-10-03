import {
  CHALLENGE_MIN_REWARD,
  CHALLENGE_REWARD_STEP,
  CHALLENGE_TEMPLATES,
  CHALLENGE_TIER_THRESHOLDS,
  CHALLENGE_TIME_PRESSURE_MAX,
  CHALLENGE_TIME_PRESSURE_MIN,
  CHALLENGE_WINDOW_REFERENCE_SECONDS,
} from '../data/challengeData';
import { SeededRandom, hashSeed } from './SeededRandom';
import type { ChallengeObjective, ChallengeTier, DailyChallenge } from '../types/challenge';

/**
 * DETERMINISTIC DAILY CHALLENGES — the date → seed pipeline.
 * =========================================================
 *
 * ## The problem
 *
 * Every player must receive the *same* challenge on the same day, without the
 * server storing (or broadcasting) a per-day row. Storing one would work, but it
 * adds a write to a table nobody else needs and a request to fetch it, and it
 * makes "what was Tuesday's challenge?" depend on that row still existing.
 *
 * ## The trick: a day is an integer, and an integer is a seed
 *
 * A UTC calendar day is fully identified by one integer: the number of whole days
 * since a fixed epoch. We anchor at `2026-01-01T00:00:00Z`
 *
 *     dayIndex = floor((utcEpochMs - EPOCH_MS) / 86_400_000)
 *
 * Both operands are UTC, and Unix time has no timezone, so *every* machine that
 * knows the moment in time computes the same integer — a laptop in Tokyo and a
 * server in Frankfurt agree that it is day 273 at the same instant. The local
 * clock's timezone, DST rules and even the calendar are never consulted.
 *
 * That integer (plus a namespace string) is turned into a seed with FNV-1a, and
 * the seed drives the same `mulberry32` generator the city uses:
 *
 *     seedLabel = "neon-courier:daily-challenge:2026-09-29"
 *     seed      = fnv1a(seedLabel)               // 32-bit, stable forever
 *     rng       = new SeededRandom(seedLabel)    // identical on every machine
 *     challenge = pick(template) + pick(target) + pick(window)
 *
 * Because the generator's output depends only on the seed and on the fixed order
 * of RNG calls, the challenge is *reproducible by derivation*: no storage, no
 * network, no consensus protocol. Two players on the same day run the same three
 * `pick` calls and get identical challenges. The readable `seedLabel` is kept so
 * a challenge can be reported, shared, or logged ("I got RAPID DISPATCH on
 * seed neon-courier:daily-challenge:2026-09-29") and the numeric `seed` so it can
 * be compared cheaply.
 *
 * ## The clock, and why this file takes a timestamp
 *
 * `utcDayIndex()` accepts an explicit millisecond timestamp and never calls
 * `Date.now()` itself. That is deliberate: the *caller* decides whose clock is
 * authoritative. The server's route handler passes its own `Date.now()`, so the
 * browser's clock — which a player can move, and which is simply wrong on many
 * machines — can never change which challenge is live. The client may call these
 * functions for display, but it always receives the authoritative `dayIndex` from
 * the server first (see `DAILY_CHALLENGES.md`).
 *
 * ## Changing this file
 *
 * The generator is a pure function of `dayIndex`. Editing the templates or the
 * order of RNG calls changes every *future* day's challenge (past days are
 * already stored on each player's row, so history is unaffected). That is a
 * deliberate, reviewable change — not an accident of `Math.random()`.
 */

/** Milliseconds in one UTC day. Constant because UTC has no leap seconds in Unix time. */
export const MS_PER_DAY = 86_400_000;

/**
 * Anchor for `dayIndex`. Chosen as a round date after the project's start so the
 * index is small and human-friendly; the only requirement is that it never moves
 * (moving it re-numbers every day and invalidates stored challenge ids).
 */
export const DAILY_CHALLENGE_EPOCH_UTC = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

/** Namespace so daily-challenge seeds cannot collide with city or mission seeds. */
export const CHALLENGE_SEED_NAMESPACE = 'neon-courier:daily-challenge';

/**
 * The UTC day index containing `epochMs` — the single input that identifies a day.
 *
 * `Math.floor` (not `round`) is what makes the boundary exact: 23:59:59.999 UTC
 * still belongs to the old day, and 00:00:00.000 UTC starts the new one.
 */
export function utcDayIndex(epochMs: number): number {
  if (!Number.isFinite(epochMs)) return 0;
  return Math.floor((epochMs - DAILY_CHALLENGE_EPOCH_UTC) / MS_PER_DAY);
}

/** The UTC instant at which `dayIndex` begins. Inverse of `utcDayIndex`. */
export function dayIndexToUtcMs(dayIndex: number): number {
  return DAILY_CHALLENGE_EPOCH_UTC + Math.floor(dayIndex) * MS_PER_DAY;
}

/** `dayIndex` as an ISO date (`2026-09-29`). UTC, always — `toISOString` is UTC. */
export function dayIndexToIsoDate(dayIndex: number): string {
  return new Date(dayIndexToUtcMs(dayIndex)).toISOString().slice(0, 10);
}

/**
 * The exact string the RNG is seeded from. Readable, stable, shareable.
 *
 * The ISO date (rather than the raw integer) is used on purpose: a seed that
 * looks like `2026-09-29` can be spotted in a log or a bug report instantly,
 * whereas `273` cannot.
 */
export function dailyChallengeSeedLabel(dayIndex: number): string {
  return `${CHALLENGE_SEED_NAMESPACE}:${dayIndexToIsoDate(dayIndex)}`;
}

/** `seedLabel` hashed to the 32-bit integer `SeededRandom` normalises to. */
export function dailyChallengeSeed(dayIndex: number): number {
  return hashSeed(dailyChallengeSeedLabel(dayIndex));
}

/** Stable id for the day, e.g. `dc_2026-09-29`. Primary key of a player's row. */
export function dailyChallengeId(dayIndex: number): string {
  return `dc_${dayIndexToIsoDate(dayIndex)}`;
}

/**
 * Whole seconds from `epochMs` until the next UTC midnight.
 *
 * The reset countdown is derived here, on the server, so the browser never has to
 * ask its own (untrustworthy) clock when the challenge changes.
 */
export function secondsUntilNextUtcMidnight(epochMs: number): number {
  if (!Number.isFinite(epochMs)) return 0;
  const nextMidnight = dayIndexToUtcMs(utcDayIndex(epochMs) + 1);
  return Math.max(0, Math.ceil((nextMidnight - epochMs) / 1000));
}

/** Deterministic thousands separator (`1000` → `1,000`) without `toLocaleString`. */
function groupThousands(value: number): string {
  return String(Math.floor(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Human duration for a challenge objective (`180` → `3 minutes`).
 *
 * Deliberately not `Intl`, which depends on the runtime's locale data and would
 * make the description — and therefore the seeded challenge payload — vary
 * between machines.
 */
export function formatChallengeDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds === 0) return '0 seconds';
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * The objective as a sentence: "Deliver 5 packages in under 3 minutes."
 *
 * Derived from the numbers rather than stored as a string on each template, so
 * the wording cannot drift away from the target it describes.
 */
export function describeChallenge(objective: ChallengeObjective): string {
  const window = formatChallengeDuration(objective.windowSeconds);
  switch (objective.metric) {
    case 'deliveries':
      return `Deliver ${objective.target} package${
        objective.target === 1 ? '' : 's'
      } in under ${window}.`;
    case 'credits':
      return `Earn ¢${groupThousands(objective.target)} in delivery pay in under ${window}.`;
    case 'xp':
      return `Earn ${groupThousands(objective.target)} XP from deliveries in under ${window}.`;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds to the reward step, never below the minimum. */
function roundReward(value: number): number {
  const stepped = Math.round(value / CHALLENGE_REWARD_STEP) * CHALLENGE_REWARD_STEP;
  return Math.max(CHALLENGE_MIN_REWARD, stepped);
}

function tierForReward(credits: number): ChallengeTier {
  for (const band of CHALLENGE_TIER_THRESHOLDS) {
    if (credits >= band.minCredits) return band.tier;
  }
  return 'standard';
}

/**
 * THE generator. Pure, deterministic, and the only place a challenge is shaped.
 *
 * Same `dayIndex` → identical `DailyChallenge`, on every machine, forever. The
 * RNG is seeded from the *date label* (not the raw integer) so the seed is
 * self-describing, and the three picks happen in a fixed order.
 */
export function generateDailyChallenge(dayIndex: number): DailyChallenge {
  const index = Math.floor(dayIndex);
  const date = dayIndexToIsoDate(index);
  const seedLabel = dailyChallengeSeedLabel(index);
  const rng = new SeededRandom(seedLabel);

  // Fixed order matters: these three draws define the day.
  const template = rng.pick(CHALLENGE_TEMPLATES);
  const target = rng.pick(template.targets);
  const windowSeconds = rng.pick(template.windowsSeconds);

  const objective: ChallengeObjective = { metric: template.metric, target, windowSeconds };

  // A shorter window is harder, so it pays more. Bounded so no day is an outlier.
  const timePressure = clamp(
    CHALLENGE_WINDOW_REFERENCE_SECONDS / windowSeconds,
    CHALLENGE_TIME_PRESSURE_MIN,
    CHALLENGE_TIME_PRESSURE_MAX
  );

  const rewardCredits = roundReward(template.rewardCreditsPerUnit * target * timePressure);
  const rewardXp = roundReward(template.rewardXpPerUnit * target * timePressure);

  return {
    id: dailyChallengeId(index),
    dayIndex: index,
    date,
    seedLabel,
    seed: rng.seed,
    title: template.title,
    description: describeChallenge(objective),
    tier: tierForReward(rewardCredits),
    objective,
    reward: { credits: rewardCredits, xp: rewardXp },
  };
}

/**
 * Everything a caller needs to render "today", built from ONE timestamp.
 *
 * Bundling the derivation means the route, the page and the hook cannot disagree
 * about the day: they all pass their timestamp through here and receive the
 * challenge, its date, and the reset countdown together.
 */
export interface DailyChallengeContext {
  dayIndex: number;
  date: string;
  challenge: DailyChallenge;
  /** The timestamp the context was derived from — the caller's clock, verbatim. */
  serverTimeMs: number;
  secondsUntilReset: number;
}

export function buildDailyChallengeContext(serverTimeMs: number): DailyChallengeContext {
  const dayIndex = utcDayIndex(serverTimeMs);
  return {
    dayIndex,
    date: dayIndexToIsoDate(dayIndex),
    challenge: generateDailyChallenge(dayIndex),
    serverTimeMs,
    secondsUntilReset: secondsUntilNextUtcMidnight(serverTimeMs),
  };
}

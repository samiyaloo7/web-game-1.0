import type { ChallengeMetric, ChallengeTier } from '../types/challenge';

/**
 * DAILY CHALLENGE CATALOG — the data half of the generator.
 *
 * A *template* fixes the metric and the flavour text, and offers a small pool of
 * targets and time windows. The generator picks from those pools with a
 * date-seeded RNG, so a day's identity is a (template, target, window) triple.
 *
 * Keeping this as data (exactly like `deliveryData` / `upgradeData`) means
 * balancing a challenge is an edit to a table entry, not a change to the
 * generation algorithm — and the algorithm stays small enough to unit-test.
 */

export interface ChallengeTemplate {
  id: string;
  metric: ChallengeMetric;
  /** Flavour title shown in the HUD and history, e.g. `RAPID DISPATCH`. */
  title: string;
  /** Candidate targets. The RNG picks exactly one. */
  targets: readonly number[];
  /** Candidate windows, in seconds. The RNG picks exactly one. */
  windowsSeconds: readonly number[];
  /** Base credits paid per unit of target, before time-pressure scaling. */
  rewardCreditsPerUnit: number;
  /** Base XP paid per unit of target, before time-pressure scaling. */
  rewardXpPerUnit: number;
}

/**
 * The window at which `timePressure` is exactly 1. Windows shorter than this pay
 * more (up to `CHALLENGE_TIME_PRESSURE_MAX`); longer ones pay less. It is a
 * constant rather than a magic number so the reward table is readable.
 */
export const CHALLENGE_WINDOW_REFERENCE_SECONDS = 300;

export const CHALLENGE_TIME_PRESSURE_MIN = 0.8;
export const CHALLENGE_TIME_PRESSURE_MAX = 1.8;

/** Rewards are rounded to this step so the HUD never shows `¢337`. */
export const CHALLENGE_REWARD_STEP = 5;

/** Floor so a challenge is always worth something. */
export const CHALLENGE_MIN_REWARD = 5;

/** Inclusive bounds for a window and a target, mirrored by the SQL CHECKs. */
export const CHALLENGE_MAX_WINDOW_SECONDS = 3600;
export const CHALLENGE_MAX_TARGET = 100_000;

/**
 * Upper bound accepted from the network for a progress counter. Mirrors the
 * clamp in `record_challenge_progress`; the ceiling only has to be larger than
 * any legitimate target.
 */
export const CHALLENGE_MAX_PROGRESS = 1_000_000;

/**
 * The shipped templates. Three metrics, three flavours of pressure:
 *  - `deliveries` rewards routing efficiency,
 *  - `credits`    rewards taking the fat contracts,
 *  - `xp`         rewards volume and rank progress.
 */
export const CHALLENGE_TEMPLATES: readonly ChallengeTemplate[] = [
  {
    id: 'ch_rapid_dispatch',
    metric: 'deliveries',
    title: 'RAPID DISPATCH',
    targets: [3, 4, 5, 6],
    windowsSeconds: [180, 240, 300],
    rewardCreditsPerUnit: 40,
    rewardXpPerUnit: 15,
  },
  {
    id: 'ch_payday_protocol',
    metric: 'credits',
    title: 'PAYDAY PROTOCOL',
    targets: [400, 600, 800, 1000],
    windowsSeconds: [240, 300, 360],
    rewardCreditsPerUnit: 0.5,
    rewardXpPerUnit: 0.15,
  },
  {
    id: 'ch_neural_upload',
    metric: 'xp',
    title: 'NEURAL UPLOAD',
    targets: [150, 250, 350, 450],
    windowsSeconds: [240, 300, 360],
    rewardCreditsPerUnit: 1.2,
    rewardXpPerUnit: 0.3,
  },
];

/**
 * Reward-band boundaries used for the display tier. A single source of truth so
 * the HUD badge and any future styling cannot disagree.
 */
export const CHALLENGE_TIER_THRESHOLDS: readonly { tier: ChallengeTier; minCredits: number }[] = [
  { tier: 'elite', minCredits: 500 },
  { tier: 'advanced', minCredits: 300 },
  { tier: 'standard', minCredits: 0 },
];

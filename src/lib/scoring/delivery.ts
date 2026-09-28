import { applyRewardMultiplier } from '@/game/systems/ProgressionMath';
import { PACKAGE_CATALOG } from '@/game/data/deliveryData';
import type { PackageDefinition } from '@/game/types/delivery';

/**
 * DELIVERY SCORING — the client-side mirror of the server's pricing function.
 *
 * ## Why the client computes this at all
 *
 * The server is the authority: `submit_delivery()` recomputes every credit from
 * `package_defs` and the courier's stored upgrades. This module exists purely so
 * the HUD can show the *expected* award the instant a delivery lands, without a
 * round-trip.
 *
 * ## Why mirroring is safe (and why it is not the security boundary)
 *
 * The formulas here are byte-for-byte the SQL. They MUST stay in step, or the
 * player sees one number and the leaderboard records another — a confusing bug,
 * not a security one, because nothing here is trusted downstream. A unit test
 * pins the shared constants, and the server is free to change its formula first
 * and this file second.
 *
 * The client is a *predictor*. The server is a *judge*. When they disagree, the
 * server wins and the discrepancy shows up as `claimed_credits != credits` in
 * the audit column.
 */

/** Fraction of the base award paid out for a perfect (zero-elapsed) delivery. */
export const TIME_BONUS_RATE = 0.5;

/** Score is credits plus XP weighted double — mirrors the `scores.score` column. */
export const XP_SCORE_WEIGHT = 2;

/**
 * Fraction of the timer still remaining, from the live mission.
 *
 * Clamped rather than trusted: a zero-length or corrupt timer yields 0 (no speed
 * bonus) instead of NaN propagating into the payout. The server clamps again.
 */
export function computeTimeRatio(
  remainingTimeSeconds: number,
  timeLimitSeconds: number
): number {
  if (!Number.isFinite(remainingTimeSeconds) || !Number.isFinite(timeLimitSeconds)) return 0;
  if (timeLimitSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, remainingTimeSeconds / timeLimitSeconds));
}

/** Credits for the speed bonus alone, before any multiplier. */
export function computeTimeBonus(baseCredits: number, timeRatio: number): number {
  const base = Number.isFinite(baseCredits) && baseCredits > 0 ? baseCredits : 0;
  const ratio = Number.isFinite(timeRatio) ? Math.min(1, Math.max(0, timeRatio)) : 0;
  return Math.round(base * TIME_BONUS_RATE * ratio);
}

/** What one delivery is worth, given a package and how fast it was completed. */
export interface DeliveryAward {
  credits: number;
  xp: number;
  timeBonus: number;
  score: number;
}

export function computeDeliveryAward(
  packageDef: PackageDefinition,
  timeRatio: number,
  rewardMultiplier: number
): DeliveryAward {
  const timeBonus = computeTimeBonus(packageDef.baseRewardCredits, timeRatio);
  const credits = applyRewardMultiplier(
    packageDef.baseRewardCredits,
    timeBonus,
    rewardMultiplier
  );
  // XP is never multiplied: rank pacing stays identical for every build.
  const xp = packageDef.baseRewardXp;
  return { credits, xp, timeBonus, score: computeScore(credits, xp) };
}

/** The single definition of "score", matching the generated SQL column. */
export function computeScore(credits: number, xp: number): number {
  const safeCredits = Number.isFinite(credits) ? Math.max(0, Math.floor(credits)) : 0;
  const safeXp = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  return safeCredits + safeXp * XP_SCORE_WEIGHT;
}

/** Local catalog lookup by id; `null` for an unknown id. */
export function findPackage(packageId: string): PackageDefinition | null {
  return PACKAGE_CATALOG.find((p) => p.id === packageId) ?? null;
}

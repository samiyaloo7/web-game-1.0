/**
 * Player progression — career-level rules and types.
 *
 * Progression is *game state*: money, XP, rank and owned upgrades describe the courier's
 * career and must obey the same rules in the client, in a unit test, and (later) in the
 * Supabase RPC that guards purchases. Nothing in this module, or in the systems built on
 * it, may import React, Phaser or the EventBus — see `PlayerProgression` for how the
 * game → UI seam is kept without leaking the engine into the maths.
 */

/** Garage categories, mirroring the `upgrades.category` column planned in ARCHITECTURE §5. */
export type UpgradeCategory = 'engine' | 'shield' | 'cargo' | 'utility';

/**
 * Stat deltas granted by ONE level of an upgrade. Optional fields mean "this upgrade
 * does not touch that stat", so a definition only states what it actually changes.
 */
export interface UpgradeEffect {
  /** Additive top-speed bonus ratio per level (0.1 = +10% of base speed). */
  speedBonusRatio?: number;
  /** Flat hull integrity added per level. */
  maxHealthBonus?: number;
  /** Additive delivery payout multiplier per level (0.2 = +20% credit payout). */
  rewardMultiplierBonus?: number;
  /** Extra seconds appended to every delivery timer per level. */
  timerBonusSeconds?: number;
}

/**
 * One purchasable upgrade *track* (e.g. "Overcharged Thrusters" levels 1..5), rather
 * than one flat item per tier — so cost curves and validation stay data-driven.
 */
export interface UpgradeDefinition {
  /** Stable id used as the key in `ProgressionState.upgrades`. */
  id: string;
  category: UpgradeCategory;
  name: string;
  description: string;
  /** Highest purchasable level. Level 0 means "not owned". */
  maxLevel: number;
  /** Credits charged for the FIRST level. */
  baseCost: number;
  /** Geometric growth: `cost(n) = round(baseCost * costGrowth^n)` where n is the owned level. */
  costGrowth: number;
  effect: UpgradeEffect;
}

/** Stock stats before any upgrade — the frame every profile starts on. */
export interface BaseStats {
  maxHealth: number;
  /** Top speed in pixels per second. */
  speed: number;
  /** Delivery payout multiplier with no broker licence owned. */
  rewardMultiplier: number;
  /** Extra delivery-timer seconds with no chronology upgrade owned. */
  timerBonusSeconds: number;
}

export const DEFAULT_BASE_STATS: BaseStats = {
  maxHealth: 100,
  speed: 310,
  rewardMultiplier: 1,
  timerBonusSeconds: 0,
};

/** Credits a brand-new courier starts with. Matches the `profiles.credits` default. */
export const STARTING_MONEY = 100;

/** Rank is derived from lifetime XP and can never exceed this. */
export const MAX_LEVEL = 100;

/**
 * XP curve: `xpToAdvance(level) = XP_BASE_PER_LEVEL * level + XP_CURVE_PER_LEVEL * level * (level - 1)`.
 * Linear base plus a quadratic term, so early ranks are quick and later ranks slow down
 * without any exponentials to keep the integers exact.
 */
export const XP_BASE_PER_LEVEL = 100;
export const XP_CURVE_PER_LEVEL = 25;

/** Speed may never exceed base × (1 + this) — the frame's safety limit (diminishing returns). */
export const MAX_SPEED_BONUS_RATIO = 0.6;

/** Delivery payout multiplier is hard-capped, however high the broker licence climbs. */
export const MAX_REWARD_MULTIPLIER = 3;

/**
 * The persistent career profile. Rank is *derived* from `xp` rather than stored, so a
 * level can never drift out of sync with the XP total that earned it.
 */
export interface ProgressionState {
  /** Spendable credits. */
  money: number;
  /** Lifetime XP. */
  xp: number;
  /** Owned level per upgrade id. A missing id means level 0 (not owned). */
  upgrades: Record<string, number>;
}

/** Fully derived stat block the simulation consumes (base stats + upgrade effects). */
export interface EffectiveStats {
  maxHealth: number;
  speed: number;
  rewardMultiplier: number;
  timerBonusSeconds: number;
}

/** Rank window inside the XP curve, shaped for a progress bar. */
export interface LevelProgress {
  level: number;
  /** XP earned since the current rank began. */
  xpIntoLevel: number;
  /** XP needed to reach the next rank (0 at `MAX_LEVEL`). */
  xpToNextLevel: number;
  /** 0..1, ready for a progress bar. 1 once `MAX_LEVEL` is reached. */
  progress: number;
}

/** Outcome of granting XP: enough for the UI to raise a "RANK UP" banner. */
export interface LevelUpResult {
  xpGained: number;
  previousLevel: number;
  newLevel: number;
  levelsGained: number;
}

/** Why a purchase was refused. `cost` on a rejection is the price that could not be paid. */
export type UpgradeRejectReason = 'unknown-upgrade' | 'max-level' | 'insufficient-funds';

/** Pure purchase gate result — computed before any state is touched. */
export type UpgradeValidation =
  | { ok: true; cost: number }
  | { ok: false; reason: UpgradeRejectReason; cost: number };

/** Final result of `PlayerProgression.purchaseUpgrade`. */
export type UpgradePurchaseResult =
  | { ok: true; upgradeId: string; cost: number; newLevel: number }
  | { ok: false; reason: UpgradeRejectReason; cost: number };

/**
 * Point-in-time mirror of the profile, emitted to the UI layer.
 * Every field is a plain number (or a plain record), so React can store it verbatim
 * without ever re-deriving game rules itself.
 */
export interface ProgressionSnapshot {
  money: number;
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  levelProgress: number;
  maxHealth: number;
  speed: number;
  rewardMultiplier: number;
  timerBonusSeconds: number;
  /** Owned levels per upgrade id, so a garage screen can render what the courier owns. */
  upgrades: Record<string, number>;
}

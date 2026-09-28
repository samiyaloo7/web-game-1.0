import { UPGRADE_CATALOG } from '../data/upgradeData';
import {
  DEFAULT_BASE_STATS,
  MAX_LEVEL,
  MAX_REWARD_MULTIPLIER,
  MAX_SPEED_BONUS_RATIO,
  XP_BASE_PER_LEVEL,
  XP_CURVE_PER_LEVEL,
} from '../types/progression';
import type {
  BaseStats,
  EffectiveStats,
  LevelProgress,
  ProgressionState,
  UpgradeDefinition,
  UpgradeValidation,
} from '../types/progression';

/**
 * Pure progression arithmetic: XP curve, rank derivation, upgrade prices, purchase
 * validation and the derived stat block.
 *
 * Every export here is a total function of its arguments — no clock, no randomness, no
 * Phaser, no React. That is what lets `tests/unit/ProgressionMath.test.ts` prove the
 * whole economy in plain Node, and what will let the future Supabase `purchase_upgrade`
 * RPC reuse identical rules so client and server never disagree about a price.
 */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** XP required to advance FROM `level` to `level + 1`. 0 at `MAX_LEVEL` or for bad input. */
export function xpToAdvance(level: number): number {
  if (!Number.isFinite(level) || level < 1 || level >= MAX_LEVEL) return 0;
  const l = Math.floor(level);
  return XP_BASE_PER_LEVEL * l + XP_CURVE_PER_LEVEL * l * (l - 1);
}

/** Cumulative XP required to REACH `level` (rank 1 costs 0 XP). Clamped to `MAX_LEVEL`. */
export function totalXpForLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 1) return 0;
  const target = Math.min(Math.floor(level), MAX_LEVEL);
  let total = 0;
  for (let l = 1; l < target; l += 1) {
    total += xpToAdvance(l);
  }
  return total;
}

/** Rank implied by a lifetime XP total. Always at least 1, capped at `MAX_LEVEL`. */
export function levelFromXp(xp: number): number {
  // NaN and negative XP are "no rank progress"; +Infinity walks the loop below and
  // lands on MAX_LEVEL like any other overwhelming total.
  if (Number.isNaN(xp) || xp <= 0) return 1;

  let level = 1;
  let threshold = 0;
  while (level < MAX_LEVEL) {
    const nextThreshold = threshold + xpToAdvance(level);
    if (xp < nextThreshold) break;
    threshold = nextThreshold;
    level += 1;
  }
  return level;
}

/** The current rank window, shaped for a HUD progress bar. */
export function getLevelProgress(xp: number): LevelProgress {
  const safeXp =
    Number.isNaN(xp) || xp <= 0 ? 0 : Math.min(Math.floor(xp), Number.MAX_SAFE_INTEGER);
  const level = levelFromXp(safeXp);
  const xpIntoLevel = safeXp - totalXpForLevel(level);

  if (level >= MAX_LEVEL) {
    return { level, xpIntoLevel, xpToNextLevel: 0, progress: 1 };
  }

  const xpToNextLevel = xpToAdvance(level);
  return {
    level,
    xpIntoLevel,
    xpToNextLevel,
    progress: xpToNextLevel > 0 ? clamp01(xpIntoLevel / xpToNextLevel) : 0,
  };
}

/**
 * Credits charged for the level AFTER `currentLevel` (0 = the first purchase).
 * Returns `null` when the level cannot be bought: unknown definition, invalid index,
 * or the track is already maxed.
 */
export function getUpgradeCost(
  definition: UpgradeDefinition | undefined | null,
  currentLevel: number
): number | null {
  if (!definition) return null;
  if (!Number.isFinite(currentLevel) || currentLevel < 0) return null;

  const level = Math.floor(currentLevel);
  if (level >= definition.maxLevel) return null;

  const cost = Math.round(definition.baseCost * Math.pow(definition.costGrowth, level));
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

/**
 * Clamps a stored upgrade level into `[0, maxLevel]`.
 * Hydrated or hand-edited state is untrusted, so corrupt values become "not owned"
 * instead of feeding a hacked 100-level engine into the stat block.
 */
export function sanitizeUpgradeLevel(raw: number | undefined, maxLevel: number): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.floor(raw), Math.max(0, maxLevel));
}

/**
 * The upgrade purchase gate. Checks existence, track completion and affordability in
 * that order, and never mutates anything — callers apply the result themselves, so a
 * rejection is structurally unable to half-spend the wallet.
 */
export function validateUpgrade(
  state: ProgressionState,
  definition: UpgradeDefinition | undefined | null
): UpgradeValidation {
  if (!definition) return { ok: false, reason: 'unknown-upgrade', cost: 0 };

  const level = sanitizeUpgradeLevel(state.upgrades[definition.id], definition.maxLevel);
  const cost = getUpgradeCost(definition, level);
  if (cost === null) return { ok: false, reason: 'max-level', cost: 0 };

  const money = Number.isFinite(state.money) ? state.money : -1;
  if (money < cost) return { ok: false, reason: 'insufficient-funds', cost };

  return { ok: true, cost };
}

/**
 * Derives the stat block the simulation runs on: stock frame + every owned upgrade.
 *
 * Effects stack additively per level; speed and payout are then clamped so stacking
 * can never push the courier past the frame safety limit (1.6×) or the payout past 3×.
 */
export function computeEffectiveStats(
  state: ProgressionState,
  options: {
    base?: BaseStats;
    catalog?: readonly UpgradeDefinition[];
  } = {}
): EffectiveStats {
  const base = options.base ?? DEFAULT_BASE_STATS;
  const catalog = options.catalog ?? UPGRADE_CATALOG;

  let speedBonus = 0;
  let maxHealth = base.maxHealth;
  let rewardMultiplier = base.rewardMultiplier;
  let timerBonusSeconds = base.timerBonusSeconds;

  for (const definition of catalog) {
    const level = sanitizeUpgradeLevel(state.upgrades[definition.id], definition.maxLevel);
    if (level === 0) continue;

    speedBonus += (definition.effect.speedBonusRatio ?? 0) * level;
    maxHealth += (definition.effect.maxHealthBonus ?? 0) * level;
    rewardMultiplier += (definition.effect.rewardMultiplierBonus ?? 0) * level;
    timerBonusSeconds += (definition.effect.timerBonusSeconds ?? 0) * level;
  }

  const speedFactor = 1 + Math.min(speedBonus, MAX_SPEED_BONUS_RATIO);

  return {
    maxHealth: Math.max(1, Math.round(maxHealth)),
    speed: Math.max(1, Math.round(base.speed * speedFactor)),
    rewardMultiplier:
      Math.round(Math.min(rewardMultiplier, MAX_REWARD_MULTIPLIER) * 100) / 100,
    timerBonusSeconds: Math.max(0, Math.round(timerBonusSeconds)),
  };
}

/**
 * Applies the career payout multiplier to a delivery's credits (base pay + time bonus).
 *
 * XP is deliberately not multiplied: rank pacing stays identical for every build, and
 * the multiplier upgrade buys money, not faster levels. Non-finite multipliers fall back
 * to the neutral 1× so a bad payload can never zero or inflate the economy.
 */
export function applyRewardMultiplier(
  baseCredits: number,
  timeBonus: number,
  rewardMultiplier: number
): number {
  const base = Number.isFinite(baseCredits) && baseCredits > 0 ? baseCredits : 0;
  const bonus = Number.isFinite(timeBonus) && timeBonus > 0 ? timeBonus : 0;
  const multiplier = Number.isFinite(rewardMultiplier)
    ? Math.max(0, rewardMultiplier)
    : 1;
  return Math.round((base + bonus) * multiplier);
}


import { describe, expect, it } from 'vitest';
import {
  applyRewardMultiplier,
  computeEffectiveStats,
  getLevelProgress,
  getUpgradeCost,
  levelFromXp,
  sanitizeUpgradeLevel,
  totalXpForLevel,
  validateUpgrade,
  xpToAdvance,
} from '@/game/systems/ProgressionMath';
import { UPGRADE_CATALOG } from '@/game/data/upgradeData';
import {
  DEFAULT_BASE_STATS,
  MAX_LEVEL,
  MAX_REWARD_MULTIPLIER,
  MAX_SPEED_BONUS_RATIO,
  STARTING_MONEY,
} from '@/game/types/progression';
import type { ProgressionState, UpgradeDefinition } from '@/game/types/progression';

/** Blank profile: factory wallet, no XP, nothing owned. */
function state(overrides: Partial<ProgressionState> = {}): ProgressionState {
  return { money: STARTING_MONEY, xp: 0, upgrades: {}, ...overrides };
}

/** Resolves a shipped upgrade or fails the test loudly, so ids can be spelled inline. */
function upgrade(id: string): UpgradeDefinition {
  const definition = UPGRADE_CATALOG.find((d) => d.id === id);
  if (!definition) throw new Error(`upgrade catalogue is missing "${id}"`);
  return definition;
}

describe('xpToAdvance - XP calculation', () => {
  it('prices the first ranks with exact integers', () => {
    expect(xpToAdvance(1)).toBe(100);
    expect(xpToAdvance(2)).toBe(250);
    expect(xpToAdvance(3)).toBe(450);
    expect(xpToAdvance(4)).toBe(700);
    expect(xpToAdvance(5)).toBe(1000);
  });

  it('grows monotonically across the whole level range', () => {
    let previous = 0;
    for (let level = 1; level < MAX_LEVEL; level += 1) {
      const cost = xpToAdvance(level);
      expect(cost).toBeGreaterThan(previous);
      previous = cost;
    }
  });

  it('returns 0 at the level cap and for invalid input', () => {
    expect(xpToAdvance(MAX_LEVEL)).toBe(0);
    expect(xpToAdvance(MAX_LEVEL + 5)).toBe(0);
    expect(xpToAdvance(0)).toBe(0);
    expect(xpToAdvance(-3)).toBe(0);
    expect(xpToAdvance(Number.NaN)).toBe(0);
    expect(xpToAdvance(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('treats fractional levels as the whole level they are in', () => {
    expect(xpToAdvance(2.7)).toBe(xpToAdvance(2));
  });
});

describe('totalXpForLevel / levelFromXp - level-up system', () => {
  it('reaches each rank at the cumulative sum of the curve below it', () => {
    expect(totalXpForLevel(1)).toBe(0);
    expect(totalXpForLevel(2)).toBe(100);
    expect(totalXpForLevel(3)).toBe(350);
    expect(totalXpForLevel(4)).toBe(800);
    expect(totalXpForLevel(5)).toBe(1500);

    // Cross-check: the threshold for rank N really is the sum of every price below it.
    expect(totalXpForLevel(7)).toBe(
      xpToAdvance(1) + xpToAdvance(2) + xpToAdvance(3) + xpToAdvance(4) +
      xpToAdvance(5) + xpToAdvance(6)
    );
  });

  it('derives the rank from a lifetime XP total', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(-50)).toBe(1);
    expect(levelFromXp(Number.NaN)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(349)).toBe(2);
    expect(levelFromXp(350)).toBe(3);
    expect(levelFromXp(1499)).toBe(4);
    expect(levelFromXp(1500)).toBe(5);
  });

  it('never decreases as XP grows, and clamps at MAX_LEVEL', () => {
    let previous = 1;
    for (const xp of [0, 1, 99, 100, 350, 800, 10_000, 1_000_000]) {
      const level = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }

    expect(levelFromXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
    expect(levelFromXp(Number.POSITIVE_INFINITY)).toBe(MAX_LEVEL);
  });
});

describe('getLevelProgress - HUD window', () => {
  it('starts a rank with an empty bar', () => {
    const progress = getLevelProgress(0);

    expect(progress).toEqual({
      level: 1,
      xpIntoLevel: 0,
      xpToNextLevel: 100,
      progress: 0,
    });
  });

  it('reports the XP earned inside the current rank', () => {
    const progress = getLevelProgress(150);

    expect(progress.level).toBe(2);
    expect(progress.xpIntoLevel).toBe(50);
    expect(progress.xpToNextLevel).toBe(250);
    expect(progress.progress).toBeCloseTo(0.2);
  });

  it('resets the bar exactly on a rank threshold', () => {
    const progress = getLevelProgress(350);

    expect(progress.level).toBe(3);
    expect(progress.xpIntoLevel).toBe(0);
    expect(progress.progress).toBe(0);
  });

  it('reports a permanently full bar once MAX_LEVEL is reached', () => {
    const progress = getLevelProgress(Number.MAX_SAFE_INTEGER);

    expect(progress.level).toBe(MAX_LEVEL);
    expect(progress.xpToNextLevel).toBe(0);
    expect(progress.progress).toBe(1);
  });
});

describe('getUpgradeCost - upgrade costs', () => {
  it('charges the base price for the first level of a track', () => {
    expect(getUpgradeCost(upgrade('upgrade_thrusters'), 0)).toBe(300);
    expect(getUpgradeCost(upgrade('upgrade_reactive_plating'), 0)).toBe(250);
    expect(getUpgradeCost(upgrade('upgrade_broker_license'), 0)).toBe(400);
    expect(getUpgradeCost(upgrade('upgrade_chrono_manifest'), 0)).toBe(200);
  });

  it('grows geometrically by the track costGrowth, rounded to whole credits', () => {
    const thrusters = upgrade('upgrade_thrusters'); // 300 base, 1.6 growth

    expect(getUpgradeCost(thrusters, 1)).toBe(480); // 300 * 1.6
    expect(getUpgradeCost(thrusters, 2)).toBe(768); // 300 * 1.6^2
    expect(getUpgradeCost(thrusters, 3)).toBe(1229); // 300 * 1.6^3 = 1228.8
    expect(getUpgradeCost(thrusters, 4)).toBe(1966); // 300 * 1.6^4 = 1966.08
  });

  it('returns null once the track is maxed or the input is invalid', () => {
    const thrusters = upgrade('upgrade_thrusters'); // maxLevel 5

    expect(getUpgradeCost(thrusters, thrusters.maxLevel)).toBeNull();
    expect(getUpgradeCost(thrusters, 99)).toBeNull();
    expect(getUpgradeCost(thrusters, -1)).toBeNull();
    expect(getUpgradeCost(thrusters, Number.NaN)).toBeNull();
    expect(getUpgradeCost(undefined, 0)).toBeNull();
    expect(getUpgradeCost(null, 0)).toBeNull();
  });
});

describe('sanitizeUpgradeLevel - untrusted state', () => {
  it('clamps corrupt levels into the track legal range', () => {
    expect(sanitizeUpgradeLevel(undefined, 5)).toBe(0);
    expect(sanitizeUpgradeLevel(Number.NaN, 5)).toBe(0);
    expect(sanitizeUpgradeLevel(-4, 5)).toBe(0);
    expect(sanitizeUpgradeLevel(0, 5)).toBe(0);
    expect(sanitizeUpgradeLevel(2.9, 5)).toBe(2);
    expect(sanitizeUpgradeLevel(99, 5)).toBe(5);
    expect(sanitizeUpgradeLevel(3, 5)).toBe(3);
  });
});

describe('validateUpgrade - upgrade validation', () => {
  it('rejects ids that are not in the catalogue', () => {
    const result = validateUpgrade(state(), undefined);

    expect(result).toEqual({ ok: false, reason: 'unknown-upgrade', cost: 0 });
  });

  it('rejects a track that is already maxed out', () => {
    const profile = state({
      money: 10_000,
      upgrades: { upgrade_thrusters: 5 },
    });

    const result = validateUpgrade(profile, upgrade('upgrade_thrusters'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('max-level');
  });

  it('rejects an unaffordable purchase but still reports the price to pay', () => {
    const thrusters = upgrade('upgrade_thrusters');
    const profile = state({ money: 299 });

    const result = validateUpgrade(profile, thrusters);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('insufficient-funds');
      expect(result.cost).toBe(300);
    }
  });

  it('accepts a purchase when the wallet exactly covers the price', () => {
    const result = validateUpgrade(state({ money: 300 }), upgrade('upgrade_thrusters'));

    expect(result).toEqual({ ok: true, cost: 300 });
  });

  it('prices an owned track from its next level, not from its base cost', () => {
    const profile = state({ money: 5000, upgrades: { upgrade_thrusters: 1 } });

    const result = validateUpgrade(profile, upgrade('upgrade_thrusters'));

    expect(result).toEqual({ ok: true, cost: 480 });
  });
});

describe('computeEffectiveStats - derived player statistics', () => {
  it('returns the stock frame for a profile that owns nothing', () => {
    expect(computeEffectiveStats(state())).toEqual({
      maxHealth: 100,
      speed: 310,
      rewardMultiplier: 1,
      timerBonusSeconds: 0,
    });
  });

  it('applies each upgrade effect additively per owned level', () => {
    const stats = computeEffectiveStats(
      state({
        upgrades: {
          upgrade_thrusters: 2, // +20% speed
          upgrade_reactive_plating: 3, // +90 hull
          upgrade_broker_license: 2, // +0.40× payout
          upgrade_chrono_manifest: 4, // +24s timer
        },
      })
    );

    expect(stats.speed).toBe(372); // round(310 * 1.2)
    expect(stats.maxHealth).toBe(190); // 100 + 90
    expect(stats.rewardMultiplier).toBe(1.4); // 1 + 0.40
    expect(stats.timerBonusSeconds).toBe(24);
  });

  it('caps speed at the frame safety limit however hard the engine is stacked', () => {
    const base = DEFAULT_BASE_STATS;
    const stats = computeEffectiveStats(state({ upgrades: { upgrade_thrusters: 5 } }), {
      base,
      // Custom track whose bonus blows straight past the cap.
      catalog: [
        {
          id: 'upgrade_thrusters',
          category: 'engine',
          name: 'Test',
          description: '',
          maxLevel: 5,
          baseCost: 0,
          costGrowth: 1,
          effect: { speedBonusRatio: 1 },
        },
      ],
    });

    expect(stats.speed).toBe(Math.round(base.speed * (1 + MAX_SPEED_BONUS_RATIO)));
  });

  it('caps the payout multiplier at the global maximum', () => {
    const stats = computeEffectiveStats(state({ upgrades: { upgrade_broker_license: 5 } }), {
      catalog: [
        {
          id: 'upgrade_broker_license',
          category: 'cargo',
          name: 'Test',
          description: '',
          maxLevel: 5,
          baseCost: 0,
          costGrowth: 1,
          effect: { rewardMultiplierBonus: 5 },
        },
      ],
    });

    expect(stats.rewardMultiplier).toBe(MAX_REWARD_MULTIPLIER);
  });

  it('ignores unknown upgrade ids and corrupt levels instead of inflating stats', () => {
    const stats = computeEffectiveStats(
      state({
        upgrades: {
          upgrade_does_not_exist: 99,
          upgrade_thrusters: Number.NaN,
          upgrade_reactive_plating: -10,
        },
      })
    );

    expect(stats).toEqual(computeEffectiveStats(state()));
  });

  it('never reports a hull or speed below 1', () => {
    const stats = computeEffectiveStats(state(), {
      base: { maxHealth: -50, speed: -5, rewardMultiplier: 1, timerBonusSeconds: 0 },
    });

    expect(stats.maxHealth).toBe(1);
    expect(stats.speed).toBe(1);
  });
});

describe('applyRewardMultiplier - delivery payout', () => {
  it('pays base plus time bonus untouched at the neutral 1× multiplier', () => {
    expect(applyRewardMultiplier(120, 40, 1)).toBe(160);
  });

  it('scales base pay and time bonus together, rounding to whole credits', () => {
    expect(applyRewardMultiplier(120, 40, 2)).toBe(320);
    expect(applyRewardMultiplier(105, 0, 1.5)).toBe(158); // 157.5 rounds half-up
    expect(applyRewardMultiplier(95, 0, 1.2)).toBe(114);
    expect(applyRewardMultiplier(0, 0, 3)).toBe(0);
  });

  it('refuses to pay a negative multiplier, and treats non-finite ones as neutral', () => {
    expect(applyRewardMultiplier(100, 0, -2)).toBe(0);
    expect(applyRewardMultiplier(100, 0, Number.NaN)).toBe(100);
    expect(applyRewardMultiplier(100, 0, Number.POSITIVE_INFINITY)).toBe(100);
  });

  it('ignores non-finite or negative components of the payout itself', () => {
    expect(applyRewardMultiplier(Number.NaN, -10, 2)).toBe(0);
    expect(applyRewardMultiplier(50, Number.NaN, 2)).toBe(100);
  });
});



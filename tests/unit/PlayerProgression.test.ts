import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlayerProgression } from '@/game/systems/PlayerProgression';
import { DEFAULT_BASE_STATS, MAX_LEVEL, STARTING_MONEY } from '@/game/types/progression';
import type { PlayerProgressionOptions } from '@/game/systems/PlayerProgression';
import type { ProgressionSnapshot } from '@/game/types/progression';

/**
 * Wraps a profile with a snapshot recorder, standing in for the EventBus bridge the
 * scene would install in production. Every `onChange` fire is captured in order.
 */
function tracked(options: PlayerProgressionOptions = {}): {
  progression: PlayerProgression;
  snapshots: ProgressionSnapshot[];
} {
  const snapshots: ProgressionSnapshot[] = [];
  const progression = new PlayerProgression({
    ...options,
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  return { progression, snapshots };
}

describe('PlayerProgression - construction and snapshot', () => {
  it('starts a fresh courier on the factory profile', () => {
    const { progression, snapshots } = tracked();

    expect(progression.money).toBe(STARTING_MONEY);
    expect(progression.xp).toBe(0);
    expect(progression.level).toBe(1);
    expect(progression.getEffectiveStats()).toEqual(DEFAULT_BASE_STATS);
    expect(snapshots).toHaveLength(0); // construction publishes nothing
  });

  it('mirrors the whole profile as plain data for the UI', () => {
    const { progression } = tracked({
      initialState: { money: 500, xp: 400, upgrades: { upgrade_thrusters: 1 } },
    });

    expect(progression.getSnapshot()).toEqual({
      money: 500,
      xp: 400,
      level: 3, // 400 XP clears rank 3 (threshold 350) but not rank 4 (800)
      xpIntoLevel: 50,
      xpToNextLevel: 450, // xpToAdvance(3)
      levelProgress: 50 / 450,
      maxHealth: DEFAULT_BASE_STATS.maxHealth,
      speed: Math.round(DEFAULT_BASE_STATS.speed * 1.1),
      rewardMultiplier: 1,
      timerBonusSeconds: 0,
      upgrades: { upgrade_thrusters: 1 },
    });
  });

  it('hydrates defensively: corrupt money, XP and upgrade levels are sanitised', () => {
    const { progression } = tracked({
      initialState: {
        money: -500,
        xp: Number.NaN,
        upgrades: {
          upgrade_thrusters: 99, // clamped to maxLevel
          upgrade_reactive_plating: -7, // dropped
          upgrade_ghost: 4, // unknown id, dropped
        },
      },
    });

    expect(progression.money).toBe(0);
    expect(progression.xp).toBe(0);
    expect(progression.getUpgradeLevel('upgrade_thrusters')).toBe(5);
    expect(progression.getUpgradeLevel('upgrade_reactive_plating')).toBe(0);
    expect(progression.getUpgradeLevel('upgrade_ghost')).toBe(0);
    expect(Object.keys(progression.getSnapshot().upgrades)).toEqual(['upgrade_thrusters']);
  });

  it('hands out defensive copies, never the live state object', () => {
    const { progression } = tracked();

    const state = progression.getState();
    state.money = 999_999;
    state.upgrades.upgrade_thrusters = 5;

    expect(progression.money).toBe(STARTING_MONEY);
    expect(progression.getUpgradeLevel('upgrade_thrusters')).toBe(0);
  });
});

describe('PlayerProgression - XP and level-ups', () => {
  it('accumulates XP without ranking up below the threshold', () => {
    const { progression, snapshots } = tracked();

    expect(progression.grantXp(60)).toEqual({
      xpGained: 60,
      previousLevel: 1,
      newLevel: 1,
      levelsGained: 0,
    });
    expect(progression.xp).toBe(60);
    expect(progression.level).toBe(1);
    expect(snapshots).toHaveLength(1);
  });

  it('ranks up the moment XP crosses a threshold', () => {
    const { progression, snapshots } = tracked();

    const result = progression.grantXp(100); // exactly rank 2 (threshold 100)

    expect(result).toEqual({
      xpGained: 100,
      previousLevel: 1,
      newLevel: 2,
      levelsGained: 1,
    });
    expect(progression.level).toBe(2);
    expect(snapshots[0]?.level).toBe(2);
  });

  it('reports every rank crossed by a single large grant', () => {
    const { progression } = tracked();

    // Thresholds: r2=100, r3=350, r4=800, r5=1500 → 1000 XP lands on rank 4.
    const result = progression.grantXp(1000);

    expect(result.newLevel).toBe(4);
    expect(result.levelsGained).toBe(3);
    expect(progression.level).toBe(4);
  });

  it('refuses to grant non-positive or non-finite XP without notifying', () => {
    const { progression, snapshots } = tracked();

    for (const amount of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = progression.grantXp(amount);
      expect(result.xpGained).toBe(0);
      expect(result.levelsGained).toBe(0);
    }
    expect(progression.xp).toBe(0);
    expect(snapshots).toHaveLength(0);
  });

  it('stops ranking at MAX_LEVEL no matter how much XP arrives', () => {
    const { progression } = tracked();

    progression.grantXp(Number.MAX_SAFE_INTEGER);

    expect(progression.level).toBe(MAX_LEVEL);
    expect(progression.getLevelProgress()).toEqual({
      level: MAX_LEVEL,
      xpIntoLevel: expect.any(Number),
      xpToNextLevel: 0,
      progress: 1,
    });
  });
});

describe('PlayerProgression - wallet and delivery payout', () => {
  it('credits money on a delivery and pays the wallet and XP in one notification', () => {
    const { progression, snapshots } = tracked();

    const levelUp = progression.recordDelivery(250, 45);

    expect(progression.money).toBe(STARTING_MONEY + 250);
    expect(progression.xp).toBe(45);
    expect(levelUp.xpGained).toBe(45);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.money).toBe(STARTING_MONEY + 250);
  });

  it('pays money and XP in a single notification even when both change', () => {
    const { progression, snapshots } = tracked({ initialState: { xp: 90 } });

    const levelUp = progression.recordDelivery(50, 10);

    expect(progression.money).toBe(STARTING_MONEY + 50);
    expect(levelUp.newLevel).toBe(2);
    expect(levelUp.levelsGained).toBe(1);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.level).toBe(2);
  });

  it('ignores invalid payouts instead of corrupting the wallet', () => {
    const { progression, snapshots } = tracked();

    expect(progression.grantMoney(-100)).toBe(0);
    expect(progression.grantMoney(Number.NaN)).toBe(0);
    expect(progression.recordDelivery(0, 0).xpGained).toBe(0);

    expect(progression.money).toBe(STARTING_MONEY);
    expect(snapshots).toHaveLength(0);
  });

  it('floors fractional payouts to whole credits and XP', () => {
    const { progression } = tracked();

    progression.recordDelivery(99.9, 44.9);

    expect(progression.money).toBe(STARTING_MONEY + 99);
    expect(progression.xp).toBe(44);
  });
});

describe('PlayerProgression - upgrade purchases', () => {
  it('buys the first level: wallet pays the base cost, track gains a level', () => {
    const { progression, snapshots } = tracked({ initialState: { money: 1000 } });

    const result = progression.purchaseUpgrade('upgrade_thrusters');

    expect(result).toEqual({ ok: true, upgradeId: 'upgrade_thrusters', cost: 300, newLevel: 1 });
    expect(progression.money).toBe(700);
    expect(progression.getUpgradeLevel('upgrade_thrusters')).toBe(1);
    expect(snapshots).toHaveLength(1);
  });

  it('prices each successive level higher, then refuses at max level', () => {
    const { progression } = tracked({ initialState: { money: 100_000 } });

    const costs: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = progression.purchaseUpgrade('upgrade_thrusters');
      if (!result.ok) throw new Error(`purchase ${i} should have succeeded`);
      costs.push(result.cost);
    }

    expect(costs).toEqual([300, 480, 768, 1229, 1966]);

    const refused = progression.purchaseUpgrade('upgrade_thrusters');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('max-level');
  });

  it('rejects an unaffordable purchase and changes nothing', () => {
    const { progression, snapshots } = tracked({ initialState: { money: 299 } });

    const result = progression.purchaseUpgrade('upgrade_thrusters');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('insufficient-funds');
      expect(result.cost).toBe(300);
    }
    expect(progression.money).toBe(299);
    expect(progression.getUpgradeLevel('upgrade_thrusters')).toBe(0);
    expect(snapshots).toHaveLength(0); // a rejection never reaches the UI as a change
  });

  it('rejects unknown upgrade ids', () => {
    const { progression, snapshots } = tracked();

    const result = progression.purchaseUpgrade('upgrade_not_real');

    expect(result).toEqual({ ok: false, reason: 'unknown-upgrade', cost: 0 });
    expect(snapshots).toHaveLength(0);
  });

  it('reports the next price of a track, and null once it is maxed or unknown', () => {
    const { progression } = tracked({ initialState: { money: 10_000 } });

    expect(progression.getNextUpgradeCost('upgrade_reactive_plating')).toBe(250);
    expect(progression.getNextUpgradeCost('upgrade_not_real')).toBeNull();

    // Buying out the whole track removes its next price entirely.
    for (let i = 0; i < 5; i += 1) {
      expect(progression.purchaseUpgrade('upgrade_chrono_manifest').ok).toBe(true);
    }
    expect(progression.getNextUpgradeCost('upgrade_chrono_manifest')).toBeNull();
  });

  it('feeds purchased levels straight into the derived stat block', () => {
    const { progression } = tracked({ initialState: { money: 10_000 } });
    const stock = progression.getEffectiveStats();

    progression.purchaseUpgrade('upgrade_thrusters');
    progression.purchaseUpgrade('upgrade_reactive_plating');
    progression.purchaseUpgrade('upgrade_broker_license');
    progression.purchaseUpgrade('upgrade_chrono_manifest');

    const upgraded = progression.getEffectiveStats();
    expect(upgraded.speed).toBe(Math.round(stock.speed * 1.1));
    expect(upgraded.maxHealth).toBe(stock.maxHealth + 30);
    expect(upgraded.rewardMultiplier).toBeCloseTo(1.2);
    expect(upgraded.timerBonusSeconds).toBe(stock.timerBonusSeconds + 6);
  });
});

describe('PlayerProgression - reset', () => {
  it('restores the factory profile after earnings and purchases', () => {
    const { progression, snapshots } = tracked({ initialState: { money: 5000 } });

    progression.recordDelivery(400, 300);
    progression.purchaseUpgrade('upgrade_thrusters');
    expect(progression.money).not.toBe(5000);

    snapshots.length = 0;
    progression.reset();

    expect(progression.money).toBe(5000); // baseline = construction profile
    expect(progression.xp).toBe(0);
    expect(progression.level).toBe(1);
    expect(progression.getUpgradeLevel('upgrade_thrusters')).toBe(0);
    expect(progression.getEffectiveStats()).toEqual(DEFAULT_BASE_STATS);
    expect(snapshots).toHaveLength(1);
  });

  it('starts a default instance from the factory defaults', () => {
    const { progression } = tracked();

    progression.recordDelivery(900, 900);
    progression.reset();

    expect(progression.money).toBe(STARTING_MONEY);
    expect(progression.xp).toBe(0);
    expect(progression.getState().upgrades).toEqual({});
  });
});

describe('PlayerProgression - engine independence', () => {
  const engineFreeFiles = [
    'src/game/types/progression.ts',
    'src/game/data/upgradeData.ts',
    'src/game/systems/ProgressionMath.ts',
    'src/game/systems/PlayerProgression.ts',
  ];

  it('imports nothing from React, Phaser, Next or the EventBus bridge', () => {
    for (const relativePath of engineFreeFiles) {
      const absolutePath = fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
      const source = readFileSync(absolutePath, 'utf8');

      expect(source, `${relativePath} must stay engine-independent`).not.toMatch(
        /from ['"][^'"]*(phaser|react|next|zustand|EventBus)/i
      );
    }
  });
});



import { describe, it, expect } from 'vitest';
import {
  computeTimeRatio,
  computeTimeBonus,
  computeDeliveryAward,
  computeScore,
  findPackage,
  TIME_BONUS_RATE,
  XP_SCORE_WEIGHT,
} from '@/lib/scoring/delivery';
import { validateDeliverySubmission, MAX_DELIVERY_DURATION_SECONDS } from '@/lib/validation';
import { PACKAGE_CATALOG } from '@/game/data/deliveryData';

/**
 * The client-side mirror of the server's pricing function.
 *
 * These tests have two jobs: they prove the maths, and — just as importantly —
 * they pin the constants so a change here cannot silently drift from the SQL in
 * `20260928120000_leaderboard.sql`. A mismatch is a *consistency* bug (the HUD
 * shows one number, the board records another), never a security one, because
 * nothing computed here is trusted downstream.
 */

const neuralChip = findPackage('pkg_neural_chip')!; // base 120 credits, 45 xp

describe('computeTimeRatio', () => {
  it('returns 1 for a delivery completed instantly', () => {
    expect(computeTimeRatio(30, 30)).toBe(1);
  });

  it('returns 0 when the timer is exhausted', () => {
    expect(computeTimeRatio(0, 30)).toBe(0);
  });

  it('is proportional in between', () => {
    expect(computeTimeRatio(15, 30)).toBeCloseTo(0.5, 10);
  });

  it('clamps a negative remainder to 0 and an over-limit one to 1', () => {
    expect(computeTimeRatio(-5, 30)).toBe(0);
    expect(computeTimeRatio(45, 30)).toBe(1);
  });

  it('returns 0 for a zero/negative time limit rather than dividing by it', () => {
    expect(computeTimeRatio(10, 0)).toBe(0);
    expect(computeTimeRatio(10, -1)).toBe(0);
  });

  it('returns 0 for non-finite inputs instead of propagating NaN', () => {
    expect(computeTimeRatio(Number.NaN, 30)).toBe(0);
    expect(computeTimeRatio(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('computeTimeBonus', () => {
  it('pays half the base for a perfect run', () => {
    expect(TIME_BONUS_RATE).toBe(0.5);
    expect(computeTimeBonus(120, 1)).toBe(60);
  });

  it('pays nothing at zero elapsed time, and clamps an out-of-range ratio', () => {
    expect(computeTimeBonus(120, 0)).toBe(0);
    expect(computeTimeBonus(120, 5)).toBe(computeTimeBonus(120, 1));
    expect(computeTimeBonus(120, -1)).toBe(0);
  });

  it('rounds to an integer (100 * 0.5 * 0.33 = 16.5 -> 17)', () => {
    expect(computeTimeBonus(100, 0.33)).toBe(17);
    expect(Number.isInteger(computeTimeBonus(95, 0.71))).toBe(true);
  });

  it('never pays a bonus on a zero-value package', () => {
    expect(computeTimeBonus(0, 1)).toBe(0);
  });
});

describe('computeScore', () => {
  it('weights XP double, matching the generated SQL column', () => {
    expect(XP_SCORE_WEIGHT).toBe(2);
    expect(computeScore(500, 80)).toBe(660);
    expect(computeScore(0, 0)).toBe(0);
  });

  it('floors fractional inputs to match integer SQL arithmetic', () => {
    expect(computeScore(100.9, 45.5)).toBe(190);
  });

  it('never goes negative, even for hostile input', () => {
    expect(computeScore(-10, -5)).toBe(0);
    expect(computeScore(Number.NaN, Number.NaN)).toBe(0);
  });
});

describe('computeDeliveryAward', () => {
  it('pays base + full time bonus at 1x', () => {
    const award = computeDeliveryAward(neuralChip, 1, 1);
    expect(award.timeBonus).toBe(60);
    expect(award.credits).toBe(180);
    expect(award.xp).toBe(45);
    expect(award.score).toBe(270);
  });

  it('pays base only when the timer is exhausted', () => {
    expect(computeDeliveryAward(neuralChip, 0, 1).credits).toBe(120);
  });

  it('applies the payout multiplier to base AND bonus', () => {
    expect(computeDeliveryAward(neuralChip, 1, 2).credits).toBe(360); // (120+60)*2
  });

  it('never multiplies XP — rank pacing must be build-independent', () => {
    expect(computeDeliveryAward(neuralChip, 1, 3).xp).toBe(
      computeDeliveryAward(neuralChip, 1, 1).xp
    );
  });

  it('is monotonic in the time ratio', () => {
    // The property the server relies on: even a maximally-forged ratio lands
    // inside the range a real run would have earned.
    let previous = 0;
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      const credits = computeDeliveryAward(neuralChip, ratio, 1).credits;
      expect(credits).toBeGreaterThanOrEqual(previous);
      previous = credits;
    }
  });

  it('scales with package value', () => {
    const best = PACKAGE_CATALOG.reduce((a, b) =>
      b.baseRewardCredits > a.baseRewardCredits ? b : a
    );
    const cheap = PACKAGE_CATALOG.reduce((a, b) =>
      b.baseRewardCredits < a.baseRewardCredits ? b : a
    );
    expect(computeDeliveryAward(best, 1, 1).credits).toBeGreaterThan(
      computeDeliveryAward(cheap, 1, 1).credits
    );
  });

  it('falls back to a neutral multiplier for a non-finite one', () => {
    expect(computeDeliveryAward(neuralChip, 1, Number.NaN).credits).toBe(
      computeDeliveryAward(neuralChip, 1, 1).credits
    );
  });
});

describe('findPackage', () => {
  it('resolves every catalog id, and refuses an unknown one', () => {
    for (const def of PACKAGE_CATALOG) {
      expect(findPackage(def.id)?.id).toBe(def.id);
    }
    expect(findPackage('pkg_diamond_million')).toBeNull();
    expect(findPackage('')).toBeNull();
  });
});

describe('validateDeliverySubmission', () => {
  const valid = {
    status: 'completed' as const,
    packageId: 'pkg_neural_chip',
    timeRatio: 0.75,
    durationSeconds: 22.5,
  };

  it('accepts a well-formed submission', () => {
    const result = validateDeliverySubmission(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.claimedCredits).toBe(0);
  });

  it('rejects a non-object body', () => {
    for (const bad of [null, 'x', 7, []]) {
      expect(validateDeliverySubmission(bad).ok).toBe(false);
    }
  });

  it('requires a packageId — the one input the server cannot infer', () => {
    expect(validateDeliverySubmission({ ...valid, packageId: undefined }).ok).toBe(false);
    expect(validateDeliverySubmission({ ...valid, packageId: '' }).ok).toBe(false);
    expect(validateDeliverySubmission({ ...valid, packageId: 'BAD ID!' }).ok).toBe(false);
  });

  it('rejects a timeRatio outside 0..1 but accepts the boundaries', () => {
    expect(validateDeliverySubmission({ ...valid, timeRatio: 1.5 }).ok).toBe(false);
    expect(validateDeliverySubmission({ ...valid, timeRatio: -0.1 }).ok).toBe(false);
    expect(validateDeliverySubmission({ ...valid, timeRatio: Number.NaN }).ok).toBe(false);
    expect(validateDeliverySubmission({ ...valid, timeRatio: 0 }).ok).toBe(true);
    expect(validateDeliverySubmission({ ...valid, timeRatio: 1 }).ok).toBe(true);
  });

  it('bounds the duration', () => {
    expect(validateDeliverySubmission({ ...valid, durationSeconds: -1 }).ok).toBe(false);
    expect(
      validateDeliverySubmission({ ...valid, durationSeconds: MAX_DELIVERY_DURATION_SECONDS }).ok
    ).toBe(true);
    expect(
      validateDeliverySubmission({
        ...valid,
        durationSeconds: MAX_DELIVERY_DURATION_SECONDS + 1,
      }).ok
    ).toBe(false);
  });

  it('carries NO credits or xp slot — the point of the redesign', () => {
    // A client may send anything extra; the validated shape has nowhere to put an
    // award, so nothing downstream can read one.
    const result = validateDeliverySubmission({ ...valid, credits: 999_999, xp: 999_999 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty('credits');
      expect(result.value).not.toHaveProperty('xp');
    }
  });

  it('records claimedCredits for fraud analytics, clamped to >= 0', () => {
    const result = validateDeliverySubmission({ ...valid, claimedCredits: -50 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.claimedCredits).toBe(0);
  });
});

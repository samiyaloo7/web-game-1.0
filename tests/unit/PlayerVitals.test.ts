import { describe, expect, it } from 'vitest';
import { PlayerVitals } from '@/game/systems/PlayerVitals';

/** A hull configured small so a test can kill it without hundreds of hits. */
function vitals(maxHealth = 100, invulnerabilitySeconds = 1.25): PlayerVitals {
  return new PlayerVitals({ maxHealth, invulnerabilitySeconds });
}

/** Ticks the shield window out so the next hit is allowed to land. */
function recharge(state: PlayerVitals, deltaSeconds = 1.5): void {
  state.update(deltaSeconds);
}

describe('PlayerVitals - damage', () => {
  it('starts at full hull', () => {
    const state = vitals();

    expect(state.health).toBe(100);
    expect(state.maxHealth).toBe(100);
    expect(state.isDead).toBe(false);
    expect(state.isInvulnerable).toBe(false);
    expect(state.getState().healthRatio).toBe(1);
  });

  it('applies a landed hit and opens the shield window', () => {
    const state = vitals();

    const result = state.applyDamage(18);

    expect(result.applied).toBe(true);
    expect(result.amount).toBe(18);
    expect(result.remainingHealth).toBe(82);
    expect(result.isDead).toBe(false);
    expect(state.health).toBe(82);
    expect(state.isInvulnerable).toBe(true);
    expect(state.getState().healthRatio).toBeCloseTo(0.82);
  });

  it('absorbs a second hit while the shield window is open', () => {
    const state = vitals();
    state.applyDamage(18);

    const blocked = state.applyDamage(18);

    expect(blocked.applied).toBe(false);
    expect(blocked.amount).toBe(0);
    expect(state.health).toBe(82);
  });

  it('lets the next hit through once the window has expired', () => {
    const state = vitals();
    state.applyDamage(18);
    recharge(state);

    expect(state.isInvulnerable).toBe(false);

    const second = state.applyDamage(18);

    expect(second.applied).toBe(true);
    expect(state.health).toBe(64);
  });

  it('never lets the hull go negative', () => {
    const state = vitals(40);

    const result = state.applyDamage(999);

    expect(result.applied).toBe(true);
    expect(result.remainingHealth).toBe(0);
    expect(state.health).toBe(0);
    expect(state.isDead).toBe(true);
  });

  it('ignores non-positive and non-finite damage', () => {

describe('PlayerVitals - death', () => {
  it('reports death on the killing hit and refuses further damage', () => {
    const state = vitals(30);

    const killing = state.applyDamage(30);
    expect(killing.applied).toBe(true);
    expect(killing.isDead).toBe(true);
    expect(state.isDead).toBe(true);

    const after = state.applyDamage(10);
    expect(after.applied).toBe(false);
    expect(after.remainingHealth).toBe(0);
    expect(state.health).toBe(0);
  });

  it('cannot be revived by healing', () => {
    const state = vitals(30);
    state.applyDamage(30);

    expect(state.heal(50)).toBe(0);
    expect(state.health).toBe(0);
    expect(state.isDead).toBe(true);
  });

  it('a wrecked hull still reports a clean dead snapshot for the HUD', () => {
    const state = vitals(50);
    state.applyDamage(50);

    const snapshot = state.getState();
    expect(snapshot.health).toBe(0);
    expect(snapshot.maxHealth).toBe(50);
    expect(snapshot.healthRatio).toBe(0);
    expect(snapshot.isDead).toBe(true);
  });
});

describe('PlayerVitals - healing', () => {
  it('repairs up to, but never past, the hull maximum', () => {
    const state = vitals(100);
    state.applyDamage(50);
    recharge(state);

    expect(state.heal(30)).toBe(30);
    expect(state.health).toBe(80);

    expect(state.heal(1000)).toBe(20);
    expect(state.health).toBe(100);
    expect(state.getState().healthRatio).toBe(1);
  });

  it('ignores non-positive healing', () => {
    const state = vitals();
    state.applyDamage(40);
    recharge(state);

    expect(state.heal(0)).toBe(0);
    expect(state.heal(-10)).toBe(0);
    expect(state.health).toBe(60);
  });
});

describe('PlayerVitals - shield window', () => {
  it('ticks the window down only on positive deltas', () => {
    const state = vitals(100, 1);
    state.applyDamage(10);

    state.update(0);
    expect(state.isInvulnerable).toBe(true);

    state.update(-5);
    expect(state.isInvulnerable).toBe(true);

    state.update(0.4);
    expect(state.isInvulnerable).toBe(true);

    state.update(0.7);
    expect(state.isInvulnerable).toBe(false);
  });

  it('never runs the window below zero', () => {
    const state = vitals();
    state.applyDamage(10);
    state.update(999);

    expect(state.isInvulnerable).toBe(false);
    expect(state.getState().invulnerable).toBe(false);
  });
});

describe('PlayerVitals - reset', () => {
  it('repairs fully and clears the shield window for a restarted run', () => {
    const state = vitals(100);
    state.applyDamage(90);
    expect(state.health).toBe(10);

    state.reset();

    expect(state.health).toBe(100);
    expect(state.isDead).toBe(false);
    expect(state.isInvulnerable).toBe(false);
    expect(state.getState().healthRatio).toBe(1);
  });

  it('starts a fresh instance with the configured maximum, not the default', () => {
    const state = vitals(250);

    expect(state.maxHealth).toBe(250);
    expect(state.health).toBe(250);
    expect(state.getState().maxHealth).toBe(250);
  });
});

    const state = vitals();

    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = state.applyDamage(amount);
      expect(result.applied).toBe(false);
      expect(state.health).toBe(100);
    }
  });
});

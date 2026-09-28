import { describe, it, expect } from 'vitest';
import {
  fromProgressRow,
  toProgressPayload,
  sanitizeStoredUpgrades,
  MAX_PERSISTED_MONEY,
  MAX_PERSISTED_XP,
} from '@/lib/progression/mapping';
import { STARTING_MONEY } from '@/game/types/progression';

/**
 * The database boundary. These functions translate a `player_progress` row into
 * the game's `ProgressionState` and back again, so they are the place where a
 * hostile or corrupt row would first be clamped. The SQL CHECK constraints and
 * the `save_player_progress` RPC re-enforce the same bounds server-side — this
 * layer exists so a bad row can never reach `PlayerProgression` in the first
 * place, and so the round-trip is provably lossless for legitimate data.
 */

describe('toProgressPayload', () => {
  it('passes through valid state unchanged', () => {
    const state = { money: 5000, xp: 12_000, upgrades: { upgrade_thrusters: 3 } };
    expect(toProgressPayload(state)).toEqual({
      p_money: 5000,
      p_xp: 12_000,
      p_upgrades: { upgrade_thrusters: 3 },
    });
  });

  it('drops level-0 upgrades so the jsonb stays minimal', () => {
    const result = toProgressPayload({
      money: 0,
      xp: 0,
      upgrades: { upgrade_thrusters: 2, upgrade_reactive_plating: 0 },
    });
    expect(result.p_upgrades).toEqual({ upgrade_thrusters: 2 });
  });

  it('returns an empty object when nothing is owned', () => {
    expect(toProgressPayload({ money: 100, xp: 0, upgrades: {} }).p_upgrades).toEqual({});
  });

  it('clamps to the same bounds the CHECK constraints use', () => {
    const result = toProgressPayload({
      money: MAX_PERSISTED_MONEY + 1,
      xp: MAX_PERSISTED_XP + 1,
      upgrades: {},
    });
    expect(result.p_money).toBe(MAX_PERSISTED_MONEY);
    expect(result.p_xp).toBe(MAX_PERSISTED_XP);
  });

  it('never emits a negative or fractional value', () => {
    const result = toProgressPayload({ money: -50, xp: 10.9, upgrades: {} });
    expect(result.p_money).toBe(0);
    expect(result.p_xp).toBe(10);
  });

  it('falls back to the starting balance for non-finite money', () => {
    expect(toProgressPayload({ money: Number.NaN, xp: 0, upgrades: {} }).p_money).toBe(
      STARTING_MONEY
    );
    expect(toProgressPayload({ money: Number.POSITIVE_INFINITY, xp: 0, upgrades: {} }).p_money).toBe(
      STARTING_MONEY
    );
  });
});

describe('fromProgressRow', () => {
  it('reads a legitimate row', () => {
    const state = fromProgressRow({ money: 5000, xp: 12_000, upgrades: { upgrade_thrusters: 3 } });
    expect(state).toEqual({ money: 5000, xp: 12_000, upgrades: { upgrade_thrusters: 3 } });
  });

  it('defaults a null upgrades column to an empty object', () => {
    expect(fromProgressRow({ money: 0, xp: 0, upgrades: null }).upgrades).toEqual({});
  });

  it('clamps a row whose values exceed the column bounds', () => {
    const state = fromProgressRow({
      money: 9_999_999_999,
      xp: 9_999_999_999,
      upgrades: {},
    });
    expect(state.money).toBe(MAX_PERSISTED_MONEY);
    expect(state.xp).toBe(MAX_PERSISTED_XP);
  });

  it('floors fractional values (Postgres would have rounded, but be explicit)', () => {
    const state = fromProgressRow({ money: 100.9, xp: 50.7, upgrades: {} });
    expect(state.money).toBe(100);
    expect(state.xp).toBe(50);
  });

  it('recovers from negative values rather than propagating them', () => {
    const state = fromProgressRow({ money: -100, xp: -50, upgrades: {} });
    expect(state.money).toBe(0);
    expect(state.xp).toBe(0);
  });

  it('substitutes the starting balance for non-finite money', () => {
    const state = fromProgressRow({ money: Number.NaN, xp: 0, upgrades: {} });
    expect(state.money).toBe(STARTING_MONEY);
  });

  it('round-trips a valid state without loss', () => {
    const state = { money: 4321, xp: 9876, upgrades: { upgrade_broker_license: 4 } };
    // The real cycle is state → RPC payload → stored row → state. The payload and
    // the row use different column names (p_* vs the table's), so the round-trip
    // is spelled out rather than passing one function's output to the other.
    const payload = toProgressPayload(state);
    const storedRow = { money: payload.p_money, xp: payload.p_xp, upgrades: payload.p_upgrades };

    expect(fromProgressRow(storedRow)).toEqual(state);
  });
});

describe('sanitizeStoredUpgrades', () => {
  it('keeps only positive integers', () => {
    const result = sanitizeStoredUpgrades({
      good: 3,
      zero: 0,
      negative: -2,
      fractional: 1.5,
      text: '2' as unknown as number,
      missing: undefined as unknown as number,
    });
    expect(result).toEqual({ good: 3 });
  });

  it('returns an empty object for null or a non-object', () => {
    expect(sanitizeStoredUpgrades(null)).toEqual({});
    expect(sanitizeStoredUpgrades([] as unknown as Record<string, number>)).toEqual({});
  });

  it('does not itself enforce the per-track maximum (the RPC does that)', () => {
    // Kept deliberately: a level of 9 is nonsense, but it is the catalogue-aware
    // `PlayerProgression` sanitiser's job to clamp it, not this transport layer.
    expect(sanitizeStoredUpgrades({ upgrade_thrusters: 9 })).toEqual({ upgrade_thrusters: 9 });
  });
});

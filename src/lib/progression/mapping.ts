import { STARTING_MONEY } from '@/game/types/progression';
import type { ProgressionState } from '@/game/types/progression';

/**
 * Pure translation between the database row and the game's progression state.
 *
 * No Supabase, no React — which means the *rules* about what a valid persisted
 * profile looks like are unit-testable in plain Node, and the same mapping runs
 * identically on the server (SSR load) and the client (re-validation before
 * save). The database enforces its own CHECK constraints too; this layer is
 * the *friendly* gate, the SQL is the hard one.
 */

/** Upper bound mirrored from `player_progress_money_range`. */
export const MAX_PERSISTED_MONEY = 100_000_000;

/** Upper bound mirrored from `player_progress_xp_range`. */
export const MAX_PERSISTED_XP = 1_000_000_000;

/** Shape of a `player_progress` row as it comes back over the wire. */
export interface ProgressRowLike {
  money: number;
  xp: number;
  upgrades: Record<string, number> | null;
}

function clampInt(value: unknown, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

/**
 * Builds the payload for the `save_player_progress` RPC from authoritative game
 * state. The database still re-validates everything — this only avoids sending
 * a request that is guaranteed to be rejected.
 */
export function toProgressPayload(state: ProgressionState): {
  p_money: number;
  p_xp: number;
  p_upgrades: Record<string, number>;
} {
  return {
    p_money: clampInt(state.money, MAX_PERSISTED_MONEY, STARTING_MONEY),
    p_xp: clampInt(state.xp, MAX_PERSISTED_XP, 0),
    // Only owned levels are stored; a level of 0 is the absence of a key, which
    // keeps the jsonb small and matches `sanitizeUpgrades` on the game side.
    p_upgrades: Object.fromEntries(
      Object.entries(state.upgrades).filter(([, level]) => level > 0),
    ),
  };
}

/**
 * Rebuilds game state from a persisted row.
 *
 * `PlayerProgression`'s constructor sanitises this again via `initialState`, so
 * double-guarding is deliberate: this is the untrusted-network boundary, and the
 * game system must stay safe even if a future caller forgets to map first.
 */
export function fromProgressRow(row: ProgressRowLike): ProgressionState {
  return {
    money: clampInt(row.money, MAX_PERSISTED_MONEY, STARTING_MONEY),
    xp: clampInt(row.xp, MAX_PERSISTED_XP, 0),
    upgrades: sanitizeStoredUpgrades(row.upgrades),
  };
}

/** Drops null/NaN/negative/non-integer levels, keeping the object's positive entries. */
export function sanitizeStoredUpgrades(raw: Record<string, number> | null): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const upgrades: Record<string, number> = {};
  for (const [id, level] of Object.entries(raw)) {
    if (typeof level !== 'number' || !Number.isInteger(level) || level <= 0) continue;
    upgrades[id] = level;
  }
  return upgrades;
}

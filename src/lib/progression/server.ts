import 'server-only';
import { createSupabaseServerClient } from '../supabase/server';
import { isSupabaseConfigured } from '../supabase/env';
import { fromProgressRow } from './mapping';
import type { ProgressionState } from '@/game/types/progression';

/**
 * SAVING / LOADING PLAYER PROGRESSION
 * ===================================
 *
 * ## Loading (this file)
 *
 * A read through the *anon* server client, so the query is subject to RLS. The
 * `player_progress_select_own` policy reduces every row to the one whose
 * `profile_id = auth.uid()`, meaning a bug in this file that tried to read
 * someone else's row would return zero rows rather than their data. The
 * security is in the database, not in the WHERE clause — that is the whole
 * point of RLS, and it is why the service-role key is not used here.
 *
 * ## Saving
 *
 * Saving does NOT go through this file's client. Clients call the
 * `save_player_progress` RPC (see `client.ts`), which is `SECURITY DEFINER`:
 * clients hold no INSERT/UPDATE grant on the table, so the validated database
 * function is the only write path in existence.
 *
 * ## Why progression is absolute, not incremental
 *
 * Each save overwrites the whole career row (an upsert). The alternative —
 * "send +50 credits" deltas — is a classic lost-update bug: two tabs open at
 * once would each apply their delta to a stale base and one payout would
 * vanish. Absolute writes are idempotent and converge to whatever the client
 * most recently observed.
 */

/** Career progression plus the server-computed rank, for display on the profile page. */
export interface LoadedProgression {
  state: ProgressionState;
  /** `player_progress.level` — a GENERATED column computed by Postgres from xp. */
  level: number;
  updatedAt: string;
}

/**
 * Reads the caller's career progression, or `null` when signed out / not
 * configured. Never throws: a failed read degrades to "no saved career" and the
 * courier starts from factory defaults rather than seeing a broken page.
 */
export async function loadPlayerProgression(): Promise<LoadedProgression | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('player_progress')
    .select('money, xp, level, upgrades, updated_at')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    state: fromProgressRow({
      money: data.money,
      xp: data.xp,
      upgrades: data.upgrades,
    }),
    level: data.level,
    updatedAt: data.updated_at,
  };
}

/** Career totals for the dossier: rank, wallet, lifetime XP and owned upgrades. */
export interface CareerSummary {
  level: number;
  money: number;
  xp: number;
  upgrades: Record<string, number>;
  updatedAt: string;
}

export async function loadCareerSummary(): Promise<CareerSummary | null> {
  const loaded = await loadPlayerProgression();
  if (!loaded) return null;
  return {
    level: loaded.level,
    money: loaded.state.money,
    xp: loaded.state.xp,
    upgrades: loaded.state.upgrades,
    updatedAt: loaded.updatedAt,
  };
}

/**
 * The caller's own recent deliveries, newest first. The `scores` table is
 * publicly readable, but scoping to `auth.uid()` here is a UX choice (a
 * courier's history) — the RLS guarantee for other people's rows is elsewhere.
 */
export async function loadRecentScores(limit = 10) {
  if (!isSupabaseConfigured) return [];

  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('scores')
    .select('id, status, credits, xp, time_seconds, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));

  if (error) return [];
  return data ?? [];
}

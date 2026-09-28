'use client';

import { getSupabaseBrowserClient } from '../supabase/browser';
import { isSupabaseConfigured } from '../supabase/env';
import { toProgressPayload } from './mapping';
import { mapAuthError } from '../auth/errors';
import type { ProgressionState } from '@/game/types/progression';

/**
 * CLIENT-SIDE PROGRESSION SYNC
 * ============================
 *
 * ## How a save actually works
 *
 * `supabase.rpc('save_player_progress', ...)` is not a raw table write. It calls
 * a `SECURITY DEFINER` PostgreSQL function, which means the write executes with
 * the *function owner's* privileges. That is what lets it insert and update rows
 * that the client role has no grant for and that RLS has no write policy for.
 * Every client can therefore reach exactly one write path, and all of the
 * validation (money/XP ranges, upgrade ids, level bounds, and crucially "which
 * row is mine" via `auth.uid()`) lives in one auditable SQL function instead of
 * being scattered across permissive policies.
 *
 * ## Why the browser key is safe for this
 *
 * The anon key identifies the *role*, not the person. RLS plus the RPC's
 * `auth.uid()` check are what bind the write to the caller's own row. A tampered
 * request can only ever change the caller's own career.
 */

export type SaveResult =
  | { ok: true; level: number; updatedAt: string }
  | { ok: false; error: string };

/**
 * Persists the caller's career progression.
 *
 * Absolute write, not a delta — see `server.ts` for why. Failures are returned
 * rather than thrown: a courier who loses connectivity should keep playing on
 * the in-memory profile, not crash the game loop.
 */
export async function savePlayerProgression(state: ProgressionState): Promise<SaveResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Offline: progress is not being saved.' };
  }

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('save_player_progress', toProgressPayload(state));

    if (error) {
      return { ok: false, error: mapAuthError(error).message };
    }
    if (!data) {
      return { ok: false, error: 'Save returned no progression row.' };
    }

    return { ok: true, level: data.level, updatedAt: data.updated_at };
  } catch (error) {
    return { ok: false, error: mapAuthError(error).message };
  }
}

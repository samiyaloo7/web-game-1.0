import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, isSupabaseConfigured } from './env';
import type { Database } from './database';

export type SupabaseServiceClient = SupabaseClient<Database>;

/**
 * SERVICE-ROLE client — the RLS bypass.
 *
 * The service key authenticates as postgres-level `service_role`: every table
 * grant and every RLS policy is ignored. A leaked service key means anyone can
 * read and rewrite the entire database, so the rules here are absolute:
 *
 *   1. The variable has NO `NEXT_PUBLIC_` prefix → Next.js never inlines it
 *      into the client bundle; it only exists in the Node server runtime.
 *   2. This module must only ever be imported from Route Handlers / server
 *      code. The runtime guard below turns an accidental client import into a
 *      loud failure instead of a silent leak (the `server-only` package can add
 *      a build-time guarantee on top).
 *   3. Anything written through this client is unchecked by RLS — which is why
 *      `/api/scores` derives `profile_id` from the verified session, never
 *      from the request body.
 *
 * Auth is disabled (no JWT, no refresh loop): this is a database credential,
 * not a user session.
 */
export function createSupabaseServiceClient(): SupabaseServiceClient {
  if (typeof window !== 'undefined') {
    throw new Error('Service-role client must never be constructed in the browser');
  }
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured (missing NEXT_PUBLIC_* env vars)');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set on the server');
  }

  return createClient<Database>(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}


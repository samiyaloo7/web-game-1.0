import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env';
import type { Database } from './database';

let client: SupabaseClient<Database> | null = null;

/**
 * Singleton browser client (anon key + RLS). Callers must gate on
 * `isSupabaseConfigured` first; this throws on misuse so a missing guard fails
 * loudly instead of silently creating a client pointed at an empty URL.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured (missing NEXT_PUBLIC_* env vars)');
  }
  client ??= createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

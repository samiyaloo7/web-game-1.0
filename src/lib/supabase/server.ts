import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env';
import type { Database } from './database';

/**
 * Request-scoped server client (anon key + the caller's cookies + RLS).
 *
 * NEVER share the returned client between requests — one per request is what
 * keeps sessions from bleeding across users. `cookies()` is async in this Next
 * version. `setAll` may legitimately fail inside Server Components (cookies are
 * read-only there); @supabase/ssr documents swallowing that case because the
 * `src/proxy.ts` refresh handler writes rotated tokens from the edge of the
 * request instead.
 *
 * Returns `null` when Supabase is not configured so callers can degrade
 * gracefully instead of throwing during prerender.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database> | null> {
  if (!isSupabaseConfigured) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Read-only cookie context (Server Component render) — safe to ignore.
        }
      },
    },
  });
}

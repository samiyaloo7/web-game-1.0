import 'server-only';
import { cache } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '../supabase/server';
import { isSupabaseConfigured } from '../supabase/env';
import type { AuthUser } from './types';
import type { Database } from '../supabase/database';

/**
 * CURRENT-USER HANDLING
 * =====================
 *
 * ## Why `getUser()` and not `getSession()`
 *
 * `getSession()` reads the JWT out of the cookie and decodes it *without*
 * contacting the server. That makes it fast, but it means the browser is
 * effectively asserting who the user is — the token is only as trustworthy as
 * the cookie jar. `getUser()` re-validates the token with the Auth server on
 * every call and returns the user record the database has, so a tampered or
 * revoked token fails closed. The Supabase docs are explicit: use `getSession()`
 * for optimistic client UI, `getUser()` for anything that decides access.
 *
 * ## Why the RLS policy is the real check
 *
 * Verifying a session proves *who* is calling; it does not by itself decide
 * *what they may touch*. That job belongs to Row Level Security, which is
 * evaluated by Postgres on every query and cannot be bypassed by a client.
 * The two are complementary: this module authenticates, RLS authorises.
 *
 * ## Why `cache()` is safe here
 *
 * `cache()` dedupes the call across one render pass, so a layout, a page and
 * three server components asking "who is the user?" produce a single network
 * round-trip. The cache is scoped to the request in React's server runtime —
 * it is *not* a module-level variable, so one user's identity can never bleed
 * into another user's render.
 */

/** Resolves the signed-in user, or `null`. Never throws. */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const user = await verifyUser(supabase);
  if (!user) return null;

  // The `profiles` row is created by the `on_auth_user_created` trigger, so it
  // exists for every account. The fallback only covers the rare case where a
  // signup predates the migration.
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  return toAuthUser(user, profile?.username ?? `courier_${user.id.slice(0, 8)}`);
});

/** Raw JWT verification. Split out so other server code can reuse the check. */
export async function verifyUser(supabase: SupabaseClient<Database>): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

/** Projected public identity. The password hash and every other auth column are dropped. */
export function toAuthUser(user: User, username: string): AuthUser {
  return {
    id: user.id,
    email: user.email ?? '',
    username,
    createdAt: user.created_at ?? '',
  };
}

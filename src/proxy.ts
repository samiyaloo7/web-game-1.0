import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from '@/lib/supabase/env';
import type { Database } from '@/lib/supabase/database';

/**
 * Next.js 16 renamed Middleware → Proxy (same functionality, `src/proxy.ts`).
 *
 * Its single job here is SESSION REFRESH: Supabase access tokens live ~1h and
 * are stored in cookies, so before each page render this handler lets
 * @supabase/ssr rotate an expired access token and write the new cookies onto
 * the response. `getSession()` refreshes only when the token is actually
 * expired (it validates against local cookie state), so the steady state costs
 * zero network round-trips.
 *
 * Deliberately NOT an authorization layer: the docs are explicit that Proxy is
 * for optimistic checks only. Real permission checks happen where data is read
 * — `auth.getUser()` in server components/route handlers, and RLS in the DB.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        // Mirror rotated tokens onto BOTH the request (so this handler's later
        // reads see them) and the response (so the browser stores them).
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Touch the session: refreshes an expired access token if needed.
  await supabase.auth.getSession();

  return response;
}

/** Run on everything except static assets — those carry no cookies worth refreshing. */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

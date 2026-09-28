'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { signIn, signOut, signUp, getSessionUser } from '@/lib/auth/actions';
import type { AuthUser } from '@/lib/auth/types';

/**
 * REACT SIDE OF AUTHENTICATION
 * ============================
 *
 * ## The two-layer model
 *
 * Supabase has no "auth context" — sessions live in cookies and are read with
 * the browser client. This provider is a thin React-shaped wrapper that:
 *
 *   1. Reads the session once on mount and republishes it on every change
 *      (`onAuthStateChange`), so React components re-render when the user
 *      signs in or out.
 *   2. Fetches the *profile* (username) from the server via the `getSessionUser`
 *      server action, because that is the only call that verifies the JWT with
 *      the Auth server rather than trusting the local cookie.
 *
 * ## Why sign-in still goes through Server Actions
 *
 * This provider calls `signIn`/`signUp`/`signOut` — the server actions — rather
 * than the browser client's auth methods. That keeps cookie writes server-side
 * (httpOnly) as described in `actions.ts`. The browser client is used here only
 * for *observing* the session, never for authenticating.
 *
 * ## What this component is NOT
 *
 * It is not a security boundary. It is a convenience for rendering. Every
 * protected read is still gated by RLS, and every protected write by the
 * database function or the API route. Even a fully faked client-side session
 * would only produce a temporarily wrong-looking navbar.
 */

export interface AuthContextValue {
  user: AuthUser | null;
  /** True until the first session check resolves — avoids a flash of "signed out". */
  isLoading: boolean;
  isConfigured: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<{ error?: string; needsEmailConfirmation?: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Derived, not set in an effect: with no Supabase configured there is no
  // session to wait for, so the spinner must never mount. Seeding the initial
  // value from a module constant keeps this a render-time decision and avoids
  // the cascading re-render that `setState`-inside-`useEffect` would cause.
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      setUser(await getSessionUser());
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Unconfigured: `isLoading` was already seeded to false, so there is nothing
    // to resolve and nothing to subscribe to.
    if (!isSupabaseConfigured) return;

    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    // Seed from the existing cookie, then keep listening.
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled && data.session) void refresh();
      })
      .catch(() => undefined);

    // `onAuthStateChange` fires on sign-in, sign-out, token refresh and expiry.
    // The callback must be synchronous-safe: Supabase warns about awaiting
    // inside it (it can deadlock on the auth lock), hence the `void` + refresh.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) {
        void refresh();
      } else {
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await signIn({ email, password });
      if (!result.ok) return { error: result.error };
      await refresh();
      return {};
    },
    [refresh],
  );

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const result = await signUp({ username, email, password });
      if (!result.ok) return { error: result.error };
      // With email confirmation there is no session yet — do not pretend the
      // user is signed in; the form shows the "check your inbox" state instead.
      if (!result.data.needsEmailConfirmation) await refresh();
      return { needsEmailConfirmation: result.data.needsEmailConfirmation };
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await signOut();
    setUser(null);
    await refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isConfigured: isSupabaseConfigured,
      login,
      register,
      logout,
      refresh,
    }),
    [user, isLoading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

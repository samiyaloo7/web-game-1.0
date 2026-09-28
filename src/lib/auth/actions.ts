'use server';

/**
 * AUTH SERVER ACTIONS — signup, login, logout, current user.
 * =================
 *
 * ## Why Server Actions instead of client-side `supabase.auth.signInWithPassword()`
 *
 * A Server Action is a function invoked over HTTP by React itself, running in
 * the Node runtime. Three consequences make it the right home for credentials:
 *
 *  1. **The session cookie is written server-side.** @supabase/ssr sets
 *     httpOnly, SameSite cookies from the response, so client-side JavaScript —
 *     including any XSS payload — cannot read or forge the session token.
 *  2. **The password is never handled by client logic**, only forwarded once.
 *  3. **Same-origin CSRF protection.** Next.js verifies the Origin header on
 *     Server Action requests, so another site cannot drive a sign-in on a
 *     user's behalf.
 *
 * Each file with `'use server'` exports only async functions, so no helper
 * constant or type leaks into the client graph.
 *
 * Note that no action ever accepts a `profile_id`/`user_id` from the caller:
 * the subject of every write is `auth.uid()` resolved from the verified
 * session, which is what stops one courier from editing another's career.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../supabase/server';
import { isSupabaseConfigured } from '../supabase/env';
import { mapAuthError } from './errors';
import { getCurrentUser } from './session';
import { validateCredentials, validateSignUpInput } from '../validation';
import { NOT_CONFIGURED, type AuthResult, type AuthUser } from './types';

/** What a successful signup hands back, so the form can show the right message. */
/** What a successful signup hands back, so the form can show the right message. */
export interface SignUpOutcome {
  user: AuthUser;
  /** True when the project requires email confirmation before sign-in. */
  needsEmailConfirmation: boolean;
}

export async function signUp(input: unknown): Promise<AuthResult<SignUpOutcome>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const validated = validateSignUpInput(input);
  if (!validated.ok) {
    return { ok: false, code: 'unknown', error: validated.error };
  }
  const { email, password, username } = validated.value;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NOT_CONFIGURED;

  // Pre-flight the call-sign so the user gets an instant, specific answer.
  //
  // This is a UX nicety, NOT a guarantee: the `profiles_username_lower_key`
  // unique index plus the signup trigger are what actually enforce uniqueness,
  // so two browsers racing on the same name still cannot both win.
  //
  // Critically, a FAILING probe must never be reported as "username taken".
  // The probe can fail because the migration has not been applied, and telling
  // the user their call-sign is unavailable in that case sends them to rewrite a
  // perfectly good name. Anything other than a definitive `false` is passed
  // through as-is, and signup continues — the unique index is the real gate.
  const { data: available, error: probeError } = await supabase.rpc('username_available', {
    p_username: username,
  });

  if (probeError) {
    const mapped = mapAuthError(probeError);
    if (mapped.code === 'schema-missing') {
      // Hard stop: without the migration there is no profile trigger, so signup
      // would create an auth user with no profile row at all.
      return { ok: false, code: mapped.code, error: mapped.message };
    }
    // Any other probe failure is non-fatal — let the unique index decide.
  } else if (available === false) {
    return { ok: false, code: 'username-taken', error: 'That call-sign is already taken.' };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // `raw_user_meta_data` is read by the `handle_new_user` trigger to seed
    // `profiles.username` in the same transaction as the account row.
    options: { data: { username } },
  });

  if (error) {
    const mapped = mapAuthError(error);
    return { ok: false, code: mapped.code, error: mapped.message };
  }

  const user = data.user;
  if (!user) {
    return { ok: false, code: 'unknown', error: 'Signup did not return an account.' };
  }

  // With email confirmation ON there is no session yet — the user must click the
  // link in the email first. The trigger still created the profile row.
  const needsEmailConfirmation = !data.session;

  return {
    ok: true,
    data: {
      user: { id: user.id, email: user.email ?? email, username, createdAt: user.created_at ?? '' },
      needsEmailConfirmation,
    },
  };
}

export async function signIn(input: unknown): Promise<AuthResult<AuthUser>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const validated = validateCredentials(input);
  if (!validated.ok) {
    return { ok: false, code: 'unknown', error: validated.error };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NOT_CONFIGURED;

  const { data, error } = await supabase.auth.signInWithPassword(validated.value);

  if (error) {
    const mapped = mapAuthError(error);
    return { ok: false, code: mapped.code, error: mapped.message };
  }

  if (!data.user) {
    return { ok: false, code: 'unknown', error: 'Sign-in did not return an account.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', data.user.id)
    .maybeSingle();

  return {
    ok: true,
    data: {
      id: data.user.id,
      email: data.user.email ?? validated.value.email,
      username: profile?.username ?? `courier_${data.user.id.slice(0, 8)}`,
      createdAt: data.user.created_at ?? '',
    },
  };
}

/**
 * Signs out by revoking the refresh tokens, then clearing cookies.
 *
 * `signOut()` (as opposed to just removing the cookie) invalidates the refresh
 * token server-side, so a stolen copy of the cookie cannot mint a new access
 * token after the user has logged out.
 */
export async function signOut(): Promise<AuthResult<null>> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    // Nothing to clear server-side; report success so the UI still resets.
    return { ok: true, data: null };
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    const mapped = mapAuthError(error);
    return { ok: false, code: mapped.code, error: mapped.message };
  }

  return { ok: true, data: null };
}

/**
 * Re-exported so server components can read the current user without importing
 * from two modules. Wrapped rather than aliased so the indirection documents
 * itself: this is the *verified* current user, not a decoded cookie.
 */
export async function getSessionUser(): Promise<AuthUser | null> {
  return getCurrentUser();
}

/** Invalidates cached server-rendered pages after a session change. */
export async function refreshSessionViews(): Promise<void> {
  revalidatePath('/', 'layout');
}

/** Post-authentication navigation, kept here so every entry point agrees. */
export async function redirectAfterAuth(): Promise<never> {
  redirect('/game');
}


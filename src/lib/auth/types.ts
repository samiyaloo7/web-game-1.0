/**
 * Auth domain types — deliberately plain so React, Server Components and Route
 * Handlers can all speak the same language without importing Supabase types.
 */

/** The signed-in courier, as the app needs it. */
export interface AuthUser {
  /** UUID from `auth.users`. Also the primary key of `profiles`. */
  id: string;
  email: string;
  /** Public call-sign, mirrored from `profiles.username`. */
  username: string;
  createdAt: string;
}

/** Discriminated result so callers must handle the failure branch. */
export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: AuthErrorCode };

/**
 * Stable error codes the UI can branch on (e.g. to auto-resend a confirmation
 * email) while `error` stays a human-readable sentence.
 */
export type AuthErrorCode =
  | 'invalid-credentials'
  | 'email-taken'
  | 'email-not-confirmed'
  | 'weak-password'
  | 'username-taken'
  | 'rate-limited'
  | 'not-configured'
  /**
   * The database is reachable but the schema is not installed — the migration in
   * `supabase/migrations/` has not been run. Distinct from every validation code
   * on purpose: a missing table is an operator problem, and reporting it as
   * "that call-sign is taken" sends the user chasing the wrong thing.
   */
  | 'schema-missing'
  | 'unknown';

export const NOT_CONFIGURED: AuthResult<never> = {
  ok: false,
  code: 'not-configured',
  error: 'Supabase is not configured. Add the NEXT_PUBLIC_* variables to .env.local.',
};

/** Input shapes live in `@/lib/validation` — this module only describes results. */
export type { CredentialsInput as Credentials, SignUpInput } from '@/lib/validation';

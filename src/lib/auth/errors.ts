import type { AuthErrorCode } from './types';

/**
 * Translates a raw Supabase error into a user-safe message.
 *
 * SECURITY: never forward `error.message` verbatim. Supabase error text can
 * include driver/constraint detail, and a generic "invalid login credentials"
 * is deliberately vague on purpose — telling an attacker that the email exists
 * is an account-enumeration leak. Everything user-facing flows through here.
 *
 * Pure and dependency-free, so it is unit-testable without a Supabase client.
 */
export function mapAuthError(error: unknown): { code: AuthErrorCode; message: string } {
  const raw = extractMessage(error);
  const lower = raw.toLowerCase();

  // `AuthApiError` and the network layer both expose a numeric `status`; use it
  // when present, because PostgREST message text is not a stable contract.
  const status = readStatus(error);
  const code = readErrorCode(error);

  // PostgREST reports a missing table/view/function with these codes. This is a
  // deployment state (migration not applied), never a user input problem, so it
  // must be checked BEFORE the validation branches — otherwise an uninstalled
  // schema surfaces as a confusing "invalid credentials" or "username taken".
  if (code === 'PGRST202' || code === 'PGRST204' || code === 'PGRST205' || isMissingSchema(lower)) {
    return {
      code: 'schema-missing',
      message: 'Database is not set up yet. Apply supabase/migrations/ and try again.',
    };
  }

  if (
    status === 429 ||
    lower.includes('rate limit') ||
    // Supabase Auth's real message for this is "Too many requests"; matching only
    // "rate limit" would let a genuine 429 fall through to the generic branch.
    lower.includes('too many requests')
  ) {
    return { code: 'rate-limited', message: 'Too many attempts. Wait a moment and try again.' };
  }

  if (lower.includes('email not confirmed')) {
    return {
      code: 'email-not-confirmed',
      message: 'Confirm your email address before signing in.',
    };
  }

  if (lower.includes('already been registered') || lower.includes('user already registered')) {
    return { code: 'email-taken', message: 'An account with that email already exists.' };
  }

  if (lower.includes('password should be') || lower.includes('at least 6 characters')) {
    return { code: 'weak-password', message: 'Password must be at least 6 characters.' };
  }

  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    // Deliberately does NOT say whether the email or the password was wrong.
    return { code: 'invalid-credentials', message: 'Invalid email or password.' };
  }

  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return { code: 'unknown', message: 'Network error. Check your connection and retry.' };
  }

  return { code: 'unknown', message: 'Something went wrong. Please try again.' };
}

function extractMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return '';
}

function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { status?: unknown; code?: unknown };
  const value = typeof candidate.status === 'number' ? candidate.status : candidate.code;
  return typeof value === 'number' ? value : null;
}

/** PostgREST surfaces its own short codes (PGRST202, PGRST205…) on the `code` field. */
function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Message-text fallback for the same condition, in case the code is absent. */
function isMissingSchema(lowerMessage: string): boolean {
  return (
    lowerMessage.includes('could not find the function') ||
    lowerMessage.includes('could not find the table') ||
    lowerMessage.includes('schema cache') ||
    lowerMessage.includes('does not exist')
  );
}

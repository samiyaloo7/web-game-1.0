import type { ScoreStatus } from './supabase/database';

/**
 * Pure validation shared by the score API route and (mirrored) the signup form.
 * No Supabase, no React — unit-testable in plain Node, and the server-side
 * copy is the authoritative one: the database CHECK constraints are the final
 * backstop if this layer is ever bypassed.
 */

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/** Mirrors the `profiles_username_format` CHECK constraint exactly. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

export function validateUsername(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return { ok: false, error: 'Username must be text' };
  const username = input.trim();
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      error: 'Username must be 3-20 characters: letters, digits or underscore',
    };
  }
  return { ok: true, value: username };
}

// ---------------------------------------------------------------------------
// Delivery submission
//
// WHY THIS IS A REFERENCE, NOT A CLAIM
// -----------------------------------
// The obvious design would accept `{ credits, xp, timeSeconds }` from the
// browser and range-check it. That is what the FIRST version of this route did,
// and it is why the numbers are not accepted at all any more.
//
// The client now sends only *references* the server can independently resolve:
//
//   packageId  → looked up in the server's own `package_defs` table
//   timeRatio  → a 0..1 fraction; the payout formula is monotonic in it, so the
//                worst forgery earns a full speed bonus on a known package
//   duration   → informational, bounded, and NOT part of the award formula
//
// The server then recomputes credits and XP from its own catalog and the
// courier's own stored upgrade levels. A client that lies about `timeRatio` can
// only ever move its award within the range a perfect run would have earned.
// ---------------------------------------------------------------------------

/** Must mirror the id space of `public.package_defs`. */
export const PACKAGE_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

/** One hour — the same ceiling the RPC enforces. */
export const MAX_DELIVERY_DURATION_SECONDS = 3_600;

/** Delivery ids the server can price. Mirrors `src/game/data/deliveryData.ts`. */
export const KNOWN_PACKAGE_IDS = [
  'pkg_neural_chip',
  'pkg_cryo_serum',
  'pkg_power_core',
  'pkg_data_drive',
] as const;

export type KnownPackageId = (typeof KNOWN_PACKAGE_IDS)[number];

/**
 * What the browser is allowed to send.
 *
 * Note what is *absent*: `credits` and `xp`. Their presence in this type would
 * be the vulnerability — the route must have nothing to validate them against.
 */
export interface DeliverySubmission {
  status: ScoreStatus;
  /** Key into the server-owned catalog. */
  packageId: string;
  /** Fraction of the timer remaining, 0..1. Clamped, not rejected. */
  timeRatio: number;
  /** Wall-clock seconds for the run. Bounded; does not affect payout. */
  durationSeconds: number;
  /**
   * What the client *believed* it earned. Recorded for fraud analytics only and
   * never used to compute the award — see the table's `claimed_credits` column.
   */
  claimedCredits: number;
}

/**
 * Validates the untrusted delivery payload against the same rules the RPC
 * enforces. This is a *usability* gate: it turns obvious garbage into a clean
 * 400 instead of a database exception. It is NOT the security gate — the RPC
 * re-derives every number regardless of what passes here.
 */
export function validateDeliverySubmission(
  input: unknown
): ValidationResult<DeliverySubmission> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }

  const body = input as Record<string, unknown>;

  if (body.status !== 'completed' && body.status !== 'failed') {
    return { ok: false, error: 'status must be "completed" or "failed"' };
  }

  // Package id: shape-checked locally for a fast error, but AUTHORITATIVELY
  // validated in the database (a client could otherwise invent a new id and
  // this list would have no idea). The local list only improves the message.
  if (typeof body.packageId !== 'string' || !PACKAGE_ID_PATTERN.test(body.packageId)) {
    return { ok: false, error: 'packageId is required' };
  }

  if (
    typeof body.timeRatio !== 'number' ||
    !Number.isFinite(body.timeRatio) ||
    body.timeRatio < 0 ||
    body.timeRatio > 1
  ) {
    return { ok: false, error: 'timeRatio must be between 0 and 1' };
  }

  if (
    typeof body.durationSeconds !== 'number' ||
    !Number.isFinite(body.durationSeconds) ||
    body.durationSeconds < 0 ||
    body.durationSeconds > MAX_DELIVERY_DURATION_SECONDS
  ) {
    return { ok: false, error: `durationSeconds must be within 0..${MAX_DELIVERY_DURATION_SECONDS}` };
  }

  // Optional: an older client may omit it, in which case there is nothing to
  // compare against — which is exactly the case fraud analytics wants to see.
  const claimedCredits =
    typeof body.claimedCredits === 'number' && Number.isFinite(body.claimedCredits)
      ? Math.max(0, Math.floor(body.claimedCredits))
      : 0;

  return {
    ok: true,
    value: {
      status: body.status,
      packageId: body.packageId,
      timeRatio: body.timeRatio,
      durationSeconds: Math.round(body.durationSeconds * 1000) / 1000,
      claimedCredits,
    },
  };
}


/** Bounds mirror the CHECK constraints on `public.scores`. */
export const SCORE_LIMITS = {
  maxCredits: 1_000_000,
  maxXp: 1_000_000,
  maxTimeSeconds: 86_400,
} as const;

export interface ScoreSubmission {
  status: ScoreStatus;
  credits: number;
  xp: number;
  timeSeconds: number;
}

function isNonNegativeInt(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

/**
 * Validates an untrusted score payload (request body) against the same rules
 * the database enforces, plus the two semantic rules: failures pay nothing,
 * successes always pay something.
 */
export function validateScoreSubmission(input: unknown): ValidationResult<ScoreSubmission> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }

  const body = input as Record<string, unknown>;

  if (body.status !== 'completed' && body.status !== 'failed') {
    return { ok: false, error: 'status must be "completed" or "failed"' };
  }
  if (!isNonNegativeInt(body.credits, SCORE_LIMITS.maxCredits)) {
    return { ok: false, error: `credits must be an integer 0..${SCORE_LIMITS.maxCredits}` };
  }
  if (!isNonNegativeInt(body.xp, SCORE_LIMITS.maxXp)) {
    return { ok: false, error: `xp must be an integer 0..${SCORE_LIMITS.maxXp}` };
  }
  if (
    typeof body.timeSeconds !== 'number' ||
    !Number.isFinite(body.timeSeconds) ||
    body.timeSeconds < 0 ||
    body.timeSeconds > SCORE_LIMITS.maxTimeSeconds
  ) {
    return { ok: false, error: `timeSeconds must be within 0..${SCORE_LIMITS.maxTimeSeconds}` };
  }

  if (body.status === 'failed' && (body.credits !== 0 || body.xp !== 0)) {
    return { ok: false, error: 'failed deliveries cannot award credits or xp' };
  }
  if (body.status === 'completed' && body.credits === 0 && body.xp === 0) {
    return { ok: false, error: 'completed deliveries must award credits or xp' };
  }

  return {
    ok: true,
    value: {
      status: body.status,
      credits: body.credits,
      xp: body.xp,
      // numeric(10,3): three decimals is the storage precision.
      timeSeconds: Math.round(body.timeSeconds * 1000) / 1000,
    },
  };
}

// ---------------------------------------------------------------------------
// Credentials
//
// The Supabase Auth API validates these too, but only *after* a network round
// trip. Checking locally first keeps obvious typos off the wire entirely.
// ---------------------------------------------------------------------------

/** Mirrors the Supabase Auth `min_password_length` project setting (default 6). */
export const MIN_PASSWORD_LENGTH = 6;

export const MAX_PASSWORD_LENGTH = 72;

export interface CredentialsInput {
  email: string;
  password: string;
}

/**
 * Practical email check. Deliberately permissive: the authoritative test is
 * whether Supabase accepts the address, and a stricter regex here would reject
 * legitimate addresses while adding no real safety.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials(input: unknown): ValidationResult<CredentialsInput> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Credentials must be an object' };
  }

  const body = input as Record<string, unknown>;

  if (typeof body.email !== 'string') {
    return { ok: false, error: 'Email is required' };
  }
  const email = body.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Enter a valid email address' };
  }

  if (typeof body.password !== 'string') {
    return { ok: false, error: 'Password is required' };
  }
  const password = body.password;
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  // bcrypt truncates at 72 bytes; longer passwords are silently ignored past
  // that point, so reject them rather than pretend the tail is doing anything.
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` };
  }

  return { ok: true, value: { email, password } };
}

export interface SignUpInput extends CredentialsInput {
  username: string;
}

/**
 * Validates a signup payload: credentials first, then the call-sign, and only
 * then does the caller hit the network.
 */
export function validateSignUpInput(input: unknown): ValidationResult<SignUpInput> {
  const credentials = validateCredentials(input);
  if (!credentials.ok) return credentials;

  const username = validateUsername((input as Record<string, unknown>).username);
  if (!username.ok) return username;

  return {
    ok: true,
    value: { ...credentials.value, username: username.value },
  };
}

import { describe, it, expect } from 'vitest';
import {
  validateUsername,
  validateScoreSubmission,
  validateCredentials,
  validateSignUpInput,
  SCORE_LIMITS,
  USERNAME_PATTERN,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '@/lib/validation';

/**
 * These cover the *pure* half of the Supabase integration: the rules that must
 * agree with the SQL CHECK constraints and the RPC's validation. They run in
 * plain Node with no Supabase client and no network, which is the point — if
 * these ever drift from the migration, the mismatch is caught in CI rather than
 * in production.
 */

describe('validateUsername', () => {
  it('accepts the documented character set', () => {
    expect(validateUsername('neo_viper').ok).toBe(true);
    expect(validateUsername('ABC').ok).toBe(true);
    // Boundary cases: exactly 20 chars (valid) and exactly 21 (invalid).
    expect(validateUsername('a'.repeat(20)).ok).toBe(true);
    expect(validateUsername('a'.repeat(21)).ok).toBe(false);
  });

  it('trims surrounding whitespace before testing', () => {
    expect(validateUsername('  neo_viper  ')).toEqual({ ok: true, value: 'neo_viper' });
  });

  it('rejects anything outside 3-20 characters', () => {
    expect(validateUsername('ab').ok).toBe(false); // 2 chars
    expect(validateUsername('').ok).toBe(false);
    expect(validateUsername('abc').ok).toBe(true); // 3 chars — the lower bound
  });

  it('rejects non-alphanumeric characters (mirrors the SQL regex)', () => {
    for (const bad of ['neo viper', 'neo-viper', 'neo@viper', 'nëo', '😀😀😀', 'drop;table']) {
      expect(validateUsername(bad).ok, bad).toBe(false);
    }
  });

  it('rejects non-string input', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(validateUsername(bad).ok).toBe(false);
    }
  });

  it('exports a pattern matching the documented rules', () => {
    expect(USERNAME_PATTERN.test('neo_viper')).toBe(true);
    expect(USERNAME_PATTERN.test('ab')).toBe(false);
  });
});

describe('validateScoreSubmission', () => {
  const valid = { status: 'completed' as const, credits: 500, xp: 80, timeSeconds: 42.5 };

  it('accepts a well-formed completed delivery', () => {
    const result = validateScoreSubmission(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(valid);
  });

  it('rejects a non-object body', () => {
    for (const bad of [null, 'string', 42, [1, 2]]) {
      const result = validateScoreSubmission(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Body must be a JSON object');
    }
  });

  it('rejects an unknown status', () => {
    expect(validateScoreSubmission({ ...valid, status: 'exploded' }).ok).toBe(false);
  });

  it('enforces integer credits and xp within the column bounds', () => {
    expect(validateScoreSubmission({ ...valid, credits: 1.5 }).ok).toBe(false);
    expect(validateScoreSubmission({ ...valid, xp: -1 }).ok).toBe(false);
    expect(validateScoreSubmission({ ...valid, credits: -1 }).ok).toBe(false);
    // Exactly on the boundary is still valid.
    expect(validateScoreSubmission({ ...valid, credits: SCORE_LIMITS.maxCredits, xp: 0 }).ok).toBe(
      true
    );
    // One past the boundary is not.
    expect(validateScoreSubmission({ ...valid, credits: SCORE_LIMITS.maxCredits + 1 }).ok).toBe(
      false
    );
  });

  it('allows a fractional time but rejects non-finite or out-of-range values', () => {
    expect(validateScoreSubmission({ ...valid, timeSeconds: 0 }).ok).toBe(true);
    expect(validateScoreSubmission({ ...valid, timeSeconds: 12.3456 }).ok).toBe(true);
    expect(validateScoreSubmission({ ...valid, timeSeconds: -1 }).ok).toBe(false);
    expect(validateScoreSubmission({ ...valid, timeSeconds: Number.NaN }).ok).toBe(false);
    expect(validateScoreSubmission({ ...valid, timeSeconds: Number.POSITIVE_INFINITY }).ok).toBe(
      false
    );
  });

  it('enforces the paid-when-completed rule from the CHECK constraint', () => {
    const result = validateScoreSubmission({ ...valid, credits: 0, xp: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must award credits or xp/i);
  });

  it('enforces that a failure pays nothing', () => {
    expect(validateScoreSubmission({ ...valid, status: 'failed', credits: 10, xp: 0 }).ok).toBe(
      false
    );
    // A failure with no payout is legitimate.
    expect(validateScoreSubmission({ ...valid, status: 'failed', credits: 0, xp: 0 }).ok).toBe(
      true
    );
  });

  it('rounds time to the numeric(10,3) storage precision', () => {
    const result = validateScoreSubmission({ ...valid, timeSeconds: 42.56789 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.timeSeconds).toBe(42.568);
  });
});

describe('validateCredentials', () => {
  const valid = { email: 'courier@nightcity.net', password: 'neon123' };

  it('accepts and normalises a valid pair', () => {
    expect(validateCredentials(valid)).toEqual({ ok: true, value: valid });
  });

  it('lowercases and trims the email so logins are case-insensitive', () => {
    const result = validateCredentials({ ...valid, email: '  Courier@NightCity.NET ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBe('courier@nightcity.net');
  });

  it('rejects malformed emails', () => {
    for (const bad of ['', 'no-at-sign', 'two@@at.com', 'spaces in@mail.com', '@nolocal.com']) {
      const result = validateCredentials({ ...valid, email: bad });
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/valid email/i);
    }
  });

  it('enforces the minimum password length (mirrors the Auth setting)', () => {
    expect(
      validateCredentials({ ...valid, password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) }).ok
    ).toBe(false);
    expect(validateCredentials({ ...valid, password: 'a'.repeat(MIN_PASSWORD_LENGTH) }).ok).toBe(
      true
    );
  });

  it('rejects passwords beyond the bcrypt 72-byte limit', () => {
    const result = validateCredentials({ ...valid, password: 'a'.repeat(MAX_PASSWORD_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at most/i);
  });

  it('rejects missing fields', () => {
    expect(validateCredentials({ password: 'neon123' }).ok).toBe(false);
    expect(validateCredentials({ email: valid.email }).ok).toBe(false);
  });
});

describe('validateSignUpInput', () => {
  it('combines credential and username rules', () => {
    expect(
      validateSignUpInput({
        email: 'Courier@NightCity.net',
        password: 'neon123',
        username: '  neo_viper ',
      })
    ).toEqual({
      ok: true,
      value: { email: 'courier@nightcity.net', password: 'neon123', username: 'neo_viper' },
    });
  });

  it('reports a bad email before a bad username', () => {
    const result = validateSignUpInput({ email: 'nope', password: 'neon123', username: 'ok_name' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/email/i);
  });

  it('reports a bad username once the credentials are valid', () => {
    const result = validateSignUpInput({
      email: 'courier@nightcity.net',
      password: 'neon123',
      username: 'no spaces allowed',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/call-sign|username/i);
  });

  it('rejects a short password even when everything else is fine', () => {
    const result = validateSignUpInput({
      email: 'courier@nightcity.net',
      password: 'abc',
      username: 'neo_viper',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/password/i);
  });
});

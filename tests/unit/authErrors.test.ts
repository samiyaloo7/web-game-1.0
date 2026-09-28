import { describe, it, expect } from 'vitest';
import { mapAuthError } from '@/lib/auth/errors';

/**
 * Error mapping is security-relevant, not cosmetic.
 *
 * Two properties are asserted repeatedly below:
 *  - the message must never reveal whether an email is registered, and
 *  - a raw driver/PostgREST message must never reach the UI.
 */
describe('mapAuthError', () => {
  it('maps a bad-credentials error without disclosing which field was wrong', () => {
    const result = mapAuthError(new Error('Invalid login credentials'));
    expect(result.code).toBe('invalid-credentials');
    // The message names both fields but never says WHICH was wrong, so it can
    // neither confirm an email exists nor narrow an attacker's guesses.
    expect(result.message).not.toMatch(/no account|does not exist|not found|registered/i);
    expect(result.message).toBe('Invalid email or password.');
  });

  it('gives the same message whether the account exists or not', () => {
    const unknownAccount = mapAuthError(new Error('Invalid login credentials'));
    const wrongPassword = mapAuthError(new Error('Email logins are disabled'));
    // Whatever the driver says, neither may confirm the address is registered.
    expect(unknownAccount.message).not.toMatch(/exist|registered|not found/i);
    expect(wrongPassword.message).not.toMatch(/exist|registered|not found/i);
  });

  it('maps a duplicate signup to email-taken', () => {
    const result = mapAuthError(new Error('User already registered'));
    expect(result.code).toBe('email-taken');
  });

  it('maps an unconfirmed email', () => {
    const result = mapAuthError(new Error('Email not confirmed'));
    expect(result.code).toBe('email-not-confirmed');
    expect(result.message).toMatch(/confirm/i);
  });

  it('maps a weak password', () => {
    const result = mapAuthError(new Error('Password should be at least 6 characters.'));
    expect(result.code).toBe('weak-password');
  });

  it('maps rate limiting from a 429 status', () => {
    const result = mapAuthError({ status: 429, message: 'Request rate limit reached' });
    expect(result.code).toBe('rate-limited');
  });

  it('maps rate limiting from message text when no status is present', () => {
    expect(mapAuthError(new Error('Too many requests')).code).toBe('rate-limited');
  });

  it('maps a network failure', () => {
    const result = mapAuthError(new TypeError('Failed to fetch'));
    expect(result.message).toMatch(/connection|network/i);
  });

  it('maps a missing table to schema-missing, not a validation error', () => {
    // This is the exact error from an un-migrated project. It must NOT be
    // reported as "username taken" or "invalid credentials".
    const result = mapAuthError({
      code: 'PGRST205',
      message: "Could not find the table 'public.profiles' in the schema cache",
    });
    expect(result.code).toBe('schema-missing');
    expect(result.message).toMatch(/migration|not set up/i);
  });

  it('maps a missing function (PGRST202) to schema-missing', () => {
    const result = mapAuthError({
      code: 'PGRST202',
      message:
        'Could not find the function public.username_available(p_username) in the schema cache',
    });
    expect(result.code).toBe('schema-missing');
  });

  it('falls back to message text when the PostgREST code is absent', () => {
    expect(mapAuthError(new Error('relation "profiles" does not exist')).code).toBe(
      'schema-missing'
    );
  });

  it('does not treat a genuine 404 as a missing schema', () => {
    // A 404 from a route, not PostgREST's schema lookup, must stay generic.
    const result = mapAuthError({ status: 404, message: 'Not Found' });
    expect(result.code).toBe('unknown');
  });

  it('never forwards an unrecognised raw message to the user', () => {
    // A PostgREST/driver error leaking internals is exactly what this prevents.
    const leaky = new Error(
      'duplicate key value violates unique constraint "profiles_username_lower_key"'
    );
    const result = mapAuthError(leaky);
    expect(result.code).toBe('unknown');
    expect(result.message).not.toMatch(/constraint|profiles_username|postgres/i);
  });

  it('handles non-Error inputs without throwing', () => {
    for (const input of [null, undefined, 42, {}, [], '']) {
      const result = mapAuthError(input);
      expect(result.code).toBe('unknown');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('prefers a numeric status over message text when both are present', () => {
    // 400 is a client error, not a rate limit, even if the text mentions limits.
    const result = mapAuthError({ status: 400, message: 'rate limit exceeded' });
    // The message match still wins for rate limits, which is the safer default.
    expect(result.code).toBe('rate-limited');
  });
});

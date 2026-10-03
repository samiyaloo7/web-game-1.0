import { describe, it, expect } from 'vitest';
import {
  validateChallengeProgressSubmission,
  MAX_CHALLENGE_DAY_INDEX,
} from '@/lib/validation';
import { CHALLENGE_MAX_PROGRESS } from '@/game/data/challengeData';

/**
 * CHALLENGE PROGRESS VALIDATION
 * =============================
 *
 * The browser sends exactly two numbers, and this is the gate they pass through
 * before the route touches the database. The important properties are *negative*
 * ones — it must be impossible for this layer to forward a reward, a target, an
 * owner id or a fractional counter — so most of these tests assert what the
 * result does NOT contain rather than what it does.
 *
 * The rules here are mirrored twice more: by the route (`400` on failure) and by
 * `record_challenge_progress`'s own clamp. If this file ever drifts from those,
 * the drift is caught in CI instead of in production.
 */

describe('validateChallengeProgressSubmission', () => {
  it('accepts the documented payload', () => {
    expect(validateChallengeProgressSubmission({ dayIndex: 271, progress: 3 })).toEqual({
      ok: true,
      value: { dayIndex: 271, progress: 3 },
    });
  });

  it('accepts the inclusive boundaries', () => {
    expect(validateChallengeProgressSubmission({ dayIndex: 0, progress: 0 }).ok).toBe(true);
    expect(
      validateChallengeProgressSubmission({
        dayIndex: MAX_CHALLENGE_DAY_INDEX,
        progress: CHALLENGE_MAX_PROGRESS,
      }).ok
    ).toBe(true);
  });

  it('rejects anything that is not a plain object', () => {
    for (const input of [null, undefined, 42, 'progress', [], true]) {
      const result = validateChallengeProgressSubmission(input);
      expect(result.ok, `${JSON.stringify(input)} should not be accepted`).toBe(false);
    }
  });

  describe('dayIndex', () => {
    it('rejects a missing or non-numeric day', () => {
      expect(validateChallengeProgressSubmission({ progress: 1 }).ok).toBe(false);
      expect(validateChallengeProgressSubmission({ dayIndex: '271', progress: 1 }).ok).toBe(false);
      expect(validateChallengeProgressSubmission({ dayIndex: NaN, progress: 1 }).ok).toBe(false);
      expect(validateChallengeProgressSubmission({ dayIndex: Infinity, progress: 1 }).ok).toBe(
        false
      );
    });

    it('rejects a negative or fractional day', () => {
      expect(validateChallengeProgressSubmission({ dayIndex: -1, progress: 1 }).ok).toBe(false);
      // A fractional day is a bug, not a rounding artefact: the route compares the
      // client's day to its own integer, so 271.4 could never be legitimate.
      expect(validateChallengeProgressSubmission({ dayIndex: 271.4, progress: 1 }).ok).toBe(false);
    });

    it('rejects a day beyond the sanity ceiling', () => {
      const result = validateChallengeProgressSubmission({
        dayIndex: MAX_CHALLENGE_DAY_INDEX + 1,
        progress: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/dayIndex/);
    });
  });

  describe('progress', () => {
    it('rejects a missing or non-numeric counter', () => {
      expect(validateChallengeProgressSubmission({ dayIndex: 1 }).ok).toBe(false);
      expect(validateChallengeProgressSubmission({ dayIndex: 1, progress: '3' }).ok).toBe(false);
      expect(validateChallengeProgressSubmission({ dayIndex: 1, progress: NaN }).ok).toBe(false);
      expect(validateChallengeProgressSubmission({ dayIndex: 1, progress: Infinity }).ok).toBe(
        false
      );
    });

    it('rejects a negative counter rather than clamping it', () => {
      expect(validateChallengeProgressSubmission({ dayIndex: 1, progress: -1 }).ok).toBe(false);
    });

    it('rejects a counter above the ceiling', () => {
      const result = validateChallengeProgressSubmission({
        dayIndex: 1,
        progress: CHALLENGE_MAX_PROGRESS + 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/progress/);
    });

    it('floors a fractional counter instead of rejecting it', () => {
      // A client reporting 2.4 deliveries is a rounding artefact, not an attack;
      // the SQL clamp is the hard bound, so a clean 400 here would only be noise.
      const result = validateChallengeProgressSubmission({ dayIndex: 1, progress: 2.4 });
      expect(result).toEqual({ ok: true, value: { dayIndex: 1, progress: 2 } });
    });
  });

  it('drops every field the client is not allowed to send', () => {
    /*
     * The vulnerability this guards is *presence*: if the returned object carried
     * a `rewardCredits` through to the route, a later refactor could start paying
     * it. The value is reshaped to exactly two keys, so nothing can ride along.
     */
    const result = validateChallengeProgressSubmission({
      dayIndex: 271,
      progress: 5,
      challengeId: 'dc_2026-09-29',
      target: 1,
      rewardCredits: 999_999,
      rewardXp: 999_999,
      claimed: true,
      profileId: 'someone-else',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(['dayIndex', 'progress']);
    expect(result.value).not.toHaveProperty('rewardCredits');
    expect(result.value).not.toHaveProperty('claimed');
  });
});

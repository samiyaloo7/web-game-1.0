import { describe, it, expect } from 'vitest';
import {
  DAILY_CHALLENGE_EPOCH_UTC,
  MS_PER_DAY,
  buildDailyChallengeContext,
  dailyChallengeId,
  dailyChallengeSeed,
  dailyChallengeSeedLabel,
  dayIndexToIsoDate,
  dayIndexToUtcMs,
  describeChallenge,
  formatChallengeDuration,
  generateDailyChallenge,
  secondsUntilNextUtcMidnight,
  utcDayIndex,
} from '@/game/systems/DailyChallenge';
import { CHALLENGE_METRICS, isChallengeMetric } from '@/game/types/challenge';

/**
 * DAILY CHALLENGE REPRODUCIBILITY
 * ===============================
 *
 * The whole feature rests on one property: the same UTC day must produce the
 * same challenge on every machine. These tests pin the date arithmetic at its
 * boundaries and prove the generator is a pure function of the day index — which
 * is what "reproducible for every player on the same day" actually means.
 */

describe('date → UTC day index', () => {
  it('anchors day 0 to the epoch date', () => {
    expect(dayIndexToIsoDate(0)).toBe('2026-01-01');
    expect(utcDayIndex(DAILY_CHALLENGE_EPOCH_UTC)).toBe(0);
  });

  it('advances exactly one day per 86,400,000 ms', () => {
    expect(utcDayIndex(DAILY_CHALLENGE_EPOCH_UTC + MS_PER_DAY)).toBe(1);
    expect(utcDayIndex(DAILY_CHALLENGE_EPOCH_UTC + 10 * MS_PER_DAY)).toBe(10);
  });

  it('is stable one millisecond before and after a UTC midnight', () => {
    const boundary = dayIndexToUtcMs(120);
    expect(utcDayIndex(boundary - 1)).toBe(119);
    expect(utcDayIndex(boundary)).toBe(120);
    expect(utcDayIndex(boundary + 1)).toBe(120);
  });

  it('does not consult the local timezone', () => {
    // 2026-09-29T23:59:59.999Z is still the 29th everywhere on the UTC timeline,
    // even on a machine whose local clock has already rolled over.
    const lateNight = Date.UTC(2026, 8, 29, 23, 59, 59, 999);
    expect(dayIndexToIsoDate(utcDayIndex(lateNight))).toBe('2026-09-29');
    expect(dayIndexToIsoDate(utcDayIndex(lateNight + 1))).toBe('2026-09-30');
  });

  it('handles a month boundary and a leap day', () => {
    expect(dayIndexToIsoDate(utcDayIndex(Date.UTC(2026, 2, 1, 0, 0, 0)))).toBe('2026-03-01');
    expect(dayIndexToIsoDate(utcDayIndex(Date.UTC(2028, 1, 29, 12, 0, 0)))).toBe('2028-02-29');
  });

  it('round-trips dayIndex → ms → dayIndex', () => {
    for (const index of [0, 1, 42, 273, 999, 5000]) {
      expect(utcDayIndex(dayIndexToUtcMs(index))).toBe(index);
    }
  });
});

describe('secondsUntilNextUtcMidnight', () => {
  it('is a full day at midnight and one second just before it', () => {
    expect(secondsUntilNextUtcMidnight(dayIndexToUtcMs(7))).toBe(86_400);
    expect(secondsUntilNextUtcMidnight(dayIndexToUtcMs(7) + 86_399_000)).toBe(1);
  });
});

describe('seed derivation', () => {
  it('labels the seed namespace with the ISO date', () => {
    expect(dailyChallengeSeedLabel(utcDayIndex(Date.UTC(2026, 8, 29, 10, 0, 0)))).toBe(
      'neon-courier:daily-challenge:2026-09-29'
    );
  });

  it('hashes the label to a stable 32-bit integer', () => {
    const seed = dailyChallengeSeed(273);
    expect(seed).toBe(dailyChallengeSeed(273));
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('gives different days different seeds and ids', () => {
    expect(dailyChallengeSeed(100)).not.toBe(dailyChallengeSeed(101));
    expect(dailyChallengeId(100)).toBe('dc_2026-04-11');
    expect(dailyChallengeId(100)).not.toBe(dailyChallengeId(101));
  });
});

describe('generateDailyChallenge', () => {
  it('is byte-for-byte reproducible for the same day', () => {
    // This is the "every player on the same day" contract, expressed directly.
    for (const dayIndex of [0, 1, 77, 273, 1000, 20_000]) {
      expect(generateDailyChallenge(dayIndex)).toEqual(generateDailyChallenge(dayIndex));
    }
  });

  it('is independent of the time of day within a UTC date', () => {
    const morning = utcDayIndex(Date.UTC(2026, 8, 29, 1, 15, 0));
    const evening = utcDayIndex(Date.UTC(2026, 8, 29, 22, 45, 0));
    expect(morning).toBe(evening);
    expect(generateDailyChallenge(morning)).toEqual(generateDailyChallenge(evening));
  });

  it('produces valid, self-consistent challenges across a long run of days', () => {
    for (let dayIndex = 0; dayIndex < 400; dayIndex++) {
      const challenge = generateDailyChallenge(dayIndex);

      expect(challenge.id).toBe(dailyChallengeId(dayIndex));
      expect(challenge.dayIndex).toBe(dayIndex);
      expect(challenge.seed).toBe(dailyChallengeSeed(dayIndex));
      expect(challenge.seedLabel).toBe(dailyChallengeSeedLabel(dayIndex));
      expect(isChallengeMetric(challenge.objective.metric)).toBe(true);

      expect(challenge.objective.target).toBeGreaterThan(0);
      expect(challenge.objective.windowSeconds).toBeGreaterThan(0);
      expect(challenge.reward.credits).toBeGreaterThan(0);
      expect(challenge.reward.xp).toBeGreaterThan(0);
      expect(challenge.title.length).toBeGreaterThan(0);
      // Remove the grouping commas so the assertion works for `1,000` too.
      expect(challenge.description.replace(/,/g, '')).toContain(
        String(challenge.objective.target)
      );
      expect(['standard', 'advanced', 'elite']).toContain(challenge.tier);
    }
  });

  it('varies the challenge across days (the rotation actually rotates)', () => {
    const shapes = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const c = generateDailyChallenge(i);
        return `${c.objective.metric}:${c.objective.target}:${c.objective.windowSeconds}`;
      })
    );
    // Not every day has to differ, but a month must not collapse to one shape.
    expect(shapes.size).toBeGreaterThan(5);
  });

  it('only ever uses the documented metric set', () => {
    const seen = new Set<unknown>();
    for (let dayIndex = 0; dayIndex < 200; dayIndex++) {
      seen.add(generateDailyChallenge(dayIndex).objective.metric);
    }
    for (const metric of seen) {
      expect(CHALLENGE_METRICS).toContain(metric);
    }
  });

  it('pays a shorter window at least as much as a longer one, same target', () => {
    const byShape = new Map<string, { window: number; credits: number }[]>();
    for (let dayIndex = 0; dayIndex < 300; dayIndex++) {
      const c = generateDailyChallenge(dayIndex);
      const key = `${c.objective.metric}:${c.objective.target}`;
      const list = byShape.get(key) ?? [];
      list.push({ window: c.objective.windowSeconds, credits: c.reward.credits });
      byShape.set(key, list);
    }

    for (const list of byShape.values()) {
      const shortest = list.reduce((a, b) => (a.window <= b.window ? a : b));
      const longest = list.reduce((a, b) => (a.window >= b.window ? a : b));
      expect(shortest.credits).toBeGreaterThanOrEqual(longest.credits);
    }
  });
});

describe('objective descriptions', () => {
  it('formats durations readably and deterministically', () => {
    expect(formatChallengeDuration(180)).toBe('3 minutes');
    expect(formatChallengeDuration(60)).toBe('1 minute');
    expect(formatChallengeDuration(90)).toBe('1m 30s');
    expect(formatChallengeDuration(45)).toBe('45 seconds');
  });

  it('matches the example objective wording', () => {
    expect(describeChallenge({ metric: 'deliveries', target: 5, windowSeconds: 180 })).toBe(
      'Deliver 5 packages in under 3 minutes.'
    );
  });

  it('groups credits without locale data', () => {
    expect(describeChallenge({ metric: 'credits', target: 1000, windowSeconds: 300 })).toBe(
      'Earn ¢1,000 in delivery pay in under 5 minutes.'
    );
    expect(describeChallenge({ metric: 'xp', target: 250, windowSeconds: 300 })).toBe(
      'Earn 250 XP from deliveries in under 5 minutes.'
    );
  });
});

describe('buildDailyChallengeContext', () => {
  it('derives the challenge, date and reset window from one timestamp', () => {
    const now = Date.UTC(2026, 8, 30, 12, 0, 0);
    const context = buildDailyChallengeContext(now);

    expect(context.serverTimeMs).toBe(now);
    expect(context.dayIndex).toBe(utcDayIndex(now));
    expect(context.date).toBe('2026-09-30');
    expect(context.challenge).toEqual(generateDailyChallenge(context.dayIndex));
    expect(context.secondsUntilReset).toBe(12 * 60 * 60);
  });
});

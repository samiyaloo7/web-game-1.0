'use client';

import type { DailyChallenge, DailyChallengeProgress } from '@/game/types/challenge';

/**
 * DAILY CHALLENGE UPLINK (browser side)
 * =====================================
 *
 * Thin `fetch` wrappers over `/api/challenges`. The important design point is
 * what the browser does *not* send and does not decide:
 *
 *  - It never computes the day. `GET` returns the server's `dayIndex`, `challenge`
 *    and `secondsUntilReset`; the client stores them.
 *  - It never sends a reward, a target, or a challenge id. `POST` reports only
 *    "my attempt reached N", and the server re-derives the objective — and the
 *    payout — from its own clock and generator.
 *  - It sends the `dayIndex` it was given purely so a midnight rollover can be
 *    detected (`409`), never to select a challenge.
 *
 * Failures are returned, not thrown: a courier who loses connectivity keeps
 * playing, and the HUD reports the uplink status rather than crashing the run.
 */

export interface TodayChallengePayload {
  dayIndex: number;
  date: string;
  /** The server's clock at the moment it answered — display only. */
  serverTimeMs: number;
  /** Whole seconds until the next UTC midnight, per the server. */
  secondsUntilReset: number;
  challenge: DailyChallenge;
  progress: DailyChallengeProgress | null;
}

export type TodayChallengeResult =
  | { ok: true; data: TodayChallengePayload }
  | { ok: false; error: string };

export async function fetchTodayChallenge(): Promise<TodayChallengeResult> {
  try {
    const response = await fetch('/api/challenges', {
      method: 'GET',
      // The answer is a function of the server clock, so no cache may serve it.
      cache: 'no-store',
    });

    if (!response.ok) {
      return { ok: false, error: `Challenge uplink unavailable (${response.status})` };
    }

    const data = (await response.json()) as TodayChallengePayload;
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Could not reach the challenge uplink.' };
  }
}

export type ReportProgressResult =
  | {
      ok: true;
      progress: number;
      target: number;
      completed: boolean;
      claimed: boolean;
      /** True only on the response that transitioned the row to claimed. */
      newlyClaimed: boolean;
      rewardCredits: number;
      rewardXp: number;
    }
  | {
      ok: false;
      stale: boolean;
      error: string;
      /**
       * HTTP status when the server answered, `undefined` when it did not.
       *
       * The offline replay loop needs this to tell "the uplink is down" (retry,
       * count an attempt) from "401/429 — this will resolve on its own" (hold,
       * do not burn an attempt) from "400 — the record will never be accepted"
       * (drop). Without it every failure looks the same and a queue would either
       * drop too eagerly or retry forever.
       */
      status?: number;
    };

/**
 * Reports how far the current attempt got.
 *
 * A `409` means the challenge day rolled over between play and report; the caller
 * should refetch rather than retry, because the server would otherwise complete an
 * objective the courier never attempted.
 */
export async function reportChallengeProgress(
  dayIndex: number,
  progress: number
): Promise<ReportProgressResult> {
  try {
    const response = await fetch('/api/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayIndex, progress }),
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (response.status === 409) {
      return {
        ok: false,
        stale: true,
        status: response.status,
        error: typeof body.error === 'string' ? body.error : 'The challenge day rolled over.',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        stale: false,
        status: response.status,
        error: typeof body.error === 'string' ? body.error : `Uplink error ${response.status}`,
      };
    }

    return {
      ok: true,
      progress: typeof body.progress === 'number' ? body.progress : 0,
      target: typeof body.target === 'number' ? body.target : 0,
      completed: Boolean(body.completed),
      claimed: Boolean(body.claimed),
      newlyClaimed: Boolean(body.newlyClaimed),
      rewardCredits: typeof body.rewardCredits === 'number' ? body.rewardCredits : 0,
      rewardXp: typeof body.rewardXp === 'number' ? body.rewardXp : 0,
    };
  } catch {
    return { ok: false, stale: false, error: 'Could not reach the challenge uplink.' };
  }
}

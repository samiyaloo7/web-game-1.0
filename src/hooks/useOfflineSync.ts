'use client';

import { useCallback, useEffect, useRef } from 'react';
import { EventBus } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';
import { useAuth } from '@/components/auth/AuthProvider';
import { reportChallengeProgress } from '@/lib/challenges/client';
import { OUTBOX_CHANGED_EVENT, publishOutboxDepth } from '@/lib/offline/outbox';
import {
  MAX_OPERATION_ATTEMPTS,
  clearPendingGrant,
  operationsForUser,
  readOutbox,
  readPendingGrant,
  removeOperation,
  setAttempts,
  writeOutbox,
  writePendingGrant,
  type PendingGrant,
  type QueuedOperation,
} from '@/lib/offline/queue';

/**
 * OFFLINE SYNCHRONISATION
 * ======================
 *
 * The reconciliation loop. Everything it drains was queued by an outbox call
 * that failed for a *transport* reason; nothing here decides what a record is
 * worth — every replay is re-priced, re-validated and re-dated by the server.
 *
 * ## What is replayed, and in what order
 *
 * FIFO. Scores and challenge progress are independent records, so the only
 * ordering that matters is not letting a challenge completion be lost to the
 * cap that bounds the queue.
 *
 * ## Failure taxonomy
 *
 *   - `done`  — the server accepted it; drop it from the outbox.
 *   - `drop`  — the server refused it for good (4xx, or a challenge day that has
 *               rolled over). Retrying would produce the same answer forever.
 *   - `hold`  — the answer is "later": 401 (sign in again) or 429 (rate limit).
 *               Keep the record, stop the pass, and do NOT burn an attempt.
 *   - `fail`  — the uplink is unreachable or erroring (network, 5xx). Count an
 *               attempt and stop the pass; after `MAX_OPERATION_ATTEMPTS` the
 *               record is dropped so one poisoned entry cannot wedge the queue.
 *
 * ## Security
 *
 *   - Replay only ever runs **for a signed-in courier**, and every record is
 *     bound to the `userId` it was created under. Records left behind by a
 *     different session in the same browser are deleted, never sent — otherwise
 *     a shared machine would attribute one courier's deliveries to another.
 *   - Cookies still do the authentication, on the same endpoints, with the same
 *     server-side validation. Nothing is replayed with elevated privilege, and
 *     the outbox stores no tokens at all.
 */

/** Rate-limited or unauthenticated: try again, but not eagerly. */
const HOLD_RETRY_MS = 30_000;
/** Uplink unreachable: retry sooner — connectivity often returns quickly. */
const FAIL_RETRY_MS = 10_000;

type ReplayOutcome = 'done' | 'drop' | 'hold' | 'fail';

interface ReplayResult {
  outcome: ReplayOutcome;
  /**
   * Present only when the server confirmed the reward on *this* response.
   *
   * The server is the sole authority on `newlyClaimed`; replaying an old
   * completion therefore cannot pay twice, because the row is already claimed
   * and the function returns `newly_claimed = false`.
   */
  grant?: PendingGrant;
}

async function replayOperation(operation: QueuedOperation): Promise<ReplayResult> {
  if (operation.kind === 'score') {
    let response: Response;
    try {
      response = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation.body),
      });
    } catch {
      // Never reached the server.
      return { outcome: 'fail' };
    }

    if (response.ok) return { outcome: 'done' };
    if (response.status === 401 || response.status === 429) return { outcome: 'hold' };
    if (response.status >= 500) return { outcome: 'fail' };
    // Any other 4xx: the server has rejected this record for good.
    return { outcome: 'drop' };
  }

  const result = await reportChallengeProgress(operation.body.dayIndex, operation.body.progress);

  if (result.ok) {
    if (!result.newlyClaimed) return { outcome: 'done' };
    return {
      outcome: 'done',
      grant: {
        challengeId: operation.body.challengeId,
        credits: result.rewardCredits,
        xp: result.rewardXp,
        // Stamped here, at replay time, because the outbox body carries no
        // identity of its own — the operation's `userId` is the courier who
        // earned it, which is exactly who the reward must go to.
        userId: operation.userId,
        createdAt: Date.now(),
      },
    };
  }

  // The day moved on between playing and replaying. The server refuses by design;
  // keeping the record would only re-propose a challenge nobody attempted.
  if (result.stale) return { outcome: 'drop' };
  if (result.status === 401 || result.status === 429) return { outcome: 'hold' };
  if (result.status !== undefined && result.status < 500) return { outcome: 'drop' };
  return { outcome: 'fail' };
}

/**
 * Hands a confirmed reward to the game scene, which banks it into the career.
 *
 * Durable first, delivered second, cleared last: a crash between the two replays
 * the grant on the next load, and `ChallengeTracker.markRewardGranted()` makes
 * the second application a no-op rather than a double payout.
 */
function deliverPendingGrant(userId: string | undefined): void {
  const grant = readPendingGrant();
  if (!grant) return;

  if (!userId || grant.userId !== userId) {
    // Foreign (or signed-out): drop it. The server still records the claim, so
    // the earning courier's own history is intact — only this browser's local
    // mirror declines to apply someone else's reward.
    clearPendingGrant();
    return;
  }

  EventBus.sendCommand('cmd:grant-challenge-reward', {
    challengeId: grant.challengeId,
    credits: grant.credits,
    xp: grant.xp,
  });
  clearPendingGrant();
  useGameStore.setState({ challengeSyncStatus: 'granted' });
}

/** Stores a confirmed reward, applying it immediately if the scene can take it. */
function recordGrant(userId: string, grant: PendingGrant): void {
  writePendingGrant(grant);
  if (useGameStore.getState().isEngineReady) deliverPendingGrant(userId);
}
/**
 * Mirrors `navigator.onLine` into the store.
 *
 * Treated strictly as a hint: it decides when to *try*, never whether a request
 * is allowed. `navigator.onLine` only knows about the network interface, so a
 * server outage still surfaces as a failed call — which is exactly the path that
 * falls back to the outbox.
 */
export function useConnectivity(): void {
  const setIsOnline = useGameStore((s) => s.setIsOnline);

  useEffect(() => {
    const sync = () => setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);

    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);

    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [setIsOnline]);
}

/**
 * Drains the outbox when the network is available.
 *
 * Mounted once, in the root layout, so reconciliation is not tied to the game: a
 * reward confirmed while the courier is reading the leaderboard still lands.
 */
export function useOfflineSync(): void {
  const { user, isConfigured } = useAuth();
  const isEngineReady = useGameStore((s) => s.isEngineReady);

  const inFlightRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Lets the retry timer call the *current* `flush` without a dependency cycle. */
  const flushRef = useRef<() => Promise<void>>(async () => undefined);

  const scheduleRetry = useCallback((delayMs: number) => {
    // One pending retry per hook instance: a failing flush must not stack timers
    // that all fire the moment the network returns.
    if (retryTimerRef.current) return;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void flushRef.current();
    }, delayMs);
  }, []);

  const flush = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!user || !isConfigured) return;
    if (!useGameStore.getState().isOnline) return;

    inFlightRef.current = true;
    try {
      let outbox = readOutbox();

      // Owner enforcement. A browser shared by two couriers can hold records
      // from both; the foreign ones are discarded here rather than being posted
      // under whichever session happens to be signed in now.
      const mine = operationsForUser(outbox, user.id);
      if (mine.length !== outbox.operations.length) {
        outbox = { version: 1, operations: mine };
        writeOutbox(outbox);
        publishOutboxDepth();
      }

      for (const operation of mine) {
        const { outcome, grant } = await replayOperation(operation);

        if (outcome === 'hold') {
          // "Later" answers stop the pass without spending an attempt.
          scheduleRetry(HOLD_RETRY_MS);
          break;
        }

        if (outcome === 'done' || outcome === 'drop') {
          outbox = removeOperation(outbox, operation.id);
          writeOutbox(outbox);
          publishOutboxDepth();
          if (grant) recordGrant(user.id, grant);
          continue;
        }

        const attempts = operation.attempts + 1;
        const exhausted = attempts >= MAX_OPERATION_ATTEMPTS;
        outbox = exhausted
          ? removeOperation(outbox, operation.id)
          : setAttempts(outbox, operation.id, attempts);
        writeOutbox(outbox);
        publishOutboxDepth();

        if (!exhausted) {
          // Stop the pass: if the uplink is down for the first record it is down
          // for the rest, and hammering the free-tier API helps nobody.
          scheduleRetry(FAIL_RETRY_MS);
          break;
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [user, isConfigured, scheduleRetry]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Replay triggers: mount, reconnect, tab regains focus, and a fresh enqueue.
  useEffect(() => {
    const handleOnline = () => {
      void flush();
    };
    const handleVisibility = () => {
      // Last reliable moment before a tab is closed or suspended.
      if (document.visibilityState === 'visible') void flush();
    };
    const handleOutboxChanged = () => {
      void flush();
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener(OUTBOX_CHANGED_EVENT, handleOutboxChanged);

    publishOutboxDepth();
    void flush();

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(OUTBOX_CHANGED_EVENT, handleOutboxChanged);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [flush]);

  // A reward confirmed while the game was not on screen is banked the moment the
  // scene exists to receive it. Guarded to the current user: a foreign grant
  // left by a previous session is dropped, never paid to the wrong courier.
  useEffect(() => {
    if (!isEngineReady) return;
    deliverPendingGrant(user?.id);
  }, [isEngineReady, user]);
}

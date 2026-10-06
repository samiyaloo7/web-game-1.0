'use client';

import { useEffect, useRef } from 'react';
import { EventBus } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';
import { useAuth } from '@/components/auth/AuthProvider';
import { enqueueScoreSubmission } from '@/lib/offline/outbox';
import type { DeliverySubmission } from '@/lib/validation';
import type { GameToUiEvents } from '@/game/EventBus';

/**
 * SCORE REPORTING — game → database, without the game knowing Supabase exists.
 *
 * This hook turns `delivery:recorded` into a `POST /api/scores`. The indirection
 * buys three things:
 *
 *  1. **The simulation stays pure.** `GameScene` never imports `fetch`,
 *     Supabase or React, so it is still unit-testable in plain Node.
 *  2. **The write is authenticated server-side.** The route derives
 *     `profile_id` from the verified session and ignores the request body, so a
 *     tampered client cannot post a score under someone else's name.
 *  3. **Failures are survivable.** A failed leaderboard submission must not
 *     interrupt gameplay — but "survivable" is not the same as "forgotten".
 *
 * ## Offline
 *
 * The failure cases are now split by *cause*, because they need different
 * futures:
 *
 *   - rejected for good (any other 4xx) → dropped, exactly as before;
 *   - rate limited (429), server fault (5xx), or never reached the network →
 *     queued in the local outbox and replayed by `useOfflineSync` on reconnect.
 *
 * The queued record is stamped with the courier's id and carries only the same
 * references the wire carries — `packageId` and `timeRatio`. Replaying it buys
 * nothing a cheater could use: the server re-prices every delivery from its own
 * catalog and the caller's stored upgrades.
 *
 * Guests (no session) simply never post: the leaderboard is opt-in with an account.
 */
export function useScoreReporting() {
  const { user, isConfigured } = useAuth();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!user || !isConfigured) return;

    const handleRecorded = async (record: GameToUiEvents['delivery:recorded']) => {
      // Fire-and-forget, and never stack: a backlog of queued POSTs would arrive
      // out of order and waste the free-tier request budget.
      if (inFlight.current) return;
      inFlight.current = true;

      // Only references go over the wire — packageId, timeRatio, duration. The
      // payout is recomputed server-side; `claimedCredits` is sent purely as a
      // fraud signal and is never used to award anything.
      const body: DeliverySubmission = {
        status: record.status,
        packageId: record.packageId,
        timeRatio: record.timeRatio,
        durationSeconds: record.durationSeconds,
        claimedCredits: record.claimedCredits,
      };

      try {
        const response = await fetch('/api/scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          // Surface a personal best so the HUD can celebrate it. A malformed
          // body must not be mistaken for a transport failure below.
          const result = (await response.json().catch(() => null)) as { isNewBest?: boolean } | null;
          if (result?.isNewBest) {
            useGameStore.setState({ isNewPersonalBest: true });
          }
          return;
        }

        // Rate limited or server fault: this run is still valid and still
        // deserves to be on the board, so it waits for the reconnect flush.
        if (response.status === 429 || response.status >= 500) {
          enqueueScoreSubmission(user.id, body);
        }
        // Any other 4xx is a permanent rejection (unknown package, bad payload):
        // dropped silently, because the run still counted locally.
      } catch {
        // Never reached the server (offline, aborted, DNS failure).
        enqueueScoreSubmission(user.id, body);
      } finally {
        inFlight.current = false;
      }
    };

    EventBus.onEvent('delivery:recorded', handleRecorded);
    return () => {
      EventBus.offEvent('delivery:recorded', handleRecorded);
    };
  }, [user, isConfigured]);
}

'use client';

import { useEffect, useRef } from 'react';
import { EventBus } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';
import { useAuth } from '@/components/auth/AuthProvider';
import type { GameToUiEvents } from '@/game/EventBus';

/**
 * SCORE REPORTING — game → database, without the game knowing Supabase exists.
 *
 * Phaser emits `delivery:recorded` with the payout it already computed. This
 * hook turns that into a `POST /api/scores`. The indirection buys three things:
 *
 *  1. **The simulation stays pure.** `GameScene` never imports `fetch`,
 *     Supabase or React, so it is still unit-testable in plain Node.
 *  2. **The write is authenticated server-side.** The route derives
 *     `profile_id` from the verified session and ignores the request body, so a
 *     tampered client cannot post a score under someone else's name.
 *  3. **Failures are swallowed.** A failed leaderboard submission must not
 *     interrupt gameplay or surface an error over the HUD — the career
 *     progression and the delivery itself already succeeded locally.
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

      try {
        // Only references go over the wire — packageId, timeRatio, duration. The
        // payout is recomputed server-side; `claimedCredits` is sent purely as a
        // fraud signal and is never used to award anything.
        const response = await fetch('/api/scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: record.status,
            packageId: record.packageId,
            timeRatio: record.timeRatio,
            durationSeconds: record.durationSeconds,
            claimedCredits: record.claimedCredits,
          }),
        });

        if (response.ok) {
          // Surface a personal best so the HUD can celebrate it.
          const result = (await response.json()) as { isNewBest?: boolean };
          if (result.isNewBest) {
            useGameStore.setState({ isNewPersonalBest: true });
          }
        }
        // A non-2xx is silently ignored: the run already counted locally, and a
        // leaderboard error must never interrupt play or spam the HUD.
      } catch {
        // Offline or aborted — the run still counts locally.
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

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EventBus, type GameToUiEvents } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';
import { useAuth } from '@/components/auth/AuthProvider';
import { fetchTodayChallenge, reportChallengeProgress } from '@/lib/challenges/client';
import type { TodayChallengePayload } from '@/lib/challenges/client';
import type { ChallengeProgressSnapshot } from '@/game/types/challenge';

/**
 * DAILY CHALLENGE SYNC — the seam between the server's clock and the game.
 *
 * ## Why the browser never decides what day it is
 *
 * This hook holds no date arithmetic. It asks `GET /api/challenges`, and the
 * server answers with the day index, the challenge, and the seconds remaining
 * until reset — all derived from the *server's* clock. The client stores those
 * numbers and schedules its next fetch from `secondsUntilReset`, so even a machine
 * set to the wrong year plays the correct challenge and resets at the correct UTC
 * midnight.
 *
 * The only wall-clock-looking value the client sends back is the `dayIndex` it was
 * given, and the route uses it solely to detect a midnight rollover (409). It can
 * never select a challenge with it.
 *
 * ## The flow
 *
 *   load  ──▶  cmd:load-daily-challenge ──▶ ChallengeTracker (game state)
 *   deliver ──▶ challenge:progress ────────▶ mirror to the HUD
 *   objective met ──▶ challenge:completed ─▶ POST progress
 *                                          └▶ cmd:grant-challenge-reward
 *
 * The reward is paid *after* the server confirms (or immediately, in a local-only
 * session with no Supabase). `newlyClaimed` is what makes that exactly once, even
 * across retries and reloads.
 */
export function useDailyChallenge(): { refresh: () => Promise<void> } {
  const { user, isConfigured } = useAuth();
  const isEngineReady = useGameStore((s) => s.isEngineReady);
  const setChallengeSyncStatus = useGameStore((s) => s.setChallengeSyncStatus);

  const [today, setToday] = useState<TodayChallengePayload | null>(null);

  /** A challenge id already pushed into the game, so a refetch never resets a live attempt. */
  const hydratedRef = useRef<string | null>(null);
  /** Highest progress already reported, so partial progress is sent at most once per delivery. */
  const reportedRef = useRef(-1);
  /** The challenge whose reward has been paid this session. */
  const grantedRef = useRef<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionInFlightRef = useRef(false);

  const load = useCallback(async () => {
    const result = await fetchTodayChallenge();

    if (!result.ok) {
      setChallengeSyncStatus(isConfigured ? 'error' : 'offline');
      return;
    }

    setToday(result.data);

    // A successful fetch clears a previous failure, but must not overwrite
    // "granted" — the reward really was paid.
    const current = useGameStore.getState().challengeSyncStatus;
    if (current === 'error' || current === 'offline') {
      setChallengeSyncStatus('idle');
    }
  }, [isConfigured, setChallengeSyncStatus]);

  // Load once on mount and whenever the session changes (a different courier has
  // a different challenge row, even though the challenge itself is identical).
  useEffect(() => {
    // Wrapped in an async IIFE rather than called directly: the loader writes React
    // state after its `await`, and `react-hooks/set-state-in-effect` cannot see
    // past the async boundary when the call is direct. This form also states the
    // intent — the effect *awaits* the fetch, it does not fire and forget it.
    void (async () => {
      await load();
    })();
  }, [load, user]);

  // Re-fetch at the server's own reset instant (+ a small cushion), so the panel
  // rolls over to tomorrow's challenge without a page reload.
  useEffect(() => {
    if (!today) return;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    const delay = Math.min((today.secondsUntilReset + 5) * 1000, 2_147_000_000);
    resetTimerRef.current = setTimeout(() => {
      void load();
    }, delay);

    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [today, load]);

  // A tab that was backgrounded across a UTC midnight must catch up on return.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [load]);

  /**
   * Pushes the challenge into the simulation.
   *
   * Gated on `isEngineReady`: Phaser mounts asynchronously, and a command emitted
   * before the scene has registered its listeners would be lost. Re-running when
   * the engine becomes ready is what makes the panel appear at all on first load.
   */
  useEffect(() => {
    if (!isEngineReady || !today) return;

    const alreadyHydrated = hydratedRef.current === today.challenge.id;

    EventBus.sendCommand('cmd:load-daily-challenge', {
      challenge: today.challenge,
      // Hydrate only on the first push of a given day: `hydrate` restarts the
      // attempt, and a mid-day refetch must not throw away live progress.
      progress: alreadyHydrated
        ? null
        : {
            progress: today.progress?.progress ?? 0,
            completed: today.progress?.completed ?? false,
            rewardGranted: today.progress?.claimed ?? false,
          },
    });

    if (!alreadyHydrated) {
      hydratedRef.current = today.challenge.id;
      reportedRef.current = today.progress?.progress ?? 0;
      if (today.progress?.claimed) {
        grantedRef.current = today.challenge.id;
        setChallengeSyncStatus('granted');
      }
    }
  }, [isEngineReady, today, setChallengeSyncStatus]);

  // Completion: record it, then pay exactly once.
  useEffect(() => {
    const grant = (challengeId: string, credits: number, xp: number) => {
      if (grantedRef.current === challengeId) return;
      grantedRef.current = challengeId;
      EventBus.sendCommand('cmd:grant-challenge-reward', { challengeId, credits, xp });
    };

    const handleCompleted = async (event: GameToUiEvents['challenge:completed']) => {
      // Local-only session (no Supabase, or a guest): there is nothing to record
      // against, so the generated reward is paid locally and the HUD says so.
      if (!user || !isConfigured) {
        grant(event.challengeId, event.rewardCredits, event.rewardXp);
        setChallengeSyncStatus('offline');
        return;
      }

      if (completionInFlightRef.current) return;
      completionInFlightRef.current = true;
      setChallengeSyncStatus('syncing');

      try {
        const result = await reportChallengeProgress(event.dayIndex, event.progress);

        if (!result.ok) {
          if (result.stale) {
            // Midnight passed mid-attempt. Refetch rather than retry: the server
            // must never apply this progress to tomorrow's objective.
            setChallengeSyncStatus('idle');
            void load();
          } else {
            setChallengeSyncStatus('error');
          }
          return;
        }

        // `newlyClaimed` is the server's own "this response paid it" flag.
        if (result.newlyClaimed) {
          grant(event.challengeId, result.rewardCredits, result.rewardXp);
        }
        setChallengeSyncStatus('granted');
      } finally {
        completionInFlightRef.current = false;
      }
    };

    EventBus.onEvent('challenge:completed', handleCompleted);
    return () => {
      EventBus.offEvent('challenge:completed', handleCompleted);
    };
  }, [user, isConfigured, load, setChallengeSyncStatus]);

  // Partial progress: reported so the history list shows a real number even when
  // the objective was not met. Debounced, and never for a completed challenge —
  // completion has its own path above.
  useEffect(() => {
    const handleProgress = (snapshot: ChallengeProgressSnapshot) => {
      if (!user || !isConfigured || !snapshot.challengeId || snapshot.completed) return;
      if (snapshot.bestProgress <= reportedRef.current) return;

      reportedRef.current = snapshot.bestProgress;
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
      reportTimerRef.current = setTimeout(() => {
        void reportChallengeProgress(snapshot.dayIndex ?? 0, snapshot.bestProgress);
      }, 1_200);
    };

    EventBus.onEvent('challenge:progress', handleProgress);
    return () => {
      EventBus.offEvent('challenge:progress', handleProgress);
    };
  }, [user, isConfigured]);

  // Never leave a pending debounce firing after the view unmounts.
  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
    },
    []
  );

  return { refresh: load };
}

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { EventBus } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';
import { useAuth } from '@/components/auth/AuthProvider';
import { savePlayerProgression } from '@/lib/progression/client';
import {
  MAX_PENDING_PROGRESSION_AGE_MS,
  readPendingProgression,
  writePendingProgression,
} from '@/lib/offline/queue';
import { fromProgressRow } from '@/lib/progression/mapping';
import type { ProgressionSnapshot, ProgressionState } from '@/game/types/progression';

/**
 * PROGRESSION SYNC — the seam between the game's career state and the database.
 *
 * ## Game state vs UI state, applied
 *
 * `PlayerProgression` inside Phaser is the *game state* and stays the single
 * authority while the tab is open: it decides what the HUD shows, what upgrades
 * cost and what a run pays. This hook never mutates game rules and never
 * re-derives them. It only:
 *
 *   - **loads** a persisted career on mount and *pushes* it into the game
 *     (`EventBus` command), and
 *   - **saves** a snapshot back out whenever the game announces a change.
 *
 * The Zustand copy is UI state: a mirror for rendering. If the tab closes
 * between two saves, the last synced snapshot is the truth on next load, and
 * `PlayerProgression`'s constructor sanitises whatever the row contained.
 *
 * ## Debouncing
 *
 * A delivery can fire a snapshot every few seconds. Writing each one immediately
 * would burn Supabase's free-tier row/request budget for no benefit, so saves
 * are coalesced behind a timer. Only the latest snapshot matters (absolute
 * writes, not deltas — see `lib/progression/server.ts`), so a debounce can
 * never lose credits: an intermediate snapshot is simply superseded.
 *
 * ## Guests
 *
 * With no session there is nothing to save against. The hook no-ops entirely and
 * the courier plays on an in-memory profile, which keeps the game playable
 * before anyone has configured Supabase.
 */

/** How long to wait after the last change before writing. */
const SAVE_DEBOUNCE_MS = 1_500;

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

export function useProgressionSync() {
  const { user } = useAuth();
  const setProgression = useGameStore((s) => s.setProgression);

  const pendingRef = useRef<ProgressionState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  /** True while the dirty snapshot is the one we just read — not something we changed. */
  const suppressPersistRef = useRef(false);

  const persistPending = useCallback((state: ProgressionState | null) => {
    // Durability: the debounced snapshot outlives the tab, so closing the
    // browser mid-outage cannot silently delete the run's earnings. Persisting
    // is gated on *our own* change — a snapshot we just loaded from the server
    // is never echoed back, which is how two devices stop clobbering each other
    // on every visit.
    if (state === null) {
      writePendingProgression(null);
      return;
    }
    if (suppressPersistRef.current) return;
    writePendingProgression(state);
  }, []);

  const flush = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    try {
      // Drain the buffer in a loop rather than recursing. Each iteration clears
      // the slot *before* awaiting, so a change arriving mid-flight is picked up
      // by the next pass instead of being silently dropped — and because writes
      // are absolute (not deltas), a superseded snapshot can never lose credits.
      let lastStatus: 'saved' | 'error' | null = null;

      while (pendingRef.current !== null) {
        const state = pendingRef.current;
        pendingRef.current = null;

        const result = await savePlayerProgression(state);
        if (result.ok) {
          lastStatus = 'saved';
          // The snapshot landed: the crash-recovery copy is no longer needed.
          // (A change queued mid-flight stays in the ref and keeps its copy.)
          if (pendingRef.current === null) writePendingProgression(null);
        } else {
          // Keep the snapshot around so the next online pass — or the next
          // session after a reload — can retry it. It is the latest absolute
          // state, so holding it loses nothing.
          pendingRef.current = state;
          persistPending(state);
          lastStatus = 'error';
          break;
        }
      }

      if (lastStatus) {
        useGameStore.setState({ syncStatus: lastStatus });
      }
    } finally {
      isSavingRef.current = false;
    }
  }, [persistPending]);

  const scheduleSave = useCallback(
    (state: ProgressionState) => {
      pendingRef.current = state;
      persistPending(state);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, SAVE_DEBOUNCE_MS);
    },
    [flush, persistPending],
  );

  // Load the persisted career once per signed-in user, and reset the mirror when
  // the user changes so the next account does not inherit the last one's HUD —
  // or its unsaved snapshot.
  const activeUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) {
      activeUserIdRef.current = null;
      useGameStore.setState({ syncStatus: 'offline' });
      pendingRef.current = null;
      writePendingProgression(null);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (activeUserIdRef.current !== null && activeUserIdRef.current !== user.id) {
      // Account switch in one tab: the stored snapshot belongs to the previous
      // courier, and saving it under the new session would corrupt their career.
      pendingRef.current = null;
      writePendingProgression(null);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    activeUserIdRef.current = user.id;

    let cancelled = false;

    void (async () => {
      // Read through the anon client, so RLS limits this to the caller's row.
      const { getSupabaseBrowserClient } = await import('@/lib/supabase/browser');
      const { isSupabaseConfigured } = await import('@/lib/supabase/env');
      if (cancelled || !isSupabaseConfigured) return;

      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from('player_progress')
        .select('money, xp, upgrades')
        .limit(1)
        .maybeSingle();

      if (cancelled || !data) return;

      // Send the career INTO the game. The scene owns it from here; the game
      // re-derives rank and stats itself and never trusts a stored level.
      const serverState = fromProgressRow({
        money: data.money,
        xp: data.xp,
        upgrades: data.upgrades,
      });

      // Conflict handling, last-writer-wins with a freshness bound: if this
      // browser holds an unsaved snapshot from a previous offline session, it
      // is the newer truth — the server row predates the outage. A snapshot
      // older than the staleness bound is discarded instead, so a month-old
      // wallet can never flush over what another device has since earned.
      // Either way, what the game receives is exactly what it would have seen
      // had there been no outage at all.
      const pending = readPendingProgression();
      const pendingIsFresh =
        pending !== null && Date.now() - pending.queuedAt <= MAX_PENDING_PROGRESSION_AGE_MS;
      if (!pendingIsFresh && pending !== null) {
        // Stale: drop it so it can never clobber the server's newer truth.
        writePendingProgression(null);
      }
      const initial = pendingIsFresh ? pending.state : serverState;

      // Mark the handoff so the persistence gate below does not echo the loaded
      // snapshot straight back to storage as if we had changed it.
      suppressPersistRef.current = true;
      try {
        EventBus.sendCommand('cmd:load-progression', { state: initial });
      } finally {
        suppressPersistRef.current = false;
      }

      if (pendingIsFresh) {
        // The game now owns the recovered snapshot; re-arm it for saving so
        // the next online pass flushes it, then clears the stored copy.
        pendingRef.current = pending.state;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          void flush();
        }, SAVE_DEBOUNCE_MS);
        useGameStore.setState({ syncStatus: 'saving' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, flush]);

  // Mirror every career change into UI state, and queue a save.
  useEffect(() => {
    if (!user) return;

    const handleProgression = (snapshot: ProgressionSnapshot) => {
      setProgression(snapshot);
      scheduleSave({
        money: snapshot.money,
        xp: snapshot.xp,
        upgrades: snapshot.upgrades,
      });
    };

    EventBus.onEvent('progression:updated', handleProgression);
    return () => {
      EventBus.offEvent('progression:updated', handleProgression);
    };
  }, [user, setProgression, scheduleSave]);

  // Best-effort final flush: a delivery completed seconds before the tab closes
  // would otherwise be lost. `visibilitychange` is the last hook that reliably
  // runs before unload, and browsers still allow the fetch to start.
  useEffect(() => {
    if (!user) return;

    const handleHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', handleHide);
    return () => document.removeEventListener('visibilitychange', handleHide);
  }, [user, flush]);

  return { flush };
}

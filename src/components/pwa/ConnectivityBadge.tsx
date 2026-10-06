'use client';

import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { useGameStore } from '@/stores/useGameStore';
import { useConnectivity, useOfflineSync } from '@/hooks/useOfflineSync';
import { cn } from '@/lib/utils';

/**
 * ConnectivityBadge — the app's offline runtime surface.
 *
 * It lives in the navigation bar rather than floating over the canvas on
 * purpose: it mounts on every route (so reconciliation happens even on the
 * leaderboard), and it never covers the dispatch console's HUD, which is a
 * game element whose occlusion the scene cares about.
 *
 * The hooks it calls are the reason the component exists at all — `useConnectivity`
 * mirrors `navigator.onLine`, `useOfflineSync` drains the outbox on reconnect. The
 * markup is just their honest report of what is still outstanding:
 *
 *   OFFLINE · N QUEUED  the courier is disconnected with N records waiting
 *   SYNCING N           back online, replaying now
 *   PROGRESS UNSAVED    the career snapshot itself has not reached the server
 *
 * Renders nothing when there is genuinely nothing to say, so the common case —
 * online and in sync — costs no chrome at all.
 */
export function ConnectivityBadge() {
  useConnectivity();
  useOfflineSync();

  const isOnline = useGameStore((s) => s.isOnline);
  const pendingSyncCount = useGameStore((s) => s.pendingSyncCount);
  const syncStatus = useGameStore((s) => s.syncStatus);

  const careerUnsynced = syncStatus === 'offline' || syncStatus === 'error';

  if (isOnline && pendingSyncCount === 0 && !careerUnsynced) return null;

  const view = !isOnline
    ? {
        icon: CloudOff,
        label: 'OFFLINE',
        detail: pendingSyncCount > 0 ? `${pendingSyncCount} QUEUED` : 'LOCAL PLAY',
        tone: 'text-neon-amber border-neon-amber/40 bg-amber-950/40',
      }
    : pendingSyncCount > 0
      ? {
          icon: RefreshCw,
          label: 'SYNCING',
          detail: `${pendingSyncCount}`,
          tone: 'text-neon-cyan border-neon-cyan/40 bg-cyan-950/40',
        }
      : {
          icon: TriangleAlert,
          label: 'PROGRESS',
          detail: 'UNSAVED',
          tone: 'text-neon-pink border-neon-pink/40 bg-pink-950/40',
        };

  const Icon = view.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md border font-mono text-[11px] whitespace-nowrap',
        view.tone
      )}
      role="status"
      aria-live="polite"
      title={
        isOnline
          ? 'Replaying records the browser kept while you were offline.'
          : 'Playing from local storage. Runs, credits and scores sync when the uplink returns.'
      }
    >
      <Icon className={cn('w-3.5 h-3.5', !isOnline && pendingSyncCount === 0 && 'animate-pulse')} />
      <span className="font-bold tracking-wider">{view.label}</span>
      <span className="opacity-70">{view.detail}</span>
    </div>
  );
}
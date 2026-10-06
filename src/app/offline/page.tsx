'use client';

import Link from 'next/link';
import { WifiOff, Gamepad2, RefreshCw } from 'lucide-react';

/**
 * OFFLINE FALLBACK
 * ================
 *
 * The page the service worker serves when a navigation has no network *and* no
 * cached copy of the route it was asked for. It is deliberately a static page:
 * it prerenders at build time (`next build` → `○ (Static)`), holds no user data,
 * and loads from the precached shell alone — so it never fetches, reads cookies,
 * or reaches for the network itself. Client-only so the retry button can reload;
 * its markup is still fully server-rendered.
 *
 * The copy tells the player the two things that are actually true offline: the
 * district grid is already on the device (the game runs), and careers, scores
 * and the daily challenge will reconcile when the uplink returns.
 */
export default function OfflinePage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center font-mono">
      <div className="max-w-md w-full p-6 rounded-xl bg-cyber-dark/95 border border-neon-amber/50 shadow-2xl relative overflow-hidden">
        {/* Accent corner lines, matching the dispatch console's framing. */}
        <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-neon-amber pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-neon-amber pointer-events-none" />

        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-lg bg-amber-950/40 border border-neon-amber/40 text-neon-amber">
            <WifiOff className="w-8 h-8" />
          </div>
        </div>

        <h1 className="text-lg font-bold tracking-widest text-neon-amber neon-text-pink mb-2">
          UPLINK SEVERED
        </h1>

        <p className="text-xs text-zinc-400 leading-relaxed mb-1">
          No route in the local grid matches this request, and the district network
          is unreachable.
        </p>
        <p className="text-xs text-zinc-500 leading-relaxed mb-5">
          The dispatch console itself is cached on this device — runs, credits and
          rank all continue offline, then synchronize automatically when the
          connection returns.
        </p>

        <div className="flex flex-col gap-2">
          <Link
            href="/game"
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-neon-cyan text-cyber-black font-bold text-sm tracking-wider hover:bg-cyan-300 transition-colors"
          >
            <Gamepad2 className="w-4 h-4" />
            <span>OPEN DISPATCH CONSOLE</span>
          </Link>

          <button
            onClick={() => window.location.reload()}
            className="flex items-center justify-center gap-2 py-2 px-4 rounded border border-cyber-border text-zinc-300 hover:border-neon-amber hover:text-neon-amber font-bold text-xs tracking-wider transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>RETRY CONNECTION</span>
          </button>
        </div>
      </div>
    </div>
  );
}

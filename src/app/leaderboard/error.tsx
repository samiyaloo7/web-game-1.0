'use client';

import { useEffect } from 'react';
import { ServerCrash, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Route-level error boundary for the leaderboard.
 *
 * This is the LAST resort. `loadLeaderboardPage` returns a typed failure so a
 * transient database problem renders the page's own inline error state; this
 * boundary only catches genuine crashes (a bug, or an unhandled rejection in a
 * Server Component). Keeping both means an ordinary outage looks calm while a
 * real bug is still loud.
 *
 * `reset` re-runs the Server Component, which is why it works without a full
 * reload.
 */
export default function LeaderboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the browser console and in server logs, which is where a
    // digest becomes traceable. Never rendered — digests are not user-facing.
    console.error('[leaderboard] render failed:', error);
  }, [error]);

  return (
    <div className="flex-1 max-w-3xl mx-auto w-full p-4 sm:p-8 flex items-center justify-center">
      <div className="border border-neon-pink/40 rounded-lg bg-neon-pink/5 p-12 text-center w-full">
        <ServerCrash className="w-10 h-10 text-neon-pink/80 mx-auto mb-4" />
        <h1 className="text-white font-bold text-lg mb-1">DISPATCH FEED INTERRUPTED</h1>
        <p className="text-sm text-zinc-400 font-mono mb-2 max-w-lg mx-auto">
          Something went wrong while rendering the board.
        </p>
        {error.digest && (
          <p className="text-[10px] text-zinc-600 font-mono mb-6">TRACE: {error.digest}</p>
        )}
        <Button onClick={reset} size="lg" className="mx-auto">
          <RotateCcw className="w-4 h-4 mr-2" /> Try Again
        </Button>
      </div>
    </div>
  );
}

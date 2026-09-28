/**
 * Loading state for the dispatch board.
 *
 * Next.js renders this immediately while the Server Component streams, so the
 * user gets a skeleton shaped like the real table rather than a blank page. The
 * column widths deliberately match the real table to avoid a visible reflow when
 * the data lands.
 *
 * This is a *pending* state, distinct from both the empty state and the error
 * state: it says "loading", never "no results".
 */
export default function LeaderboardLoading() {
  return (
    <div className="flex-1 max-w-6xl mx-auto w-full p-4 sm:p-8">
      <div className="pb-6 border-b border-cyber-border mb-8">
        <div className="h-3 w-56 bg-cyber-surface rounded animate-pulse mb-3" />
        <div className="h-8 w-80 max-w-full bg-cyber-surface rounded animate-pulse" />
      </div>

      <div
        className="rounded-lg border border-cyber-border bg-cyber-dark/80 overflow-hidden"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="h-10 bg-cyber-surface/90 border-b border-cyber-border" />

        {/* Skeleton rows: static divs rather than the real table so nothing is
            announced to a screen reader before the data exists. */}
        <div className="divide-y divide-cyber-border/50">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3.5">
              <div className="h-4 w-10 bg-cyber-surface rounded animate-pulse shrink-0" />
              <div className="h-4 flex-1 max-w-[180px] bg-cyber-surface rounded animate-pulse" />
              <div className="h-4 w-20 bg-cyber-surface rounded animate-pulse shrink-0" />
              <div className="h-4 w-20 bg-cyber-surface rounded animate-pulse shrink-0" />
              <div className="h-4 w-16 bg-cyber-surface rounded animate-pulse shrink-0" />
              <div className="h-4 w-12 bg-cyber-surface rounded animate-pulse shrink-0" />
              <div className="h-4 w-20 bg-cyber-surface rounded animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading leaderboard rankings…</span>
    </div>
  );
}

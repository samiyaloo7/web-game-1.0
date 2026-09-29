import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clampPage, totalPagesFor } from '@/lib/leaderboard/pagination';

/**
 * Page controls for the board.
 *
 * Pagination is URL-driven (`?page=2`) rather than state-driven on purpose:
 * the page is a Server Component, so the current page is something the *server*
 * needs to know to fetch the right rows. Putting it in the URL makes the current
 * page shareable, bookmarkable, and correct on refresh — and it means "page 2"
 * renders fully-formed HTML rather than a spinner.
 *
 * The shared `pagination.ts` helpers are used rather than local arithmetic so
 * this label can never claim "PAGE 999 OF 2": the server clamps the page before
 * fetching, and the control clamps it again on display for the same reason.
 */
export function LeaderboardPagination({
  page,
  pageSize,
  totalEntries,
}: {
  page: number;
  pageSize: number;
  totalEntries: number;
}) {
  const totalPages = totalPagesFor(totalEntries, pageSize);
  const currentPage = clampPage(page, totalPages);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  const linkClass =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wider border transition-colors';

  return (
    <div className="flex items-center justify-between gap-4 mt-6 pt-4 border-t border-cyber-border flex-wrap">
      <span className="text-xs text-zinc-500 font-mono">
        PAGE {currentPage} OF {totalPages} · {totalEntries.toLocaleString()} COURIER
        {totalEntries === 1 ? '' : 'S'} RANKED
      </span>

      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link
            href={`/leaderboard?page=${currentPage - 1}`}
            aria-label="Previous page"
            className={cn(
              linkClass,
              'text-neon-cyan border-neon-cyan/40 hover:bg-neon-cyan/10'
            )}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </Link>
        ) : (
          <span
            aria-disabled
            className={cn(linkClass, 'text-zinc-700 border-cyber-border cursor-not-allowed')}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </span>
        )}

        {hasNext ? (
          <Link
            href={`/leaderboard?page=${currentPage + 1}`}
            aria-label="Next page"
            className={cn(
              linkClass,
              'text-neon-cyan border-neon-cyan/40 hover:bg-neon-cyan/10'
            )}
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        ) : (
          <span
            aria-disabled
            className={cn(linkClass, 'text-zinc-700 border-cyber-border cursor-not-allowed')}
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}


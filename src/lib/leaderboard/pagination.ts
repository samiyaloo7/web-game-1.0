/**
 * PAGINATION ARITHMETIC
 * =====================
 *
 * Pure functions, deliberately kept out of both `server.ts` (which is
 * `server-only`, so it cannot be imported by a test or a Client Component) and
 * the React components. Three call sites need to agree on what "page 3 of 2"
 * means — the data loader, the page, and the page controls — and the way they
 * disagree is by each doing the arithmetic itself.
 *
 * The load-bearing rule is that a page number is *clamped*, never trusted. A
 * hand-edited `?page=999` must resolve to the last real page, not to an empty
 * result set: an empty page and an empty board are different facts, and
 * rendering the empty board for the former is how a full leaderboard tells a
 * visitor that nobody has ever played.
 */

/** Hard ceiling, mirrored from `leaderboard_page`'s `least(50, …)`. */
export const MAX_PAGE_SIZE = 50;

export const DEFAULT_PAGE_SIZE = 25;

/**
 * Coerces a requested page size into `1..MAX_PAGE_SIZE`.
 *
 * A `?pageSize=` is never surfaced to the caller in this app, but the SQL
 * function clamps for the same reason: asking for a million rows is a cheap way
 * to pull an entire table and burn the project's free-tier egress quota.
 */
export function clampPageSize(pageSize: number): number {
  const size = Math.floor(pageSize);
  if (!Number.isFinite(size) || size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAX_PAGE_SIZE);
}

/**
 * How many pages exist for `totalEntries` rows. Always at least 1, so "page 1
 * of 1" is what an empty board reports rather than "page 1 of 0".
 */
export function totalPagesFor(totalEntries: number, pageSize: number): number {
  const size = clampPageSize(pageSize);
  const total = Number.isFinite(totalEntries) ? Math.max(0, Math.floor(totalEntries)) : 0;
  return Math.max(1, Math.ceil(total / size));
}

/**
 * Clamps a requested page into `1..totalPages`. A non-numeric, zero or negative
 * page becomes 1; anything past the end becomes the last real page.
 */
export function clampPage(page: number, totalPages: number): number {
  const requested = Math.floor(page);
  if (!Number.isFinite(requested) || requested < 1) return 1;
  const last = Number.isFinite(totalPages) ? Math.max(1, Math.floor(totalPages)) : 1;
  return Math.min(requested, last);
}

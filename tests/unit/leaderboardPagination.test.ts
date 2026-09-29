import { describe, it, expect } from 'vitest';
import {
  clampPage,
  clampPageSize,
  totalPagesFor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@/lib/leaderboard/pagination';

/**
 * PAGINATION MATH
 * ===============
 *
 * These are the pure rules behind "which rows does this page show". They are
 * worth testing directly because they are shared by three call sites (loader,
 * page, controls) and the failure mode is silent: an out-of-range page returns
 * zero rows, which the board would otherwise render as its empty state.
 */

describe('clampPageSize', () => {
  it('passes a sensible size through unchanged', () => {
    expect(clampPageSize(25)).toBe(25);
    expect(clampPageSize(1)).toBe(1);
  });

  it('caps a request above the SQL function ceiling', () => {
    expect(clampPageSize(1_000_000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(MAX_PAGE_SIZE + 1)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it('falls back to the default for zero, negative and non-numeric sizes', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampPageSize(bad)).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it('floors a fractional size rather than asking Postgres for part of a row', () => {
    expect(clampPageSize(10.9)).toBe(10);
  });
});

describe('totalPagesFor', () => {
  it('reports at least one page for an empty board', () => {
    expect(totalPagesFor(0, 25)).toBe(1);
  });

  it('rounds a partial final page up', () => {
    expect(totalPagesFor(25, 25)).toBe(1);
    expect(totalPagesFor(26, 25)).toBe(2);
    expect(totalPagesFor(50, 25)).toBe(2);
    expect(totalPagesFor(51, 25)).toBe(3);
  });

  it('never divides by zero — a bad page size clamps to the default', () => {
    expect(totalPagesFor(1, 0)).toBe(1);
    expect(totalPagesFor(26, 0)).toBe(2);
  });

  it('treats a nonsensical entry count as zero', () => {
    expect(totalPagesFor(Number.NaN, 25)).toBe(1);
    expect(totalPagesFor(-5, 25)).toBe(1);
  });
});

describe('clampPage', () => {
  it('keeps a page inside the range untouched', () => {
    expect(clampPage(2, 5)).toBe(2);
  });

  it('turns a missing or malformed page into page 1', () => {
    for (const bad of [0, -3, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(clampPage(bad, 5)).toBe(1);
    }
  });

  it('clamps past-the-end to the last real page', () => {
    expect(clampPage(999, 2)).toBe(2);
  });

  it('floors a fractional page', () => {
    expect(clampPage(3.9, 5)).toBe(3);
  });

  it('regression: a deep link past the end lands on a page that has rows, not the empty state', () => {
    // 30 entries at 25/page = 2 pages. The user asks for page 999.
    const totalEntries = 30;
    const pageSize = 25;
    const resolved = clampPage(999, totalPagesFor(totalEntries, pageSize));

    expect(resolved).toBe(2);
    // Page 2 is non-empty (rows 26..30), so the board renders rows rather than
    // "NO TRANSMISSIONS LOGGED".
    const offset = (resolved - 1) * pageSize;
    expect(totalEntries - offset).toBeGreaterThan(0);
  });
});

/**
 * HUD OCCLUSION GEOMETRY — pure, engine-free, and unit-testable.
 *
 * ## The problem this solves
 *
 * The HUD is a DOM overlay sitting above the canvas (see `GameView.tsx`), while
 * the simulation renders the whole city across a scrolling camera. A parcel, a
 * drop pad or a drone can therefore drift *underneath* an opaque HUD panel and
 * become invisible — the player is told to collect cargo they cannot see.
 *
 * ## The two mechanisms
 *
 * 1. **Occluder fade** — a panel whose rect intersects a tracked entity's rect
 *    drops to low alpha. The panel never disappears, so live readouts (timer,
 *    hull) stay available; it simply stops hiding the world.
 * 2. **Edge indicator** — a tracked entity outside the *safe area* (the viewport
 *    minus the HUD bands) gets a chevron pinned to the nearest safe edge, so it
 *    is always findable even when off-screen or behind a panel.
 *
 * ## Why this file has no Phaser import
 *
 * Every rule here is arithmetic on rectangles. Keeping it pure means the geometry
 * is testable in plain Node with no canvas — the same discipline as
 * `ProgressionMath` and `DroneBrain`. The scene supplies measured DOM rects and
 * consumes the results; it never computes them itself.
 *
 * Nothing here may import React or Phaser.
 */

/** Axis-aligned rectangle in screen space, in game pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A HUD panel that can occlude the world, identified so the UI can fade it. */
export interface Occluder extends Rect {
  /** Matches the panel's registered id, e.g. `hud-mission`. */
  id: string;
}

/**
 * The subset of `DOMRect` this module needs.
 *
 * Declaring it structurally rather than importing `DOMRect` keeps the module free of
 * DOM lib types, so it still compiles and unit-tests in a plain Node environment
 * (see `vitest.config.ts`) even though its inputs come from a browser.
 */
export interface DomRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converts a measured DOM rectangle into the canvas's own game-pixel space.
 *
 * ## Why this exists
 *
 * The panels are positioned by CSS, but the camera and the entities work in the
 * game's fixed 1280x720 coordinate system, and Phaser's `Scale.FIT` shrinks that
 * whole system to fit the container. A 150px panel is therefore *not* 150 game
 * units — it is `150 / scale`. Skipping the division would make every occluder too
 * large on a small screen (fading panels that hide nothing) and too small on a
 * large one (leaving the parcel hidden), which is exactly the bug being fixed.
 *
 * `canvas` is the rendered canvas's own rect, used as the origin: subtracting it
 * makes the result independent of where the game sits on the page.
 *
 * A zero-width/height canvas would divide by zero, so the scale falls back to 1 —
 * callers get the raw CSS rect instead of `Infinity`, which keeps the function
 * total for a canvas that has not been laid out yet.
 */
export function cssRectToGameRect(
  css: DomRectLike,
  canvas: DomRectLike,
  gameWidth: number,
  gameHeight: number
): Rect {
  const scaleX = canvas.width > 0 ? canvas.width / gameWidth : 1;
  const scaleY = canvas.height > 0 ? canvas.height / gameHeight : 1;

  return {
    x: (css.left - canvas.left) / scaleX,
    y: (css.top - canvas.top) / scaleY,
    width: css.width / scaleX,
    height: css.height / scaleY,
  };
}

/**
 * How far inside a viewport edge a panel may sit and still count as "anchored" to
 * that edge.
 *
 * The HUD is inset by Tailwind's `top-3 left-3 right-3` (12px), so a strict
 * "touches the edge exactly" test would match nothing and the safe area would
 * silently stay the full viewport — the bug this constant prevents. 32px is
 * comfortably above the layout inset yet far below any mid-screen panel, so a
 * genuinely floating panel still cannot drag the safe area around.
 */
const EDGE_ANCHOR_TOLERANCE = 32;

/** Slop so an entity touching a panel edge counts as occluded. */
export const OVERLAP_MARGIN = 6;

export function inflateRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

/**
 * Shrinks a rectangle inwards on all sides, clamped so it can never invert.
 *
 * The inverse of `inflateRect`, but deliberately not just `inflateRect(rect, -margin)`:
 * a rectangle narrower than twice the margin would otherwise come out with negative
 * extents, and `clampToSafeArea` — which divides by half of them — would mirror the
 * indicator clean out to the wrong side of the screen instead of failing visibly.
 * Clamping instead collapses the rectangle onto its own centre, which stays total.
 *
 * Used to pull the objective indicator inside the safe area by its own length, so the
 * chevron's tip rests *on* the boundary rather than half-tucking under the panel it is
 * pointing past.
 */
export function deflateRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x + Math.min(margin, rect.width / 2),
    y: rect.y + Math.min(margin, rect.height / 2),
    width: Math.max(0, rect.width - margin * 2),
    height: Math.max(0, rect.height - margin * 2),
  };
}

/** True when two rectangles overlap, optionally with a tolerance margin. */
export function rectsIntersect(a: Rect, b: Rect, margin = 0): boolean {
  const left = inflateRect(a, margin);
  const right = inflateRect(b, 0);

  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

/** True when a point lies inside a rectangle. */
export function pointInRect(point: Point, rect: Rect, margin = 0): boolean {
  const padded = inflateRect(rect, margin);
  return (
    point.x >= padded.x &&
    point.x <= padded.x + padded.width &&
    point.y >= padded.y &&
    point.y <= padded.y + padded.height
  );
}

/**
 * The safe area: the viewport shrunk on the edges that HUD panels actually cover.
 *
 * ## Why an inset rectangle rather than the exact complement of the panel shapes
 *
 * A rectangle is cheap to clamp against and *guarantees* the chevrons never sit
 * under a panel, while `rectsIntersect` still handles the finer-grained fade. The
 * safe area is the conservative half of the solution; the fade is the precise
 * half.
 *
 * ## Why left/right insets need a panel that spans the full height
 *
 * This is the subtle part, and getting it wrong is expensive. The HUD is a TOP BAR:
 * a 512x150 panel in the top-left. If a left inset were taken from that panel, the
 * safe area would exclude the entire left column down to the floor — but the world
 * is perfectly visible down there once you are below y=162. Insets are only
 * justified for edges a panel genuinely hugs *for its whole length*, i.e. a true
 * full-height sidebar. A top bar therefore contributes to `top` alone.
 *
 * Top and bottom are different: any panel anchored to the top pushes the top edge
 * down by its own height, which is exactly the band it occupies.
 */
export function computeSafeArea(viewport: Rect, occluders: readonly Occluder[]): Rect {
  const right = viewport.x + viewport.width;
  const bottom = viewport.y + viewport.height;

  let top = 0;
  let bottomInset = 0;
  let left = 0;
  let rightInset = 0;

  for (const panel of occluders) {
    if (panel.width <= 0 || panel.height <= 0) continue;

    const panelRight = panel.x + panel.width;
    const panelBottom = panel.y + panel.height;

    const anchoredTop = panel.y <= viewport.y + EDGE_ANCHOR_TOLERANCE;
    const anchoredBottom = panelBottom >= bottom - EDGE_ANCHOR_TOLERANCE;
    const anchoredLeft = panel.x <= viewport.x + EDGE_ANCHOR_TOLERANCE;
    const anchoredRight = panelRight >= right - EDGE_ANCHOR_TOLERANCE;

    // A top/bottom band is exactly as deep as the panel is tall.
    if (anchoredTop) top = Math.max(top, panelBottom - viewport.y);
    if (anchoredBottom) bottomInset = Math.max(bottomInset, bottom - panel.y);

    // A side inset requires a panel that spans the full height, otherwise the
    // whole column below a top-corner panel would be needlessly excluded.
    const isFullHeightSidebar = anchoredLeft && anchoredBottom;
    if (isFullHeightSidebar) left = Math.max(left, panelRight - viewport.x);

    const isFullHeightRightSidebar = anchoredRight && anchoredBottom;
    if (isFullHeightRightSidebar) rightInset = Math.max(rightInset, right - panel.x);
  }

  // Clamp so an oversized panel cannot invert the rectangle. A zero-size safe
  // area degenerates to the viewport centre, which keeps clamping total instead
  // of producing NaN.
  const width = Math.max(0, viewport.width - left - rightInset);
  const height = Math.max(0, viewport.height - top - bottomInset);

  return {
    x: viewport.x + Math.min(left, viewport.width),
    y: viewport.y + Math.min(top, viewport.height),
    width,
    height,
  };
}

/**
 * Projects a point onto the safe area's boundary along the ray from its centre.
 *
 * Scaling by the smaller of the two axis ratios is what preserves *direction*,
 * which is the whole point of an indicator: an entity up-and-right must produce a
 * chevron up-and-right, not one that slides along an edge.
 *
 * A point already inside the safe area is returned unchanged, so callers can call
 * this unconditionally instead of branching on "is it off-screen" themselves.
 */
export function clampToSafeArea(point: Point, safe: Rect): Point {
  const centreX = safe.x + safe.width / 2;
  const centreY = safe.y + safe.height / 2;
  const halfWidth = safe.width / 2;
  const halfHeight = safe.height / 2;

  if (
    point.x >= safe.x &&
    point.x <= safe.x + safe.width &&
    point.y >= safe.y &&
    point.y <= safe.y + safe.height
  ) {
    return { x: point.x, y: point.y };
  }

  const dx = point.x - centreX;
  const dy = point.y - centreY;

  // Degenerate axes are skipped rather than divided by: a perfectly horizontal
  // ray must clamp on x alone instead of collapsing to the centre.
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  if (!Number.isFinite(scale)) {
    return { x: centreX, y: centreY };
  }

  return { x: centreX + dx * scale, y: centreY + dy * scale };
}

/**
 * Angle of an indicator chevron in radians, pointing from the safe-area boundary
 * toward the entity.
 *
 * Separate from `clampToSafeArea` so chevron orientation can be asserted without
 * pinning exact coordinates.
 */
export function indicatorAngle(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * A stable string identifying which panels are currently occluding something.
 *
 * The scene compares this against the previous value and emits only on a change —
 * the same signature-gating trick `emitVitals` uses. That is what keeps this
 * compatible with `ARCHITECTURE.md` §11 React Render Shielding: a courier weaving
 * under a panel boundary may cross it many times a second, but React is told only
 * when the *set* of occluded panels actually differs.
 *
 * Sorting is load-bearing: an unordered join would report a spurious change
 * whenever the panels were visited in a different order.
 */
export function computeOcclusionSignature(occludedIds: readonly string[]): string {
  return [...occludedIds].sort().join('|');
}

/** Ids of every panel whose rect overlaps the given entity rect. */
export function findOccludersFor(
  entityRect: Rect,
  occluders: readonly Occluder[],
  margin = OVERLAP_MARGIN
): string[] {
  return occluders
    .filter((panel) => rectsIntersect(entityRect, panel, margin))
    .map((panel) => panel.id);
}

import { describe, it, expect } from 'vitest';
import {
  rectsIntersect,
  pointInRect,
  inflateRect,
  deflateRect,
  computeSafeArea,
  clampToSafeArea,
  indicatorAngle,
  computeOcclusionSignature,
  findOccludersFor,
  cssRectToGameRect,
  type Rect,
  type Occluder,
} from '@/game/systems/HudOcclusion';

/**
 * Geometry for the HUD occlusion fix.
 *
 * These use the real numbers from `config.ts` (1280x720) and the real HUD layout
 * (`GameView.tsx`), so a regression in either shows up here rather than as an
 * invisible chevron on screen.
 */

const VIEWPORT: Rect = { x: 0, y: 0, width: 1280, height: 720 };

/** Mirrors GameHudMission: `max-w-lg` (512px) at `top-3 left-3` (12px inset). */
const MISSION_PANEL: Occluder = { id: 'hud-mission', x: 12, y: 12, width: 512, height: 150 };

/** Mirrors the right-hand stats + controls stack. */
const STATS_PANEL: Occluder = { id: 'hud-stats', x: 900, y: 12, width: 368, height: 90 };

const BOTH = [MISSION_PANEL, STATS_PANEL];

describe('rectsIntersect', () => {
  it('detects a clear overlap', () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })
    ).toBe(true);
  });

  it('separates rectangles on each axis', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(rect, { x: 20, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsIntersect(rect, { x: 0, y: 20, width: 10, height: 10 })).toBe(false);
  });

  it('treats edge-to-edge contact as NOT overlapping (no flicker on a seam)', () => {
    // Without this, a panel boundary would flicker the fade on and off as an
    // entity tracked exactly along it.
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(
      false
    );
  });

  it('a positive margin turns a near miss into an overlap', () => {
    // The mission panel ends at x=524; this entity starts 4px clear of it.
    const entity = { x: 528, y: 100, width: 40, height: 40 };
    expect(rectsIntersect(entity, MISSION_PANEL)).toBe(false);
    expect(rectsIntersect(entity, MISSION_PANEL, 6)).toBe(true);
  });

  it('handles containment in both directions', () => {
    const big = { x: 0, y: 0, width: 100, height: 100 };
    const small = { x: 40, y: 40, width: 10, height: 10 };
    expect(rectsIntersect(big, small)).toBe(true);
    expect(rectsIntersect(small, big)).toBe(true);
  });
});

describe('pointInRect', () => {
  it('includes the boundary', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(pointInRect({ x: 0, y: 0 }, rect)).toBe(true);
    expect(pointInRect({ x: 10, y: 10 }, rect)).toBe(true);
    expect(pointInRect({ x: 11, y: 5 }, rect)).toBe(false);
  });
});

describe('inflateRect', () => {
  it('grows in every direction and preserves the centre', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    const grown = inflateRect(rect, 5);
    expect(grown).toEqual({ x: 5, y: 15, width: 110, height: 60 });
    expect(grown.x + grown.width / 2).toBe(rect.x + rect.width / 2);
    expect(grown.y + grown.height / 2).toBe(rect.y + rect.height / 2);
  });
});

describe('computeSafeArea', () => {
  it('is the full viewport when nothing occludes', () => {
    expect(computeSafeArea(VIEWPORT, [])).toEqual(VIEWPORT);
  });

  it('insets the top by the tallest top-anchored panel', () => {
    expect(computeSafeArea(VIEWPORT, [MISSION_PANEL]).y).toBe(162); // 12 + 150
  });

  it('does NOT inset the sides for a top-bar panel', () => {
    // The regression this guards: treating a 512x150 top-left panel as a left
    // sidebar would exclude the entire left column, which is fully visible below
    // the panel.
    const safe = computeSafeArea(VIEWPORT, BOTH);
    expect(safe.x).toBe(0);
    expect(safe.x + safe.width).toBe(VIEWPORT.width);
    expect(safe.y + safe.height).toBe(VIEWPORT.height);
  });

  it('insets the left for a genuine full-height sidebar', () => {
    const sidebar: Occluder = { id: 'side', x: 0, y: 0, width: 200, height: VIEWPORT.height };
    const safe = computeSafeArea(VIEWPORT, [sidebar]);
    expect(safe.x).toBe(200);
    expect(safe.width).toBe(1080);
  });

  it('insets the right for a full-height sidebar too', () => {
    const sidebar: Occluder = {
      id: 'side',
      x: VIEWPORT.width - 120,
      y: 0,
      width: 120,
      height: VIEWPORT.height,
    };
    expect(computeSafeArea(VIEWPORT, [sidebar]).x + computeSafeArea(VIEWPORT, [sidebar]).width).toBe(
      VIEWPORT.width - 120
    );
  });

  it('insets the bottom for a bottom-anchored bar', () => {
    const bar: Occluder = { id: 'bar', x: 0, y: VIEWPORT.height - 40, width: 400, height: 40 };
    const safe = computeSafeArea(VIEWPORT, [bar]);
    expect(safe.y + safe.height).toBe(VIEWPORT.height - 40);
  });

  it('takes the MAXIMUM inset when several panels share an edge', () => {
    const tall: Occluder = { id: 'tall', x: 0, y: 0, width: 100, height: 300 };
    const short: Occluder = { id: 'short', x: 300, y: 0, width: 400, height: 50 };
    const safe = computeSafeArea(VIEWPORT, [tall, short]);
    expect(safe.y).toBe(300); // 300 > 50
  });

  it('ignores zero-sized panels', () => {
    const collapsed: Occluder = { id: 'gone', x: 0, y: 0, width: 0, height: 0 };
    expect(computeSafeArea(VIEWPORT, [collapsed])).toEqual(VIEWPORT);
  });

  it('never inverts or goes negative for an oversized panel', () => {
    const safe = computeSafeArea(VIEWPORT, [{ id: 'huge', x: 0, y: 0, width: 5000, height: 5000 }]);
    expect(safe.width).toBeGreaterThanOrEqual(0);
    expect(safe.height).toBeGreaterThanOrEqual(0);
  });

  it('with the real HUD the safe area is the full width below the top bar', () => {
    const safe = computeSafeArea(VIEWPORT, BOTH);
    expect(safe.y).toBe(162);
    expect(safe.width).toBe(VIEWPORT.width);
  });
});

describe('clampToSafeArea', () => {
  const safe = computeSafeArea(VIEWPORT, BOTH);
  const centre = { x: safe.x + safe.width / 2, y: safe.y + safe.height / 2 };

  it('leaves an interior point untouched', () => {
    expect(clampToSafeArea(centre, safe)).toEqual(centre);
  });

  it('clamps a point above the viewport to the safe top edge', () => {
    expect(clampToSafeArea({ x: centre.x, y: -500 }, safe).y).toBeCloseTo(safe.y, 6);
  });

  it('clamps a point far right to the safe right edge', () => {
    expect(clampToSafeArea({ x: 5000, y: centre.y }, safe).x).toBeCloseTo(
      safe.x + safe.width,
      6
    );
  });

  it('PRESERVES DIRECTION — the property the indicator depends on', () => {
    // A diagonal ray exits through a CORNER, not an edge, so assert the sign of
    // each component relative to the centre rather than an exact edge value.
    const upRight = clampToSafeArea({ x: 5000, y: -500 }, safe);
    expect(upRight.x).toBeGreaterThan(centre.x);
    expect(upRight.y).toBeLessThan(centre.y);

    const downLeft = clampToSafeArea({ x: -5000, y: 5000 }, safe);
    expect(downLeft.x).toBeLessThan(centre.x);
    expect(downLeft.y).toBeGreaterThan(centre.y);
  });

  it('an axis-aligned ray lands exactly on that edge', () => {
    // The pure-horizontal / pure-vertical cases are the ones a chevron actually
    // follows, and they must be exact so the arrow sits flush on the boundary.
    const straightDown = clampToSafeArea({ x: centre.x, y: 5000 }, safe);
    expect(straightDown.y).toBeCloseTo(safe.y + safe.height, 6);
    expect(straightDown.x).toBeCloseTo(centre.x, 6);
  });

  it('does not collapse to the centre on a perfectly horizontal ray', () => {
    const clamped = clampToSafeArea({ x: 5000, y: centre.y }, safe);
    expect(clamped.y).toBeCloseTo(centre.y, 6);
    expect(clamped.x).toBeCloseTo(safe.x + safe.width, 6);
  });

  it('does not collapse to the centre on a perfectly vertical ray', () => {
    const clamped = clampToSafeArea({ x: centre.x, y: -500 }, safe);
    expect(clamped.x).toBeCloseTo(centre.x, 6);
    expect(clamped.y).toBeCloseTo(safe.y, 6);
  });

  it('always lands on or inside the safe boundary', () => {
    for (const point of [
      { x: -9999, y: -9999 },
      { x: 9999, y: -9999 },
      { x: -9999, y: 9999 },
      { x: 9999, y: 9999 },
      { x: 640, y: 400 },
    ]) {
      const clamped = clampToSafeArea(point, safe);
      expect(clamped.x).toBeGreaterThanOrEqual(safe.x - 1e-6);
      expect(clamped.x).toBeLessThanOrEqual(safe.x + safe.width + 1e-6);
      expect(clamped.y).toBeGreaterThanOrEqual(safe.y - 1e-6);
      expect(clamped.y).toBeLessThanOrEqual(safe.y + safe.height + 1e-6);
    }
  });

  it('stays finite when the safe area has collapsed to a point', () => {
    const clamped = clampToSafeArea({ x: 100, y: 100 }, { x: 640, y: 360, width: 0, height: 0 });
    expect(Number.isFinite(clamped.x)).toBe(true);
    expect(Number.isFinite(clamped.y)).toBe(true);
  });
});

describe('indicatorAngle', () => {
  it('points right at 0 and down-left at 135 degrees', () => {
    expect(indicatorAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 6);
    expect(indicatorAngle({ x: 0, y: 0 }, { x: -10, y: 10 })).toBeCloseTo(Math.PI * 0.75, 6);
  });

  it('points from the clamped boundary position toward the target', () => {
    const safe = computeSafeArea(VIEWPORT, BOTH);
    // A point far above the safe area clamps to the top edge directly above the
    // centre, so the chevron must point straight up.
    const target = { x: safe.x + safe.width / 2, y: safe.y - 200 };
    const angle = indicatorAngle(clampToSafeArea(target, safe), target);
    expect(Math.sin(angle)).toBeCloseTo(-1, 6);
  });

  it('points up-left for a target behind the top-left mission panel', () => {
    const safe = computeSafeArea(VIEWPORT, BOTH);
    // Behind the mission panel: the panel occupies y 12..162, so a target inside
    // it clamps DOWN to the safe top edge and the chevron points up-left.
    const target = { x: 60, y: 40 };
    const clamped = clampToSafeArea(target, safe);
    expect(clamped.y).toBeCloseTo(safe.y, 6);
    const angle = indicatorAngle(clamped, target);
    expect(Math.cos(angle)).toBeLessThan(0);
    expect(Math.sin(angle)).toBeLessThan(0);
  });
});

describe('computeOcclusionSignature', () => {
  it('is order-independent so panel order cannot cause a phantom change', () => {
    expect(computeOcclusionSignature(['a', 'b'])).toBe(computeOcclusionSignature(['b', 'a']));
  });

  it('distinguishes different sets', () => {
    expect(computeOcclusionSignature(['a'])).not.toBe(computeOcclusionSignature(['a', 'b']));
  });

  it('represents "nothing occluded" as an empty string', () => {
    expect(computeOcclusionSignature([])).toBe('');
  });
});

describe('findOccludersFor', () => {
  it('finds the panel covering an entity in the top-left', () => {
    expect(findOccludersFor({ x: 60, y: 40, width: 40, height: 40 }, BOTH)).toEqual(['hud-mission']);
  });

  it('finds the panel covering an entity in the top-right', () => {
    expect(findOccludersFor({ x: 960, y: 30, width: 40, height: 40 }, BOTH)).toEqual(['hud-stats']);
  });

  it('returns nothing for an entity in open ground', () => {
    expect(findOccludersFor({ x: 600, y: 500, width: 40, height: 40 }, BOTH)).toEqual([]);
  });

  it('finds both when panels overlap each other', () => {
    const wide: Rect = { x: 0, y: 0, width: VIEWPORT.width, height: 40 };
    expect(findOccludersFor(wide, BOTH).sort()).toEqual(['hud-mission', 'hud-stats']);
  });

  it('returns nothing when there are no panels', () => {
    expect(findOccludersFor({ x: 0, y: 0, width: 10, height: 10 }, [])).toEqual([]);
  });
});

describe('cssRectToGameRect', () => {
  /** A canvas rendered at exactly its game size: no scaling, no letterbox. */
  const UNSCALED_CANVAS = { left: 0, top: 0, width: 1280, height: 720 };

  it('is an identity mapping when the canvas is at its native size', () => {
    expect(
      cssRectToGameRect(
        { left: 12, top: 12, width: 512, height: 150 },
        UNSCALED_CANVAS,
        VIEWPORT.width,
        VIEWPORT.height
      )
    ).toEqual({ x: 12, y: 12, width: 512, height: 150 });
  });

  it('divides by the render scale when the canvas is shrunk to fit', () => {
    // A 640px-wide canvas means Scale.FIT halved everything: a 512px panel occupies
    // 1024 game units, not 512. Getting this wrong is the difference between fading
    // a panel that hides nothing and leaving the parcel underneath one.
    const canvas = { left: 0, top: 0, width: 640, height: 360 };

    expect(
      cssRectToGameRect({ left: 6, top: 6, width: 256, height: 75 }, canvas, 1280, 720)
    ).toEqual({ x: 12, y: 12, width: 512, height: 150 });
  });

  it('scales up when the canvas is rendered larger than the game size', () => {
    const canvas = { left: 0, top: 0, width: 2560, height: 1440 };

    expect(
      cssRectToGameRect({ left: 24, top: 24, width: 1024, height: 300 }, canvas, 1280, 720)
    ).toEqual({ x: 12, y: 12, width: 512, height: 150 });
  });

  it('subtracts the canvas origin, so page position does not shift the rects', () => {
    // The game sits 100px down and 50px in on the page. The canvas is a plain 1280px
    // wide box, so the mapping is 1:1 but anchored at the canvas's own corner.
    const canvas = { left: 50, top: 100, width: 1280, height: 720 };

    expect(
      cssRectToGameRect({ left: 62, top: 112, width: 512, height: 150 }, canvas, 1280, 720)
    ).toEqual({ x: 12, y: 12, width: 512, height: 150 });
  });

  it('falls back to a 1:1 mapping for a canvas that has not been laid out yet', () => {
    // Guards against Infinity/NaN leaking into the occluder list on the first
    // measurement, before Phaser has given the canvas a box.
    const canvas = { left: 0, top: 0, width: 0, height: 0 };

    expect(
      cssRectToGameRect({ left: 12, top: 12, width: 512, height: 150 }, canvas, 1280, 720)
    ).toEqual({ x: 12, y: 12, width: 512, height: 150 });
  });

  it('produces a rect the safe-area maths accepts (round trip through a real layout)', () => {
    // The mission panel as the browser would report it inside a 640px-wide canvas,
    // fed through the same pipeline the scene uses.
    const canvas = { left: 0, top: 0, width: 640, height: 360 };
    const panel = cssRectToGameRect(
      { left: 6, top: 6, width: 256, height: 75 },
      canvas,
      VIEWPORT.width,
      VIEWPORT.height
    );

    const occluder: Occluder = { id: 'hud-mission', ...panel };
    const safe = computeSafeArea(VIEWPORT, [occluder]);

    // Panel bottom is at y=162 in game units, so the top band must be exactly that.
    expect(safe.y).toBe(162);
    // ...and because it is a top bar rather than a full-height sidebar, it must not
    // eat the left column.
    expect(safe.x).toBe(0);
    expect(safe.width).toBe(VIEWPORT.width);
  });
});

describe('deflateRect', () => {
  it('shrinks a rectangle inwards on every side, keeping it centred', () => {
    expect(deflateRect({ x: 0, y: 0, width: 100, height: 60 }, 10)).toEqual({
      x: 10,
      y: 10,
      width: 80,
      height: 40,
    });
  });

  it('is the exact inverse of inflateRect for a rectangle that can absorb it', () => {
    const rect: Rect = { x: 12, y: 12, width: 512, height: 150 };
    expect(deflateRect(inflateRect(rect, 8), 8)).toEqual(rect);
  });

  it('clamps to zero rather than inverting when the margin exceeds the rect', () => {
    // An inverted rect would make `clampToSafeArea` divide by a negative half-extent
    // and mirror the indicator to the wrong side of the screen.
    expect(deflateRect({ x: 10, y: 20, width: 30, height: 10 }, 40)).toEqual({
      x: 25,
      y: 25,
      width: 0,
      height: 0,
    });
  });

  it('leaves a degenerate rect at its own centre instead of producing NaN', () => {
    const collapsed = deflateRect({ x: 5, y: 5, width: 0, height: 0 }, 20);
    expect(collapsed).toEqual({ x: 5, y: 5, width: 0, height: 0 });
    expect(clampToSafeArea({ x: 900, y: 900 }, collapsed)).toEqual({ x: 5, y: 5 });
  });
});

describe('objective indicator placement', () => {
  /**
   * Reproduces `GameScene.drawObjectiveIndicator`: pull the safe boundary in by the
   * chevron's reach, then clamp along the ray to the objective.
   */
  const INDICATOR_REACH = 20;

  const safe = computeSafeArea(VIEWPORT, BOTH);

  const placeIndicator = (target: { x: number; y: number }) =>
    clampToSafeArea(target, deflateRect(safe, INDICATOR_REACH));

  it('anchors the marker fully clear of the panel that is covering the parcel', () => {
    // The mission panel covers y < 162, so this crate is hidden behind it.
    const hiddenParcel = { x: 200, y: 80 };
    expect(pointInRect(hiddenParcel, safe)).toBe(false);

    const anchor = placeIndicator(hiddenParcel);

    // The anchor sits a full chevron's length below the panel's bottom edge, so the
    // tip lands on the boundary rather than disappearing under the panel.
    expect(anchor.y).toBe(safe.y + INDICATOR_REACH);

    // ...and the marker still points upward at the crate, not sideways along the edge.
    expect(indicatorAngle(anchor, hiddenParcel)).toBeLessThan(-Math.PI / 2);
  });

  it('keeps the anchor inside the viewport for an objective off the left edge', () => {
    // Level with the centre of the safe area, so the ray is purely horizontal. (The
    // clamp origin is the safe area's centre, not the viewport's, because the top band
    // shifts it down.)
    const target = { x: -400, y: safe.y + safe.height / 2 };
    const anchor = placeIndicator(target);

    expect(anchor.x).toBeGreaterThan(0);
    expect(anchor.x).toBeLessThan(safe.width / 2);

    // Dead-level objective: the chevron must point straight left, not drift along the
    // top or bottom edge. Asserted as direction rather than an exact angle so the sign
    // of zero in `atan2` cannot make this flake.
    const angle = indicatorAngle(anchor, target);
    expect(Math.abs(Math.sin(angle))).toBeLessThan(1e-9);
    expect(Math.cos(angle)).toBeCloseTo(-1, 9);
  });

  it('never places an anchor under any panel', () => {
    // Sweep the whole screen and assert every resulting anchor is in clear air.
    for (let x = -200; x <= VIEWPORT.width + 200; x += 40) {
      for (let y = -200; y <= VIEWPORT.height + 200; y += 40) {
        const target = { x, y };
        if (pointInRect(target, safe)) continue;

        const anchor = placeIndicator(target);
        expect(findOccludersFor({ ...anchor, width: 0, height: 0 }, BOTH)).toEqual([]);
      }
    }
  });
});

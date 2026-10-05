'use client';

import { useEffect, type RefObject } from 'react';
import { EventBus } from '@/game/EventBus';
import { cssRectToGameRect, type Occluder } from '@/game/systems/HudOcclusion';
import { GAME_HEIGHT, GAME_WIDTH } from '@/game/viewport';
import { useGameStore } from '@/stores/useGameStore';

/**
 * Attribute every occluder panel must carry on its outermost element.
 *
 * Panels are discovered by attribute rather than by a hard-coded selector list, so
 * adding a new HUD panel is one attribute — there is no registry to keep in step,
 * and no way for the two halves to disagree about the panel's size.
 */
export const HUD_PANEL_ATTRIBUTE = 'data-hud-panel';

/**
 * Ids a panel may register under.
 *
 * A union rather than `string` so a typo in either the markup or a consumer is a
 * compile error, instead of a panel that silently never fades.
 */
export type HudPanelId =
  | 'hud-mission'
  | 'hud-vitals'
  | 'hud-stats'
  | 'hud-controls'
  | 'hud-audio'
  | 'hud-challenge';

/**
 * Opacity a panel drops to while it is covering the world.
 *
 * Deliberately not zero: the mission timer, the hull bar and the pause control stay
 * legible if the player looks for them — they simply stop being an opaque wall over
 * the district. That is what makes this safe to apply to *every* tracked entity,
 * including the courier itself.
 */
export const OCCLUDED_PANEL_CLASS = 'opacity-20';

/**
 * Measures the HUD panels and publishes their rects to the simulation.
 *
 * ## Why React measures and Phaser decides
 *
 * The scene knows what is on screen (it owns the camera) but cannot see panel sizes —
 * they are decided by CSS text flow. React can measure them but has no idea where the
 * courier is. So each side contributes its half: this hook reports *where the panels
 * are*, and `GameScene` reports back *what they are covering*.
 *
 * Measurements are pushed only on real layout changes (`ResizeObserver` plus window
 * resize), never per frame, which keeps this compatible with the render-shielding
 * rule in `ARCHITECTURE.md` §11.
 *
 * @param rootRef the element containing both the Phaser canvas and the HUD panels.
 */
export function useHudOcclusion(rootRef: RefObject<HTMLElement | null>): void {
  /**
   * Phaser creates its canvas asynchronously, long after this component mounts, so a
   * first measurement would find nothing to anchor against. `game:ready` is the
   * signal that the canvas exists, and it re-runs this effect at exactly the right
   * moment.
   */
  const isEngineReady = useGameStore((s) => s.isEngineReady);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const measure = () => {
      const canvas = root.querySelector('canvas');
      if (!canvas) return;

      const canvasRect = canvas.getBoundingClientRect();
      // Before the first layout pass the canvas has no box at all; publishing now
      // would scale every panel by a nonsense factor.
      if (canvasRect.width <= 0 || canvasRect.height <= 0) return;

      const occluders: Occluder[] = [];

      root.querySelectorAll<HTMLElement>(`[${HUD_PANEL_ATTRIBUTE}]`).forEach((panel) => {
        const id = panel.getAttribute(HUD_PANEL_ATTRIBUTE);
        // A panel hidden at this breakpoint (`display: none`) has no box and cannot
        // cover anything, so it is simply not reported.
        if (!id) return;

        const rect = panel.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        occluders.push({
          id,
          ...cssRectToGameRect(rect, canvasRect, GAME_WIDTH, GAME_HEIGHT),
        });
      });

      EventBus.sendCommand('cmd:sync-hud-occluders', { occluders });
    };

    measure();

    /**
     * Panels resize for reasons React never re-renders for: the mission timer losing
     * a digit, credits crossing into the thousands, a `sm:` breakpoint flipping the
     * layout. `ResizeObserver` catches all of them and also fires once immediately,
     * so no separate initial pass is required for the panels themselves.
     */
    const observer = new ResizeObserver(measure);
    root.querySelectorAll(`[${HUD_PANEL_ATTRIBUTE}]`).forEach((panel) => observer.observe(panel));
    observer.observe(root);

    // `Scale.FIT` re-lays the canvas out on every window resize, which changes the
    // CSS-to-game scale factor the rects are divided by.
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [rootRef, isEngineReady]);
}

/**
 * True while a HUD panel is covering something the courier needs to see.
 *
 * Returns a boolean rather than the id array so the selector result stays a stable
 * primitive — subscribing to the array would re-render the panel whenever *any*
 * occluder changed, defeating the point of the scene's signature gating.
 */
export function usePanelOccluded(id: HudPanelId): boolean {
  return useGameStore((s) => s.occludedPanelIds.includes(id));
}
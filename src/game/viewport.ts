/**
 * The game's fixed internal resolution.
 *
 * Phaser renders the whole simulation in this coordinate system and `Scale.FIT`
 * shrinks the finished canvas to whatever the page gives it. Two very different
 * consumers need the same numbers:
 *
 * - `config.ts` — the engine's own width/height.
 * - the HUD, to convert measured CSS pixels back into game pixels
 *   (`cssRectToGameRect`) so panel rects can be compared against camera-space
 *   entity positions.
 *
 * It lives in its own module, with no imports, so the React side can share the
 * numbers without dragging Phaser (or the scene graph) into its import graph.
 */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
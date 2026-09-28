import type { DeliveryLocation } from './delivery';

/**
 * Pure, Phaser-free description of a generated city.
 *
 * Everything in this file is plain data. Nothing here depends on the rendering
 * engine, which means the generator can be unit tested in Node and the same map
 * can later be rendered by Phaser, drawn on a minimap, or sent to a server.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Knobs that control the shape of a generated city.
 * `generateCity()` clamps every value into a safe range, so partial configs are fine.
 */
export interface CityConfig {
  /** Deterministic random seed. The same seed always reproduces the same city. */
  seed: number | string;
  /** Number of city blocks horizontally. */
  cols: number;
  /** Number of city blocks vertically. */
  rows: number;
  /** Distance between two adjacent road centerlines (one block). */
  cellSize: number;
  /** Drivable width of every road. */
  roadWidth: number;
  /** Gap kept between a building footprint and the road surface. */
  buildingMargin: number;
  /** Smallest building footprint as a fraction of the available block space. */
  buildingMinScale: number;
  /** Chance (0..1) that a road segment hosts a mission location. */
  locationDensity: number;
  /** Chance (0..1) that a road segment hosts an obstacle. */
  obstacleDensity: number;
  /** Minimum straight-line distance between a pickup and its drop-off. */
  minMissionDistance: number;
}

export type RoadOrientation = 'horizontal' | 'vertical';

/**
 * A single full-length road. Vertical roads are called avenues, horizontal roads streets.
 * `center` is the centerline coordinate on the perpendicular axis.
 */
export interface CityRoad {
  id: string;
  orientation: RoadOrientation;
  center: number;
  /** Start/end of the road along its own axis, in world pixels. */
  start: number;
  end: number;
  width: number;
}

/** A road crossing. Intersections are always drivable and always connected. */
export interface CityIntersection {
  id: string;
  col: number;
  row: number;
  x: number;
  y: number;
}

/** A solid city block that the courier cannot drive through. */
export interface CityBuilding {
  id: string;
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1..3, purely visual: how tall/dense the building reads. */
  heightTier: number;
  /** Index into the renderer palette. */
  variant: number;
}

export type ObstacleKind = 'barrier' | 'wreck' | 'drone';

/**
 * A collidable hazard parked against the curb of a road.
 * Obstacles are intentionally small: a clear driving corridor always remains.
 */
export interface CityObstacle {
  id: string;
  segmentId: string;
  x: number;
  y: number;
  radius: number;
  kind: ObstacleKind;
}

/**
 * A curated road node that can host a pickup or a drop-off.
 * Locations always sit on drivable asphalt, so a mission can never be spawned
 * inside a building or off the road network.
 */
export interface CityLocation extends DeliveryLocation {
  /** The road segment this location sits beside. */
  segmentId: string;
  orientation: RoadOrientation;
}

/** A complete, self-contained generated city. */
export interface CityMap {
  config: CityConfig;
  /** Numeric seed actually used by the generator. */
  seed: number;
  /** Human-readable seed (the raw config value) for display and re-entry. */
  seedLabel: string;
  width: number;
  height: number;
  roads: CityRoad[];
  intersections: CityIntersection[];
  buildings: CityBuilding[];
  obstacles: CityObstacle[];
  locations: CityLocation[];
  /** Guaranteed-safe player start position. */
  spawn: CityIntersection;
}

/** Result of the generator's self-check. */
export interface CityValidationResult {
  valid: boolean;
  issues: string[];
}
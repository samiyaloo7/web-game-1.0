import type {
  CityBuilding,
  CityConfig,
  CityIntersection,
  CityLocation,
  CityMap,
  CityObstacle,
  CityRoad,
  CityValidationResult,
  ObstacleKind,
  RoadOrientation,
} from '../types/city';
import { CITY_ZONE_NAMES, LOCATION_TEMPLATES } from '../data/cityData';
import { SeededRandom } from './SeededRandom';

/**
 * Grid-based procedural city generator. Pure data in, pure data out: this module
 * must never import Phaser (see `CityRenderer` for the drawing half).
 *
 * Layout model
 * ------------
 * The city is a lattice of `cols x rows` blocks, which keeps connectivity trivial
 * to reason about:
 *
 *   - `cols + 1` vertical roads (avenues) and `rows + 1` horizontal roads (streets)
 *     are drawn as continuous spans across the whole map.
 *   - Because every road spans the full map, the road network is *fully connected
 *     by construction*. Every intersection can reach every other intersection, so a
 *     location placed on a road can never be unreachable.
 *   - Buildings fill the interior of each block, inset from the road surface, so
 *     they can never seal off a street.
 *   - Obstacles are small and parked at the curb, guaranteeing a clear corridor.
 *
 * World size = `roadWidth + cols * cellSize`, so map size is fully configurable
 * through `CityConfig`.
 */

/**
 * Free driving width (px) that must remain beside any obstacle.
 * The player hitbox is 24px wide; 28 leaves a margin, so squeezing past an
 * obstacle is tight but always possible instead of impossible.
 */
export const PLAYER_CLEARANCE = 28;

/**
 * Smallest road width that still leaves a passable corridor beside a
 * curb-hugging obstacle. Working the formulas below backwards:
 * `corridor = roadWidth/2 + curbOffset - radius ≈ roadWidth * 0.6 - 6`,
 * so 64px yields a 32px corridor — comfortably above `PLAYER_CLEARANCE`.
 */
export const MIN_ROAD_WIDTH = 64;

/** Smallest block size that fits a full-width road plus a usable building footprint. */
export const MIN_CELL_SIZE = 140;

/** Keep-out radius around a mission location so obstacles never cover a beacon. */
export const LOCATION_CLEARANCE_RADIUS = 56;

/** Slack allowed when checking that a location sits on asphalt. */
const LOCATION_ROAD_TOLERANCE = 4;

/** Sensible defaults: a 1464 x 1064 city, larger than the 1280x720 camera. */
export const DEFAULT_CITY_CONFIG: CityConfig = {
  seed: 0,
  cols: 7,
  rows: 5,
  cellSize: 200,
  roadWidth: 64,
  buildingMargin: 12,
  buildingMinScale: 0.6,
  locationDensity: 0.5,
  obstacleDensity: 0.35,
  minMissionDistance: 360,
};

/** Rolls a time-based seed so every fresh run generates a different city. */
export function createRunSeed(): number {
  return Date.now() % 2147483647;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Merges a partial config over the defaults and clamps it into a buildable range. */
export function resolveCityConfig(partial: Partial<CityConfig> = {}): CityConfig {
  const merged = { ...DEFAULT_CITY_CONFIG, ...partial };
  const cellSize = clampInt(merged.cellSize, MIN_CELL_SIZE, 600);

  return {
    seed: merged.seed,
    cols: clampInt(merged.cols, 2, 24),
    rows: clampInt(merged.rows, 2, 24),
    cellSize,
    // Roads may never exceed half a block (no room for buildings) nor shrink below
    // the width that keeps a passable corridor beside an obstacle.
    roadWidth: clampInt(merged.roadWidth, MIN_ROAD_WIDTH, Math.floor(cellSize / 2)),
    buildingMargin: clampInt(merged.buildingMargin, 0, 40),
    buildingMinScale: clampFloat(merged.buildingMinScale, 0.3, 1),
    locationDensity: clampFloat(merged.locationDensity, 0, 1),
    obstacleDensity: clampFloat(merged.obstacleDensity, 0, 1),
    minMissionDistance: clampInt(merged.minMissionDistance, 0, 10000),
  };
}

/**
 * Road centerlines are offset by half a road width from the map edge, so the
 * outermost road is fully inside the world instead of half off-screen.
 */
export function getAvenueX(config: CityConfig, col: number): number {
  return Math.round(config.roadWidth / 2 + col * config.cellSize);
}

export function getStreetY(config: CityConfig, row: number): number {
  return Math.round(config.roadWidth / 2 + row * config.cellSize);
}

export function getWorldSize(config: CityConfig): { width: number; height: number } {
  return {
    width: Math.round(config.roadWidth + config.cols * config.cellSize),
    height: Math.round(config.roadWidth + config.rows * config.cellSize),
  };
}

/** Obstacle footprint scales with road width so the layout stays proportional. */
export function computeObstacleRadius(roadWidth: number): number {
  return Math.max(8, Math.round(roadWidth * 0.2));
}

/** How far an obstacle sits from the road centerline, hugging the curb. */
export function computeObstacleCurbOffset(roadWidth: number, radius: number): number {
  return Math.max(0, Math.round(roadWidth / 2 - radius - 6));
}

/** How far a mission location sits from the road centerline, towards the curb. */
export function computeLocationOffset(roadWidth: number): number {
  return Math.max(0, Math.round(roadWidth / 2 - 14));
}

/**
 * Width of the guaranteed clear lane on the far side of a curb-hugging obstacle.
 * This is the number that proves a road is never fully blocked.
 */
export function computeClearCorridor(
  roadWidth: number,
  radius: number,
  curbOffset: number
): number {
  return roadWidth / 2 + curbOffset - radius;
}

/**
 * An internal road segment: one block-to-block link of a road.
 * Segments are the unit of placement for locations and obstacles. They are an
 * implementation detail and deliberately not part of the public `CityMap`.
 */
interface CitySegment {
  id: string;
  orientation: RoadOrientation;
  /** Coordinate on the perpendicular axis (x for a vertical segment). */
  fixed: number;
  /** Start/end along the segment's own axis. */
  start: number;
  end: number;
  /** Midpoint along the segment's own axis. */
  mid: number;
  col: number;
  row: number;
}

function buildSegments(config: CityConfig): CitySegment[] {
  const segments: CitySegment[] = [];

  // Vertical segments: one per avenue per block row.
  for (let col = 0; col <= config.cols; col += 1) {
    const fixed = getAvenueX(config, col);
    for (let row = 0; row < config.rows; row += 1) {
      const start = getStreetY(config, row);
      const end = getStreetY(config, row + 1);
      segments.push({
        id: `seg-v-${col}-${row}`,
        orientation: 'vertical',
        fixed,
        start,
        end,
        mid: (start + end) / 2,
        col,
        row,
      });
    }
  }

  // Horizontal segments: one per street per block column.
  for (let row = 0; row <= config.rows; row += 1) {
    const fixed = getStreetY(config, row);
    for (let col = 0; col < config.cols; col += 1) {
      const start = getAvenueX(config, col);
      const end = getAvenueX(config, col + 1);
      segments.push({
        id: `seg-h-${col}-${row}`,
        orientation: 'horizontal',
        fixed,
        start,
        end,
        mid: (start + end) / 2,
        col,
        row,
      });
    }
  }

  return segments;
}

/** True when the point lies on drivable asphalt, `tolerance` px inside the road edge. */
export function isOnRoad(map: CityMap, x: number, y: number, tolerance = 0): boolean {
  for (const road of map.roads) {
    const halfWidth = road.width / 2 - tolerance;
    if (halfWidth < 0) continue;

    if (road.orientation === 'vertical') {
      const insideX = Math.abs(x - road.center) <= halfWidth;
      const insideY = y >= road.start - tolerance && y <= road.end + tolerance;
      if (insideX && insideY) return true;
    } else {
      const insideY = Math.abs(y - road.center) <= halfWidth;
      const insideX = x >= road.start - tolerance && x <= road.end + tolerance;
      if (insideX && insideY) return true;
    }
  }
  return false;
}

function buildRoads(config: CityConfig, width: number, height: number): CityRoad[] {
  const roads: CityRoad[] = [];

  for (let col = 0; col <= config.cols; col += 1) {
    roads.push({
      id: `avenue-${col}`,
      orientation: 'vertical',
      center: getAvenueX(config, col),
      start: 0,
      end: height,
      width: config.roadWidth,
    });
  }

  for (let row = 0; row <= config.rows; row += 1) {
    roads.push({
      id: `street-${row}`,
      orientation: 'horizontal',
      center: getStreetY(config, row),
      start: 0,
      end: width,
      width: config.roadWidth,
    });
  }

  return roads;
}

function buildIntersections(config: CityConfig): CityIntersection[] {
  const intersections: CityIntersection[] = [];

  for (let col = 0; col <= config.cols; col += 1) {
    for (let row = 0; row <= config.rows; row += 1) {
      intersections.push({
        id: `node-${col}-${row}`,
        col,
        row,
        x: getAvenueX(config, col),
        y: getStreetY(config, row),
      });
    }
  }

  return intersections;
}

/** Spreadsheet-style unique code: A1..Z1, A2.. Used to keep location names distinct. */
function toLocationCode(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  const number = Math.floor(index / 26) + 1;
  return `${letter}${number}`;
}

interface LocationPlacement {
  locations: CityLocation[];
  /** Segments that now host a location; obstacles are kept away from these. */
  occupiedSegmentIds: Set<string>;
}

/**
 * Picks which road segments become mission locations.
 * Each one is nudged towards the curb so it reads as a doorway rather than a
 * package abandoned in the middle of the street.
 */
function buildLocations(
  config: CityConfig,
  rng: SeededRandom,
  segments: readonly CitySegment[]
): LocationPlacement {
  const locations: CityLocation[] = [];
  const occupiedSegmentIds = new Set<string>();
  const offset = computeLocationOffset(config.roadWidth);

  for (const segment of segments) {
    if (!rng.nextBool(config.locationDensity)) continue;

    const side = rng.nextBool() ? 1 : -1;
    const x = segment.orientation === 'vertical' ? segment.fixed + side * offset : segment.mid;
    const y = segment.orientation === 'vertical' ? segment.mid : segment.fixed + side * offset;

    const code = toLocationCode(locations.length);
    const template = rng.pick(LOCATION_TEMPLATES);
    const zoneName = CITY_ZONE_NAMES[segment.col % CITY_ZONE_NAMES.length] ?? 'Unmapped District';

    locations.push({
      id: `loc-${code}`,
      name: `${template} ${code}`,
      zone: `${zoneName} ${code}`,
      x,
      y,
      segmentId: segment.id,
      orientation: segment.orientation,
    });
    occupiedSegmentIds.add(segment.id);
  }

  return { locations, occupiedSegmentIds };
}
/**
 * Buildings fill the inside of every block.
 * `maxWidth` subtracts the road surface plus a margin on both sides, so a
 * building can never overlap asphalt no matter how the RNG rolls.
 */
function buildBuildings(config: CityConfig, rng: SeededRandom): CityBuilding[] {
  const buildings: CityBuilding[] = [];
  const maxWidth = config.cellSize - config.roadWidth - config.buildingMargin * 2;
  if (maxWidth <= 20) return buildings;

  for (let col = 0; col < config.cols; col += 1) {
    for (let row = 0; row < config.rows; row += 1) {
      const centerX = (getAvenueX(config, col) + getAvenueX(config, col + 1)) / 2;
      const centerY = (getStreetY(config, row) + getStreetY(config, row + 1)) / 2;

      const width = Math.round(maxWidth * rng.nextFloat(config.buildingMinScale, 1));
      const height = Math.round(maxWidth * rng.nextFloat(config.buildingMinScale, 1));

      // Jitter only within the leftover space, keeping the margin intact.
      const slackX = (maxWidth - width) / 2;
      const slackY = (maxWidth - height) / 2;

      buildings.push({
        id: `bld-${col}-${row}`,
        col,
        row,
        x: Math.round(centerX + rng.nextFloat(-slackX, slackX)),
        y: Math.round(centerY + rng.nextFloat(-slackY, slackY)),
        width,
        height,
        heightTier: rng.nextInt(1, 3),
        variant: rng.nextInt(0, 3),
      });
    }
  }

  return buildings;
}

const OBSTACLE_KINDS: ObstacleKind[] = ['barrier', 'wreck', 'drone'];

/**
 * Obstacles are parked against the curb on segments that are neither a mission
 * location nor too close to one. The `t` range keeps them away from intersections
 * so crossings always stay open.
 */
function buildObstacles(
  config: CityConfig,
  rng: SeededRandom,
  segments: readonly CitySegment[],
  locations: readonly CityLocation[],
  occupiedSegmentIds: ReadonlySet<string>
): CityObstacle[] {
  const obstacles: CityObstacle[] = [];
  const radius = computeObstacleRadius(config.roadWidth);
  const curbOffset = computeObstacleCurbOffset(config.roadWidth, radius);

  for (const segment of segments) {
    if (occupiedSegmentIds.has(segment.id)) continue;
    if (!rng.nextBool(config.obstacleDensity)) continue;

    const t = rng.nextFloat(0.3, 0.7);
    const along = segment.start + (segment.end - segment.start) * t;
    const side = rng.nextBool() ? 1 : -1;

    const x = segment.orientation === 'vertical' ? segment.fixed + side * curbOffset : along;
    const y = segment.orientation === 'vertical' ? along : segment.fixed + side * curbOffset;

    const blocksLocation = locations.some(
      (location) => Math.hypot(location.x - x, location.y - y) < LOCATION_CLEARANCE_RADIUS
    );
    if (blocksLocation) continue;

    obstacles.push({
      id: `obs-${obstacles.length}`,
      segmentId: segment.id,
      x: Math.round(x),
      y: Math.round(y),
      radius,
      kind: rng.pick(OBSTACLE_KINDS),
    });
  }

  return obstacles;
}

/** Prefers an interior crossing so the courier never starts pinned to a map corner. */
function pickSpawn(
  config: CityConfig,
  rng: SeededRandom,
  intersections: readonly CityIntersection[]
): CityIntersection {
  const interior = intersections.filter(
    (node) => node.col > 0 && node.col < config.cols && node.row > 0 && node.row < config.rows
  );
  const pool = interior.length > 0 ? interior : [...intersections];
  return rng.pick(pool);
}

/**
 * Generates a complete city from a config.
 *
 * Deterministic: only `SeededRandom` supplies randomness and every draw happens in
 * a fixed order, so `generateCity({ seed: 42 })` always returns the same map.
 * Pass no seed to roll a fresh city for a new run.
 */
export function generateCity(partial: Partial<CityConfig> = {}): CityMap {
  const config = resolveCityConfig({ ...partial, seed: partial.seed ?? createRunSeed() });
  const rng = new SeededRandom(config.seed);
  const { width, height } = getWorldSize(config);

  const roads = buildRoads(config, width, height);
  const intersections = buildIntersections(config);

  // Fixed draw order: locations, then buildings, then obstacles, then spawn.
  // Changing this order changes every map, so keep incremental draws at the end.
  const segments = buildSegments(config);
  const { locations, occupiedSegmentIds } = buildLocations(config, rng, segments);
  const buildings = buildBuildings(config, rng);
  const obstacles = buildObstacles(config, rng, segments, locations, occupiedSegmentIds);
  const spawn = pickSpawn(config, rng, intersections);

  return {
    config,
    seed: rng.seed,
    seedLabel: rng.seedLabel,
    width,
    height,
    roads,
    intersections,
    buildings,
    obstacles,
    locations,
    spawn,
  };
}

/** Largest straight-line gap between any two locations. */
export function getMaxLocationDistance(locations: readonly CityLocation[]): number {
  let maxDistance = 0;
  for (let i = 0; i < locations.length; i += 1) {
    const a = locations[i];
    if (!a) continue;
    for (let j = i + 1; j < locations.length; j += 1) {
      const b = locations[j];
      if (!b) continue;
      maxDistance = Math.max(maxDistance, Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  return maxDistance;
}

/**
 * Self-check run right after generation. Rather than trusting the algorithm, this
 * asserts the invariants that make a mission *possible*:
 *
 *  1. The grid is a real grid (at least 2x2 blocks) and geometry matches the formula.
 *  2. Every mission location and the spawn point sit on drivable asphalt. Because all
 *     roads span the whole map, on-road implies reachable from anywhere else.
 *  3. No building overlaps a road centerline, so no street is walled off.
 *  4. Obstacles are on-road, keep a clear corridor, and never cover a location.
 *  5. `minMissionDistance` is actually achievable with the locations we produced.
 *
 * The result is returned instead of thrown so the game can log and regenerate.
 */
export function validateCity(map: CityMap): CityValidationResult {
  const issues: string[] = [];
  const { config } = map;
  const halfRoad = config.roadWidth / 2;

  if (config.cols < 2 || config.rows < 2) {
    issues.push('City grid must be at least 2x2 blocks so corridors can exist.');
  }

  const expected = getWorldSize(config);
  if (map.width !== expected.width || map.height !== expected.height) {
    issues.push(`World size ${map.width}x${map.height} does not match the grid formula.`);
  }

  if (map.locations.length < 2) {
    issues.push('At least two mission locations are required to build a delivery.');
  }

  if (!isOnRoad(map, map.spawn.x, map.spawn.y)) {
    issues.push(`Spawn point ${map.spawn.id} is not on a road.`);
  }

  for (const location of map.locations) {
    if (!isOnRoad(map, location.x, location.y, LOCATION_ROAD_TOLERANCE)) {
      issues.push(`Location ${location.id} is not on drivable road.`);
    }
  }

  for (const building of map.buildings) {
    const left = building.x - building.width / 2;
    const right = building.x + building.width / 2;
    const top = building.y - building.height / 2;
    const bottom = building.y + building.height / 2;

    if (left < 0 || right > map.width || top < 0 || bottom > map.height) {
      issues.push(`Building ${building.id} extends outside the map.`);
    }

    for (const road of map.roads) {
      const overlapsRoad =
        road.orientation === 'vertical'
          ? left - halfRoad < road.center && road.center < right + halfRoad
          : top - halfRoad < road.center && road.center < bottom + halfRoad;
      if (overlapsRoad) {
        issues.push(`Building ${building.id} overlaps road ${road.id} and would block it.`);
      }
    }
  }

  const radius = computeObstacleRadius(config.roadWidth);
  const curbOffset = computeObstacleCurbOffset(config.roadWidth, radius);
  const corridor = computeClearCorridor(config.roadWidth, radius, curbOffset);
  if (corridor < PLAYER_CLEARANCE) {
    issues.push(
      `Road width ${config.roadWidth}px leaves only a ${Math.round(corridor)}px corridor beside obstacles.`
    );
  }

  for (const obstacle of map.obstacles) {
    if (!isOnRoad(map, obstacle.x, obstacle.y, obstacle.radius)) {
      issues.push(`Obstacle ${obstacle.id} is not on a road.`);
    }
    for (const location of map.locations) {
      const gap = Math.hypot(location.x - obstacle.x, location.y - obstacle.y);
      if (gap < LOCATION_CLEARANCE_RADIUS) {
        issues.push(`Obstacle ${obstacle.id} blocks location ${location.id}.`);
      }
    }
  }

  if (map.locations.length >= 2) {
    const achievable = getMaxLocationDistance(map.locations);
    if (achievable < config.minMissionDistance) {
      issues.push(
        `minMissionDistance (${config.minMissionDistance}px) exceeds the largest location gap (${Math.round(achievable)}px).`
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Chooses a pickup and a drop-off that are far enough apart.
 *
 * Random selection with retries keeps trips varied, while the deterministic
 * farthest-pair fallback guarantees a valid mission is *always* produced even when
 * `minMissionDistance` is aggressive — no infinite loops, no dead ends.
 */
export function pickMissionLocations(
  locations: readonly CityLocation[],
  rng: SeededRandom,
  minDistance: number
): readonly [CityLocation, CityLocation] {
  if (locations.length < 2) {
    throw new RangeError('pickMissionLocations requires at least two locations.');
  }

  const attempts = 64;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const pickup = rng.pick(locations);
    const dropoff = rng.pick(locations);
    if (pickup.id === dropoff.id) continue;
    if (Math.hypot(dropoff.x - pickup.x, dropoff.y - pickup.y) >= minDistance) {
      return [pickup, dropoff];
    }
  }

  let best: readonly [CityLocation, CityLocation] | null = null;
  let bestDistance = -1;
  for (let i = 0; i < locations.length; i += 1) {
    const a = locations[i];
    if (!a) continue;
    for (let j = i + 1; j < locations.length; j += 1) {
      const b = locations[j];
      if (!b) continue;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = [a, b];
      }
    }
  }

  if (!best) {
    throw new RangeError('pickMissionLocations could not find a distinct pair.');
  }
  return best;
}
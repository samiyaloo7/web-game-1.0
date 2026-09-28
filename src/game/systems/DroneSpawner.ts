import type { CityConfig, CityMap, Point } from '../types/city';
import type { DroneSpawnPlan, EnemyConfig } from '../types/enemy';
import { DEFAULT_ENEMY_CONFIG } from '../types/enemy';
import { getAvenueX, getStreetY } from './CityGenerator';
import { SeededRandom } from './SeededRandom';

/**
 * Deterministic drone placement. Pure data in, pure data out — no Phaser import.
 *
 * Patrol routes are built from the city lattice rather than from pathfinding: a drone
 * guards *one city block* and walks its four corners, which are road intersections. Every
 * leg is therefore a straight line down an avenue or a street, so a patrol can never clip
 * a building and can never get stuck. When real pathfinding arrives in a later step, this
 * module keeps producing the same routes and only the movement model changes.
 */

/** Roughly one drone per seven city blocks, clamped to a sensible squad size. */
export function deriveDroneCount(cols: number, rows: number): number {
  const blocks = Math.max(1, cols) * Math.max(1, rows);
  return clampInt(Math.round(blocks / 7), 1, 8);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Merges a partial config over the defaults and clamps it into a playable range. */
export function resolveEnemyConfig(map: CityMap, partial: Partial<EnemyConfig> = {}): EnemyConfig {
  const merged = { ...DEFAULT_ENEMY_CONFIG, ...partial };
  const auto = deriveDroneCount(map.config.cols, map.config.rows);

  return {
    // `0` means "size the squad to the district".
    droneCount: clampInt(merged.droneCount === 0 ? auto : merged.droneCount, 1, 12),
    minSpawnDistanceFromPlayer: clampInt(merged.minSpawnDistanceFromPlayer, 0, 10000),
    minDroneSeparation: clampInt(merged.minDroneSeparation, 0, 10000),
    droneSpeedJitter: clampFloat(merged.droneSpeedJitter, 0, 0.6),
  };
}

/**
 * The four intersections around block `(col, row)`, walked clockwise.
 * Consecutive corners always share an avenue or a street, so the loop is drivable.
 */
export function getBlockPatrolRoute(config: CityConfig, col: number, row: number): Point[] {
  const left = getAvenueX(config, col);
  const right = getAvenueX(config, col + 1);
  const top = getStreetY(config, row);
  const bottom = getStreetY(config, row + 1);

  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

interface BlockCandidate {
  col: number;
  row: number;
  corners: Point[];
}

/**
 * Plans every drone for a district.
 *
 * Placement rules, applied in order over a *seeded shuffle* of the blocks:
 *
 *   1. never spawn within `minSpawnDistanceFromPlayer` of the courier's start, so a run
 *      does not open with an instant chase;
 *   2. keep drones at least `minDroneSeparation` apart, so threats stay spread out;
 *   3. cap the squad at `droneCount`.
 *
 * `droneCount` is an upper bound, not a promise: on a tiny or cramped map, honouring the
 * safety rules matters more than filling the quota. At least one drone is always planned.
 *
 * The same seed always yields the same squad, so a shared seed reproduces the whole run.
 */
export function planDroneSpawns(
  map: CityMap,
  rng: SeededRandom,
  partial: Partial<EnemyConfig> = {}
): DroneSpawnPlan[] {
  const config = resolveEnemyConfig(map, partial);

  const blocks: BlockCandidate[] = [];
  for (let col = 0; col < map.config.cols; col += 1) {
    for (let row = 0; row < map.config.rows; row += 1) {
      blocks.push({ col, row, corners: getBlockPatrolRoute(map.config, col, row) });
    }
  }

  const plans: DroneSpawnPlan[] = [];
  const candidates = rng.shuffle(blocks);

  for (const block of candidates) {
    if (plans.length >= config.droneCount) break;

    const spawn = block.corners[0];
    if (spawn === undefined) continue;

    if (distanceBetween(spawn, map.spawn) < config.minSpawnDistanceFromPlayer) continue;
    if (plans.some((plan) => distanceBetween(plan.spawn, spawn) < config.minDroneSeparation)) continue;

    plans.push(buildPlan(plans.length, spawn, block.corners, config, rng));
  }

  // Safety net: an extremely cramped district still gets one patrol to dodge.
  if (plans.length === 0) {
    const farthest = pickBlockFarthestFromSpawn(candidates, map.spawn);
    if (farthest) {
      const spawn = farthest.corners[0];
      if (spawn) plans.push(buildPlan(0, spawn, farthest.corners, config, rng));
    }
  }

  return plans;
}

function buildPlan(
  index: number,
  spawn: Point,
  corners: Point[],
  config: EnemyConfig,
  rng: SeededRandom
): DroneSpawnPlan {
  const jitter = rng.nextFloat(-config.droneSpeedJitter, config.droneSpeedJitter);

  return {
    id: `drone-${index}`,
    spawn: { x: spawn.x, y: spawn.y },
    route: corners.map((corner) => ({ x: corner.x, y: corner.y })),
    // Clamped away from zero so a speed scale can never produce a frozen drone.
    speedScale: Math.max(0.5, 1 + jitter),
  };
}

function pickBlockFarthestFromSpawn(
  blocks: readonly BlockCandidate[],
  spawn: Point
): BlockCandidate | null {
  let best: BlockCandidate | null = null;
  let bestDistance = -1;

  for (const block of blocks) {
    const corner = block.corners[0];
    if (corner === undefined) continue;
    const distance = distanceBetween(corner, spawn);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = block;
    }
  }

  return best;
}
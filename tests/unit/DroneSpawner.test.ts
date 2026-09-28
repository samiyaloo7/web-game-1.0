import { describe, expect, it } from 'vitest';
import { generateCity, getAvenueX, getStreetY } from '@/game/systems/CityGenerator';
import {
  deriveDroneCount,
  getBlockPatrolRoute,
  planDroneSpawns,
  resolveEnemyConfig,
} from '@/game/systems/DroneSpawner';
import { SeededRandom } from '@/game/systems/SeededRandom';
import { DEFAULT_ENEMY_CONFIG } from '@/game/types/enemy';
import type { CityMap } from '@/game/types/city';

/** Seeds spanning the range of district sizes the spawner has to cope with. */
const SAMPLE_SEEDS = [1, 7, 42, 12345, 'neon-courier', 'sector-04'];

/** Districts are big enough for the placement rules, so the default config applies. */
function planFor(seed: number | string): { map: CityMap; plans: ReturnType<typeof planDroneSpawns> } {
  const map = generateCity({ seed });
  const plans = planDroneSpawns(map, new SeededRandom(map.seed).fork('drones'));
  return { map, plans };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

describe('deriveDroneCount', () => {
  it('scales with the district but always stays inside [1, 8]', () => {
    expect(deriveDroneCount(1, 1)).toBe(1);
    expect(deriveDroneCount(7, 7)).toBe(7);
    expect(deriveDroneCount(50, 50)).toBe(8);
    expect(deriveDroneCount(0, -10)).toBe(1);
  });
});

describe('resolveEnemyConfig', () => {
  it('derives a squad size when droneCount is 0', () => {
    const { map } = planFor(42);
    const config = resolveEnemyConfig(map, { droneCount: 0 });

    expect(config.droneCount).toBeGreaterThanOrEqual(1);
    expect(config.droneCount).toBeLessThanOrEqual(8);
    expect(config.droneCount).toBe(deriveDroneCount(map.config.cols, map.config.rows));
  });

  it('clamps hostile values instead of trusting the caller', () => {
    const { map } = planFor(42);

    expect(resolveEnemyConfig(map, { droneCount: -5 }).droneCount).toBe(1);
    expect(resolveEnemyConfig(map, { droneCount: 999 }).droneCount).toBe(12);
    expect(resolveEnemyConfig(map, { droneSpeedJitter: 9 }).droneSpeedJitter).toBe(0.6);
    expect(resolveEnemyConfig(map, { droneSpeedJitter: -9 }).droneSpeedJitter).toBe(0);
    expect(resolveEnemyConfig(map, { minSpawnDistanceFromPlayer: -100 }).minSpawnDistanceFromPlayer).toBe(0);
  });

  it('keeps the documented defaults when nothing is overridden', () => {
    const { map } = planFor(42);
    const config = resolveEnemyConfig(map);

    expect(config.minSpawnDistanceFromPlayer).toBe(DEFAULT_ENEMY_CONFIG.minSpawnDistanceFromPlayer);
    expect(config.minDroneSeparation).toBe(DEFAULT_ENEMY_CONFIG.minDroneSeparation);
    expect(config.droneSpeedJitter).toBe(DEFAULT_ENEMY_CONFIG.droneSpeedJitter);
  });
});

describe('getBlockPatrolRoute', () => {
  it('returns the four intersections of the block, walked clockwise', () => {
    const { map } = planFor(42);
    const route = getBlockPatrolRoute(map.config, 0, 0);

    expect(route).toHaveLength(4);
    expect(route[0]).toEqual({ x: getAvenueX(map.config, 0), y: getStreetY(map.config, 0) });
    expect(route[1]).toEqual({ x: getAvenueX(map.config, 1), y: getStreetY(map.config, 0) });
    expect(route[2]).toEqual({ x: getAvenueX(map.config, 1), y: getStreetY(map.config, 1) });
    expect(route[3]).toEqual({ x: getAvenueX(map.config, 0), y: getStreetY(map.config, 1) });
  });

  it('only produces axis-aligned legs, so a patrol can never clip a building', () => {
    const { map } = planFor(42);

    for (let col = 0; col < 3; col += 1) {
      for (let row = 0; row < 3; row += 1) {
        const route = getBlockPatrolRoute(map.config, col, row);
        for (let i = 0; i < route.length; i += 1) {
          const a = route[i];
          const b = route[(i + 1) % route.length];
          if (!a || !b) continue;
          expect(a.x === b.x || a.y === b.y).toBe(true);
        }

describe('planDroneSpawns - determinism', () => {
  it('reproduces an identical squad for the same district and stream seed', () => {
    const a = planFor(12345);
    const b = planFor(12345);

    expect(JSON.stringify(a.plans)).toBe(JSON.stringify(b.plans));
  });

  it('reproduces an identical squad for the same string seed', () => {
    const a = planFor('neon-courier');
    const b = planFor('neon-courier');

    expect(JSON.stringify(a.plans)).toBe(JSON.stringify(b.plans));
  });

  it('rolls a different squad for different districts', () => {
    const a = planFor(1);
    const b = planFor(2);

    expect(JSON.stringify(a.plans)).not.toBe(JSON.stringify(b.plans));
  });
});

describe('planDroneSpawns - placement rules', () => {
  it('never spawns a drone on top of the courier', () => {
    for (const seed of SAMPLE_SEEDS) {
      const { map, plans } = planFor(seed);
      expect(plans.length).toBeGreaterThan(0);

      for (const plan of plans) {
        expect(distance(plan.spawn, map.spawn)).toBeGreaterThanOrEqual(
          DEFAULT_ENEMY_CONFIG.minSpawnDistanceFromPlayer
        );
      }
    }
  });

  it('keeps the squad spread out', () => {
    for (const seed of SAMPLE_SEEDS) {
      const { plans } = planFor(seed);

      for (let i = 0; i < plans.length; i += 1) {
        for (let j = i + 1; j < plans.length; j += 1) {
          const first = plans[i];
          const second = plans[j];
          if (!first || !second) continue;

          expect(distance(first.spawn, second.spawn)).toBeGreaterThanOrEqual(
            DEFAULT_ENEMY_CONFIG.minDroneSeparation
          );
        }
      }
    }
  });

  it('honours the district squad budget', () => {
    for (const seed of SAMPLE_SEEDS) {
      const { map, plans } = planFor(seed);
      const budget = resolveEnemyConfig(map).droneCount;

      expect(plans.length).toBeGreaterThanOrEqual(1);
      expect(plans.length).toBeLessThanOrEqual(budget);
    }
  });

  it('gives every drone a unique id and a full four-corner loop', () => {
    for (const seed of SAMPLE_SEEDS) {
      const { plans } = planFor(seed);
      const ids = plans.map((plan) => plan.id);

      expect(new Set(ids).size).toBe(ids.length);

      for (const plan of plans) {
        expect(plan.route).toHaveLength(4);
        expect(plan.route[0]).toEqual(plan.spawn);
      }
    }
  });

  it('starts each drone on the city lattice — a road intersection, never inside a block', () => {
    for (const seed of SAMPLE_SEEDS) {
      const { map, plans } = planFor(seed);
      const { roadWidth, cellSize } = map.config;

      for (const plan of plans) {
        const col = Math.round((plan.spawn.x - roadWidth / 2) / cellSize);
        const row = Math.round((plan.spawn.y - roadWidth / 2) / cellSize);

        expect(getAvenueX(map.config, col)).toBe(plan.spawn.x);
        expect(getStreetY(map.config, row)).toBe(plan.spawn.y);

        for (const corner of plan.route) {
          const cornerCol = Math.round((corner.x - roadWidth / 2) / cellSize);
          const cornerRow = Math.round((corner.y - roadWidth / 2) / cellSize);
          expect(getAvenueX(map.config, cornerCol)).toBe(corner.x);
          expect(getStreetY(map.config, cornerRow)).toBe(corner.y);
        }
      }
    }
  });

  it('applies speed jitter inside [0.5, 1 + jitter] so nobody is frozen or superhuman', () => {
    const maxScale = 1 + DEFAULT_ENEMY_CONFIG.droneSpeedJitter;

    for (const seed of SAMPLE_SEEDS) {
      for (const plan of planFor(seed).plans) {
        expect(plan.speedScale).toBeGreaterThanOrEqual(0.5);
        expect(plan.speedScale).toBeLessThanOrEqual(maxScale);
      }
    }
  });
});

describe('planDroneSpawns - degraded districts', () => {
  it('still fields a patrol on a district too cramped for the safety rules', () => {
    const map = generateCity({ seed: 7, cols: 2, rows: 2 });
    const plans = planDroneSpawns(map, new SeededRandom(map.seed).fork('drones'), {
      minSpawnDistanceFromPlayer: 10_000,
      minDroneSeparation: 10_000,
      droneCount: 4,
    });

    // The quota may be sacrificed, but an empty squad is never allowed.
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(plans[0]?.route).toHaveLength(4);
  });
});

      }
    }
  });
});

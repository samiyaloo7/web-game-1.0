import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CITY_CONFIG,
  LOCATION_CLEARANCE_RADIUS,
  MIN_CELL_SIZE,
  MIN_ROAD_WIDTH,
  PLAYER_CLEARANCE,
  computeClearCorridor,
  computeObstacleCurbOffset,
  computeObstacleRadius,
  generateCity,
  getAvenueX,
  getMaxLocationDistance,
  getStreetY,
  getWorldSize,
  isOnRoad,
  pickMissionLocations,
  resolveCityConfig,
  validateCity,
} from '@/game/systems/CityGenerator';
import { SeededRandom } from '@/game/systems/SeededRandom';

/** Seeds used across the suite: a spread of values, all of which must be buildable. */
const SAMPLE_SEEDS = [1, 7, 42, 12345, 999999, 'neon-courier', 'sector-04'];

describe('generateCity - determinism', () => {
  it('reproduces an identical city for the same numeric seed', () => {
    const a = generateCity({ seed: 12345 });
    const b = generateCity({ seed: 12345 });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reproduces an identical city for the same string seed', () => {
    const a = generateCity({ seed: 'neon-courier' });
    const b = generateCity({ seed: 'neon-courier' });

    expect(a.seed).toBe(b.seed);
    expect(JSON.stringify(a.buildings)).toBe(JSON.stringify(b.buildings));
    expect(JSON.stringify(a.obstacles)).toBe(JSON.stringify(b.obstacles));
  });

  it('generates different cities for different seeds', () => {
    const a = generateCity({ seed: 1 });
    const b = generateCity({ seed: 2 });

    expect(JSON.stringify(a.buildings)).not.toBe(JSON.stringify(b.buildings));
  });

  it('rolls a fresh city when no seed is supplied', () => {
    const map = generateCity();
    expect(map.seed).toBeGreaterThanOrEqual(0);
    expect(map.seedLabel).toBe(String(map.seed));
  });
});

describe('generateCity - configurable map size', () => {
  it('derives world size from the grid formula', () => {
    const map = generateCity({ seed: 3, cols: 4, rows: 3, cellSize: 200, roadWidth: 64 });
    const expected = getWorldSize(map.config);

    expect(map.width).toBe(expected.width);
    expect(map.height).toBe(expected.height);
    // worldWidth = roadWidth + cols * cellSize
    expect(map.width).toBe(64 + 4 * 200);
    expect(map.height).toBe(64 + 3 * 200);
  });

  it('scales the number of roads, crossings and blocks with the grid', () => {
    const small = generateCity({ seed: 3, cols: 2, rows: 2 });
    const large = generateCity({ seed: 3, cols: 6, rows: 4 });

    expect(small.intersections).toHaveLength(3 * 3);
    expect(large.intersections).toHaveLength(7 * 5);

    expect(small.roads).toHaveLength(3 + 3);
    expect(large.roads).toHaveLength(7 + 5);

    expect(small.buildings).toHaveLength(2 * 2);
    expect(large.buildings).toHaveLength(6 * 4);

    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
  });

  it('clamps unsafe configuration values instead of producing a broken city', () => {
    const config = resolveCityConfig({
      cols: 0,
      rows: 999,
      cellSize: 10,
      roadWidth: 5000,
      locationDensity: 5,
      obstacleDensity: -3,
      buildingMinScale: 9,
    });

    expect(config.cols).toBe(2);
    expect(config.rows).toBe(24);
    expect(config.cellSize).toBe(140);
    // Road width is clamped into [MIN_ROAD_WIDTH, cellSize / 2].
    expect(config.roadWidth).toBe(Math.floor(config.cellSize / 2));
    expect(config.roadWidth).toBeGreaterThanOrEqual(MIN_ROAD_WIDTH);
    expect(config.locationDensity).toBe(1);
    expect(config.obstacleDensity).toBe(0);
    expect(config.buildingMinScale).toBe(1);
  });
});

describe('generateCity - content', () => {
  it('produces roads, intersections, buildings, obstacles and locations', () => {
    const map = generateCity({ seed: 42 });

    expect(map.roads.length).toBeGreaterThan(0);
    expect(map.intersections.length).toBeGreaterThan(0);
    expect(map.buildings.length).toBeGreaterThan(0);
    expect(map.obstacles.length).toBeGreaterThan(0);
    expect(map.locations.length).toBeGreaterThan(0);
  });

  it('creates one avenue per column boundary and one street per row boundary', () => {
    const map = generateCity({ seed: 42 });
    const avenues = map.roads.filter((road) => road.orientation === 'vertical');
    const streets = map.roads.filter((road) => road.orientation === 'horizontal');

    expect(avenues).toHaveLength(map.config.cols + 1);
    expect(streets).toHaveLength(map.config.rows + 1);

    // Full-length spans are what makes the network connected.
    for (const road of avenues) expect(road.end - road.start).toBe(map.height);
    for (const road of streets) expect(road.end - road.start).toBe(map.width);
  });

  it('builds a fully connected road network (every avenue crosses every street)', () => {
    const map = generateCity({ seed: 42 });
    const nodes = new Set(map.intersections.map((node) => `${node.col}:${node.row}`));

    for (let col = 0; col <= map.config.cols; col += 1) {
      for (let row = 0; row <= map.config.rows; row += 1) {
        expect(nodes.has(`${col}:${row}`)).toBe(true);
      }
    }
  });

  it('gives every location a unique id, a name and a zone', () => {
    const map = generateCity({ seed: 2024 });
    const ids = new Set(map.locations.map((location) => location.id));

    expect(ids.size).toBe(map.locations.length);
    for (const location of map.locations) {
      expect(location.name.length).toBeGreaterThan(0);
      expect(location.zone.length).toBeGreaterThan(0);
    }
  });

  it('keeps the block count stable while varying the layout between seeds', () => {
    const layouts = SAMPLE_SEEDS.map((seed) => {
      const map = generateCity({ seed });
      return map.buildings.map((building) => `${building.x},${building.y},${building.width}`);
    });

    for (const layout of layouts) {
      expect(layout).toHaveLength(DEFAULT_CITY_CONFIG.cols * DEFAULT_CITY_CONFIG.rows);
    }
    expect(new Set(layouts.map((layout) => layout.join('|'))).size).toBeGreaterThan(1);
  });
});

describe('validateCity - guarantees a playable city', () => {
  it('passes its own self-check for every sampled seed', () => {
    for (const seed of SAMPLE_SEEDS) {
      const result = validateCity(generateCity({ seed }));
      expect(result.issues).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('passes for the full range of grid sizes and qualities', () => {
    const variants = [
      { cols: 2, rows: 2 },
      { cols: 3, rows: 8 },
      { cols: 12, rows: 3 },
      { cellSize: 120, roadWidth: 60 },
      { cellSize: 600, roadWidth: 40 },
      { cellSize: MIN_CELL_SIZE, roadWidth: MIN_ROAD_WIDTH },
      { locationDensity: 0.1, obstacleDensity: 1 },
      { locationDensity: 1, obstacleDensity: 1 },
      { obstacleDensity: 0 },
      { locationDensity: 1, obstacleDensity: 0 },
    ];

    for (const variant of variants) {
      for (const seed of [1, 42, 7777]) {
        const map = generateCity({ seed, ...variant });
        const result = validateCity(map);
        expect(result.issues).toEqual([]);
      }
    }
  });

  it('places every mission location on drivable road', () => {
    for (const seed of SAMPLE_SEEDS) {
      const map = generateCity({ seed });
      expect(map.locations.length).toBeGreaterThanOrEqual(2);

      for (const location of map.locations) {
        expect(isOnRoad(map, location.x, location.y)).toBe(true);
      }
    }
  });

  it('places the player spawn on drivable road', () => {
    for (const seed of SAMPLE_SEEDS) {
      const map = generateCity({ seed });
      expect(isOnRoad(map, map.spawn.x, map.spawn.y)).toBe(true);
    }
  });

  it('reports a location that sits off-road', () => {
    const map = structuredClone(generateCity({ seed: 42 }));
    const first = map.locations[0];
    if (!first) throw new Error('expected at least one location');

    // Park it in the middle of a building block, away from every road.
    first.x = map.buildings[0]?.x ?? 0;
    first.y = map.buildings[0]?.y ?? 0;

    const result = validateCity(map);
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain(first.id);
  });
});

describe('collision boundaries - obstacles never seal a road', () => {
  it('keeps a clear driving corridor beside every obstacle', () => {
    for (const seed of SAMPLE_SEEDS) {
      const map = generateCity({ seed });
      const radius = computeObstacleRadius(map.config.roadWidth);
      const curbOffset = computeObstacleCurbOffset(map.config.roadWidth, radius);
      const corridor = computeClearCorridor(map.config.roadWidth, radius, curbOffset);

      expect(corridor).toBeGreaterThanOrEqual(PLAYER_CLEARANCE);
      expect(map.config.roadWidth / 2 + curbOffset - radius).toBe(corridor);
    }
  });

  it('keeps every obstacle on the road surface', () => {
    for (const seed of SAMPLE_SEEDS) {
      const map = generateCity({ seed });

      for (const obstacle of map.obstacles) {
        expect(isOnRoad(map, obstacle.x, obstacle.y, obstacle.radius)).toBe(true);
      }
    }
  });

  it('never parks an obstacle on top of a mission location', () => {
    for (const seed of SAMPLE_SEEDS) {
      const map = generateCity({ seed });

      for (const obstacle of map.obstacles) {
        for (const location of map.locations) {
          const gap = Math.hypot(location.x - obstacle.x, location.y - obstacle.y);
          expect(gap).toBeGreaterThanOrEqual(LOCATION_CLEARANCE_RADIUS);
        }
      }
    }
  });

  it('keeps every building inside its own block, clear of the road surface', () => {
    for (const seed of SAMPLE_SEEDS) {
      const map = generateCity({ seed });
      const halfRoad = map.config.roadWidth / 2;

      for (const building of map.buildings) {
        const left = building.x - building.width / 2;
        const right = building.x + building.width / 2;
        const top = building.y - building.height / 2;
        const bottom = building.y + building.height / 2;

        // Block (col,row) is bounded by the two avenues and two streets around it.
        const blockLeft = getAvenueX(map.config, building.col);
        const blockRight = getAvenueX(map.config, building.col + 1);
        const blockTop = getStreetY(map.config, building.row);
        const blockBottom = getStreetY(map.config, building.row + 1);

        // Expanding the footprint by half a road must still not reach the centerline,
        // which is what proves the street itself is never obstructed.
        expect(left - halfRoad).toBeGreaterThanOrEqual(blockLeft);
        expect(right + halfRoad).toBeLessThanOrEqual(blockRight);
        expect(top - halfRoad).toBeGreaterThanOrEqual(blockTop);
        expect(bottom + halfRoad).toBeLessThanOrEqual(blockBottom);

        expect(left).toBeGreaterThanOrEqual(0);
        expect(right).toBeLessThanOrEqual(map.width);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(bottom).toBeLessThanOrEqual(map.height);
      }
    }
  });

  it('holds the corridor guarantee even at the narrowest allowed road width', () => {
    const map = generateCity({ seed: 9, cellSize: MIN_CELL_SIZE, roadWidth: MIN_ROAD_WIDTH });
    const radius = computeObstacleRadius(map.config.roadWidth);
    const curbOffset = computeObstacleCurbOffset(map.config.roadWidth, radius);

    expect(map.config.roadWidth).toBe(MIN_ROAD_WIDTH);
    expect(computeClearCorridor(map.config.roadWidth, radius, curbOffset)).toBeGreaterThanOrEqual(
      PLAYER_CLEARANCE
    );
    expect(validateCity(map).issues).toEqual([]);
  });
});

describe('pickMissionLocations - every delivery must be possible', () => {
  it('always returns two distinct locations that are far enough apart', () => {
    for (const seed of SAMPLE_SEEDS) {
      const map = generateCity({ seed });
      const rng = new SeededRandom(seed).fork('missions');

      for (let attempt = 0; attempt < 25; attempt += 1) {
        const [pickup, dropoff] = pickMissionLocations(
          map.locations,
          rng,
          map.config.minMissionDistance
        );

        expect(pickup.id).not.toBe(dropoff.id);
        expect(map.locations).toContain(pickup);
        expect(map.locations).toContain(dropoff);
        expect(Math.hypot(dropoff.x - pickup.x, dropoff.y - pickup.y)).toBeGreaterThanOrEqual(
          map.config.minMissionDistance
        );
      }
    }
  });

  it('is deterministic for a given seed and stream position', () => {
    const map = generateCity({ seed: 42 });

    const rollTwice = () => {
      const rng = new SeededRandom(42).fork('missions');
      return [0, 1, 2].map(() => pickMissionLocations(map.locations, rng, 300).map((l) => l.id));
    };

    expect(rollTwice()).toEqual(rollTwice());
  });

  it('still returns a usable pair when the requested distance is unreachable', () => {
    const map = generateCity({ seed: 42 });
    const rng = new SeededRandom(42).fork('missions');

    // 100km apart is impossible in a ~1.5km city: the farthest-pair fallback must kick in.
    const [pickup, dropoff] = pickMissionLocations(map.locations, rng, 100000);

    expect(pickup.id).not.toBe(dropoff.id);
    const distance = Math.hypot(dropoff.x - pickup.x, dropoff.y - pickup.y);
    expect(distance).toBeCloseTo(getMaxLocationDistance(map.locations), 5);
  });

  it('refuses to build a mission from a single location', () => {
    const map = generateCity({ seed: 42 });
    const rng = new SeededRandom(42);

    expect(() => pickMissionLocations(map.locations.slice(0, 1), rng, 0)).toThrow(RangeError);
  });

  it('flags a config whose minimum distance exceeds the map', () => {
    const map = structuredClone(generateCity({ seed: 42, cols: 2, rows: 2 }));
    map.config.minMissionDistance = 999999;

    const result = validateCity(map);
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toContain('minMissionDistance');
  });
});
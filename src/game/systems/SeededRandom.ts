/**
 * Deterministic pseudo-random number generator.
 *
 * Why not `Math.random()`? Procedural generation must be *reproducible*:
 * given the same seed it must produce byte-for-byte identical output. That makes
 * bugs reportable ("my seed 12345 has a wall across the road"), lets us snapshot
 * the layout in tests, and lets players share a city by sharing its seed.
 *
 * Why not Phaser's `Phaser.Math.RandomDataGenerator`? Because generation must be
 * testable without Phaser. This class has zero dependencies, so the whole city
 * generator runs in plain Node.
 *
 * Algorithm: `mulberry32`, a tiny 32-bit generator with good distribution and a
 * single integer of state. It is more than enough for level layout and is short
 * enough to read in one sitting.
 */

/** Fallback when a seed cannot be normalised into a 32-bit integer. */
const FALLBACK_SEED = 0x9e3779b9;

/** FNV-1a. Turns a readable string seed ("neon-courier") into a 32-bit integer. */
function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Accepts numbers or strings so a seed can come from a URL, a form, or code. */
function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) return FALLBACK_SEED;
    return Math.floor(Math.abs(seed)) >>> 0;
  }
  if (seed.length === 0) return FALLBACK_SEED;
  return hashStringToSeed(seed);
}

export class SeededRandom {
  /** Numeric seed in use. Safe to display and to pass to `new SeededRandom()`. */
  public readonly seed: number;
  /** The raw seed the caller supplied, for UI display. */
  public readonly seedLabel: string;
  /** Internal generator state. Exposed so a run can be paused and resumed. */
  private state: number;

  constructor(seed: number | string) {
    this.seedLabel = String(seed);
    this.seed = normalizeSeed(seed);
    this.state = this.seed;
  }

  /** Next float in the half-open range [0, 1). */
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next float in [min, max). */
  public nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Next integer in [min, max], both inclusive. */
  public nextInt(min: number, max: number): number {
    if (max < min) {
      throw new RangeError(`SeededRandom.nextInt: max (${max}) must be >= min (${min})`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability (default 50/50). */
  public nextBool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /** Picks one element. Deterministic for a given seed. */
  public pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('SeededRandom.pick: cannot pick from an empty array');
    }
    const item = items[this.nextInt(0, items.length - 1)];
    if (item === undefined) {
      throw new RangeError('SeededRandom.pick: picked index was out of range');
    }
    return item;
  }

  /** Returns a shuffled copy (Fisher-Yates). The input array is not mutated. */
  public shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(0, i);
      const a = result[i];
      const b = result[j];
      if (a === undefined || b === undefined) continue;
      result[i] = b;
      result[j] = a;
    }
    return result;
  }

  /**
   * Derives an independent, still-deterministic stream.
   * Used so e.g. mission rolls do not shift the city layout.
   */
  public fork(label: string): SeededRandom {
    return new SeededRandom(`${this.seedLabel}:${label}`);
  }

  /** Serializable snapshot of the generator position (for replay / save games). */
  public getState(): number {
    return this.state;
  }

  /** Restores a snapshot produced by `getState()`. */
  public setState(state: number): void {
    this.state = state >>> 0;
  }
}
import { describe, expect, it } from 'vitest';
import { SeededRandom } from '@/game/systems/SeededRandom';

/** Pulls `count` raw floats from a stream so two runs can be compared directly. */
function draw(count: number, seed: number | string): number[] {
  const rng = new SeededRandom(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe('SeededRandom', () => {
  it('produces the exact same sequence for the same numeric seed', () => {
    expect(draw(32, 42)).toEqual(draw(32, 42));
  });

  it('produces the exact same sequence for the same string seed', () => {
    expect(draw(32, 'neon-courier')).toEqual(draw(32, 'neon-courier'));
  });

  it('produces different sequences for different seeds', () => {
    expect(draw(32, 1)).not.toEqual(draw(32, 2));
  });

  it('hashes string seeds into a stable numeric seed', () => {
    const a = new SeededRandom('sector-04');
    const b = new SeededRandom('sector-04');

    expect(a.seed).toBe(b.seed);
    expect(a.seedLabel).toBe('sector-04');
    expect(Number.isInteger(a.seed)).toBe(true);
  });

  it('keeps next() inside [0, 1)', () => {
    const rng = new SeededRandom(2026);
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps nextInt inside an inclusive range and hits both ends', () => {
    const rng = new SeededRandom('bounds');
    let sawMin = false;
    let sawMax = false;

    for (let i = 0; i < 2000; i += 1) {
      const value = rng.nextInt(3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      if (value === 3) sawMin = true;
      if (value === 7) sawMax = true;
    }

    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  it('throws on an inverted integer range', () => {
    const rng = new SeededRandom(1);
    expect(() => rng.nextInt(10, 2)).toThrow(RangeError);
  });

  it('throws when picking from an empty array', () => {
    const rng = new SeededRandom(1);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('picks deterministically and always returns a member of the array', () => {
    const options = ['a', 'b', 'c', 'd'];
    const first = new SeededRandom(99);
    const second = new SeededRandom(99);

    for (let i = 0; i < 50; i += 1) {
      const picked = first.pick(options);
      expect(options).toContain(picked);
      expect(picked).toBe(second.pick(options));
    }
  });

  it('shuffles into a new array without mutating the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const snapshot = [...input];

    const shuffled = new SeededRandom('shuffle').shuffle(input);

    expect(input).toEqual(snapshot);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(snapshot);
    expect(new SeededRandom('shuffle').shuffle(input)).toEqual(shuffled);
  });

  it('forks a deterministic stream that does not advance the parent', () => {
    const parent = new SeededRandom('city-1');
    const forkA = parent.fork('missions');
    const forkB = parent.fork('missions');

    expect(forkA.next()).toBe(forkB.next());

    // Drawing from the fork must not shift the parent sequence.
    const untouched = new SeededRandom('city-1');
    expect(parent.next()).toBe(untouched.next());
  });

  it('round-trips state so a run can be paused and resumed', () => {
    const rng = new SeededRandom('resume');
    rng.next();
    rng.next();

    const state = rng.getState();
    const expected = [rng.next(), rng.next()];

    rng.setState(state);
    expect([rng.next(), rng.next()]).toEqual(expected);
  });
});
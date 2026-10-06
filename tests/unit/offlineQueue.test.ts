import { describe, it, expect } from 'vitest';
import {
  MAX_OUTBOX_ITEMS,
  MAX_PENDING_PROGRESSION_AGE_MS,
  clearPendingGrant,
  countOperations,
  emptyOutbox,
  enqueueOperation,
  operationsForUser,
  readPendingGrant,
  readPendingProgression,
  removeOperation,
  setAttempts,
  writePendingGrant,
  writePendingProgression,
} from '@/lib/offline/queue';
import type { QueuedOperation, ScoreOperation, StorageLike } from '@/lib/offline/queue';

/**
 * The outbox is the offline half of the sync loop: scores and challenge
 * progress wait here while the uplink is down, and `useOfflineSync` replays
 * them FIFO on reconnect. These tests pin the queue arithmetic — capacity,
 * ownership, and retry bookkeeping — without touching storage or network.
 */

function score(id: string, userId: string): ScoreOperation {
  return {
    kind: 'score',
    id,
    userId,
    enqueuedAt: 1,
    attempts: 0,
    body: {
      status: 'completed',
      packageId: 'pkg_data_drive',
      timeRatio: 0.5,
      durationSeconds: 60,
      claimedCredits: 100,
    },
  };
}

describe('enqueueOperation', () => {
  it('appends operations in FIFO order', () => {
    let outbox = emptyOutbox();
    outbox = enqueueOperation(outbox, score('a', 'u1'));
    outbox = enqueueOperation(outbox, score('b', 'u1'));
    expect(outbox.operations.map((op) => op.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest score when the cap is hit', () => {
    let outbox = emptyOutbox();
    for (let i = 0; i < MAX_OUTBOX_ITEMS + 3; i += 1) {
      outbox = enqueueOperation(outbox, score(`s-${i}`, 'u1'));
    }
    expect(outbox.operations).toHaveLength(MAX_OUTBOX_ITEMS);
    // The three oldest are gone; the newest survive.
    expect(outbox.operations[0]?.id).toBe('s-3');
    expect(outbox.operations[MAX_OUTBOX_ITEMS - 1]?.id).toBe(`s-${MAX_OUTBOX_ITEMS + 2}`);
  });
});

describe('operationsForUser', () => {
  it('keeps only the current courier\u2019s records', () => {
    let outbox = emptyOutbox();
    outbox = enqueueOperation(outbox, score('mine', 'u1'));
    outbox = enqueueOperation(outbox, score('theirs', 'u2'));
    const mine = operationsForUser(outbox, 'u1');
    expect(mine.map((op) => op.id)).toEqual(['mine']);
  });

  it('returns an empty list when every record is foreign', () => {
    const outbox = enqueueOperation(emptyOutbox(), score('theirs', 'u2'));
    expect(operationsForUser(outbox, 'u1')).toEqual([]);
  });
});

describe('removeOperation / setAttempts', () => {
  it('removes exactly the replayed record', () => {
    let outbox = enqueueOperation(enqueueOperation(emptyOutbox(), score('a', 'u1')), score('b', 'u1'));
    outbox = removeOperation(outbox, 'a');
    expect(outbox.operations.map((op) => op.id)).toEqual(['b']);
  });

  it('removing an unknown id leaves the queue untouched', () => {
    const outbox = enqueueOperation(emptyOutbox(), score('a', 'u1'));
    expect(removeOperation(outbox, 'missing').operations).toHaveLength(1);
  });

  it('setAttempts burns one retry without reordering', () => {
    let outbox = enqueueOperation(enqueueOperation(emptyOutbox(), score('a', 'u1')), score('b', 'u1'));
    outbox = setAttempts(outbox, 'a', 2);
    expect(outbox.operations.map((op) => op.id)).toEqual(['a', 'b']);
    expect(outbox.operations[0]?.attempts).toBe(2);
  });
});

describe('countOperations', () => {
  it('reports the badge depth', () => {
    const ops: QueuedOperation[] = [score('a', 'u1'), score('b', 'u1')];
    expect(countOperations({ version: 1, operations: ops })).toBe(2);
    expect(countOperations(emptyOutbox())).toBe(0);
  });
});

/** In-memory stand-in for `localStorage`, including a throwing variant below. */
function memoryStore(initial: Record<string, string> = {}): StorageLike {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe('pending grant', () => {
  it('round-trips a grant stamped with its owner', () => {
    const storage = memoryStore();
    writePendingGrant(
      { challengeId: 'dc_1', credits: 100, xp: 50, userId: 'u1', createdAt: 7 },
      storage
    );
    expect(readPendingGrant(storage)).toEqual({
      challengeId: 'dc_1',
      credits: 100,
      xp: 50,
      userId: 'u1',
      createdAt: 7,
    });
  });

  it('drops a legacy grant with no owner rather than misattributing it', () => {
    const storage = memoryStore({
      'neon-courier.pending-grant.v1': JSON.stringify({
        challengeId: 'dc_1',
        credits: 100,
        xp: 50,
        createdAt: 7,
      }),
    });
    expect(readPendingGrant(storage)).toBeNull();
  });

  it('drops a hand-edited grant instead of paying it', () => {
    const storage = memoryStore({
      'neon-courier.pending-grant.v1': JSON.stringify({
        challengeId: 'dc_1',
        credits: -5,
        xp: Number.NaN,
        userId: 'u1',
        createdAt: 7,
      }),
    });
    expect(readPendingGrant(storage)).toBeNull();
  });

  it('clearPendingGrant removes the handoff', () => {
    const storage = memoryStore();
    writePendingGrant(
      { challengeId: 'dc_1', credits: 1, xp: 1, userId: 'u1', createdAt: 1 },
      storage
    );
    clearPendingGrant(storage);
    expect(readPendingGrant(storage)).toBeNull();
  });
});

describe('pending progression', () => {
  const state = { money: 500, xp: 100, upgrades: { upgrade_thrusters: 2 } };

  it('round-trips the latest absolute snapshot', () => {
    const storage = memoryStore();
    writePendingProgression(state, storage);
    const pending = readPendingProgression(storage);
    expect(pending?.state).toEqual(state);
    expect(typeof pending?.queuedAt).toBe('number');
  });

  it('null clears the snapshot after a successful save', () => {
    const storage = memoryStore();
    writePendingProgression(state, storage);
    writePendingProgression(null, storage);
    expect(readPendingProgression(storage)).toBeNull();
  });

  it('rejects a snapshot with negative or fractional values', () => {
    const storage = memoryStore({
      'neon-courier.pending-progression.v1': JSON.stringify({
        v: 1,
        queuedAt: Date.now(),
        state: { money: -10, xp: 1.5, upgrades: {} },
      }),
    });
    expect(readPendingProgression(storage)).toBeNull();
  });

  it('the freshness bound is seven days', () => {
    expect(MAX_PENDING_PROGRESSION_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('a throwing store degrades to null instead of crashing', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readPendingProgression(hostile)).toBeNull();
    expect(readPendingGrant(hostile)).toBeNull();
    // Writes must not throw either — without storage the session simply plays
    // unsynced.
    expect(() =>
      writePendingProgression({ money: 1, xp: 0, upgrades: {} }, hostile)
    ).not.toThrow();
  });
});

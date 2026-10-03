import { describe, it, expect } from 'vitest';
import { ChallengeTracker } from '@/game/systems/ChallengeTracker';
import { EMPTY_CHALLENGE_SNAPSHOT } from '@/game/types/challenge';
import type { ChallengeProgressSnapshot, DailyChallenge } from '@/game/types/challenge';

/**
 * CHALLENGE TRACKER
 * =================
 *
 * The tracker is the game-state half of the feature: it owns the attempt window,
 * progress and completion, and knows nothing about clocks, React or the network.
 * These tests exercise it in plain Node, which is only possible because it does
 * not import Phaser.
 */

function challenge(overrides: Partial<DailyChallenge> = {}): DailyChallenge {
  return {
    id: 'dc_2026-09-29',
    dayIndex: 271,
    date: '2026-09-29',
    seedLabel: 'neon-courier:daily-challenge:2026-09-29',
    seed: 123456,
    title: 'RAPID DISPATCH',
    description: 'Deliver 5 packages in under 3 minutes.',
    tier: 'advanced',
    objective: { metric: 'deliveries', target: 5, windowSeconds: 180 },
    reward: { credits: 350, xp: 130 },
    ...overrides,
  };
}

function tracked(day: DailyChallenge | null = challenge()) {
  const snapshots: ChallengeProgressSnapshot[] = [];
  const tracker = new ChallengeTracker({
    challenge: day,
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  return { tracker, snapshots };
}

const delivery = (credits = 120, xp = 45) => ({ credits, xp, timeRatio: 0.5 });

describe('ChallengeTracker — without a challenge', () => {
  it('reports the neutral snapshot and ignores everything', () => {
    const { tracker } = tracked(null);
    expect(tracker.getSnapshot()).toEqual(EMPTY_CHALLENGE_SNAPSHOT);

    tracker.recordDelivery(delivery());
    tracker.update(10);
    tracker.beginAttempt();

    expect(tracker.getSnapshot()).toEqual(EMPTY_CHALLENGE_SNAPSHOT);
    expect(tracker.getChallenge()).toBeNull();
    // The neutral snapshot's tier is explicitly absent, not a placeholder band:
    // the HUD keys its accent colour off a *server-decided* tier, and a default
    // of `standard` would paint an unloaded panel as a real contract.
    expect(tracker.getSnapshot().tier).toBeNull();
  });

  it('mirrors the loaded challenge tier onto the snapshot', () => {
    // Difficulty is decided by the *generator* (its reward band), never by the
    // tracker, so the tracker's only job is to carry it across the seam verbatim.
    for (const tier of ['standard', 'advanced', 'elite'] as const) {
      const { tracker } = tracked(challenge({ tier }));
      expect(tracker.getSnapshot().tier).toBe(tier);
    }
  });
});

describe('ChallengeTracker — delivery objective', () => {
  it('arms the window on the first delivery and does not tick before that', () => {
    const { tracker } = tracked();

    tracker.update(120);
    expect(tracker.getSnapshot().windowActive).toBe(false);
    expect(tracker.getSnapshot().windowRemainingSeconds).toBe(180);

    tracker.recordDelivery(delivery());
    const snapshot = tracker.getSnapshot();
    expect(snapshot.windowActive).toBe(true);
    expect(snapshot.progress).toBe(1);
    expect(snapshot.bestProgress).toBe(1);
  });

  it('completes when the target is reached and freezes afterwards', () => {
    const { tracker } = tracked();

    for (let i = 0; i < 4; i++) tracker.recordDelivery(delivery());
    expect(tracker.getSnapshot().completed).toBe(false);
    expect(tracker.getSnapshot().progress).toBe(4);

    tracker.recordDelivery(delivery());
    const done = tracker.getSnapshot();
    expect(done.completed).toBe(true);
    expect(done.progress).toBe(5);
    expect(done.bestProgress).toBe(5);
    expect(done.windowActive).toBe(false);

    // Further deliveries cannot move a finished challenge.
    tracker.recordDelivery(delivery());
    tracker.update(30);
    expect(tracker.getSnapshot().progress).toBe(5);
    expect(tracker.getSnapshot().completed).toBe(true);
  });

  it('lapses the attempt when the window runs out, keeping the best progress', () => {
    const { tracker } = tracked();

    tracker.recordDelivery(delivery());
    tracker.recordDelivery(delivery());
    expect(tracker.getSnapshot().progress).toBe(2);

    tracker.update(179);
    expect(tracker.getSnapshot().lapsed).toBe(false);

    tracker.update(2);
    const lapsed = tracker.getSnapshot();
    expect(lapsed.lapsed).toBe(true);
    expect(lapsed.progress).toBe(0);
    expect(lapsed.bestProgress).toBe(2);
    expect(lapsed.windowActive).toBe(false);
    expect(lapsed.windowRemainingSeconds).toBe(180);

    // The next delivery is a fresh attempt, but the memory of 2 remains.
    tracker.recordDelivery(delivery());
    const retry = tracker.getSnapshot();
    expect(retry.lapsed).toBe(false);
    expect(retry.progress).toBe(1);
    expect(retry.bestProgress).toBe(2);
    expect(retry.windowActive).toBe(true);
  });

  it('quantizes the window countdown to whole seconds', () => {
    const { tracker, snapshots } = tracked();
    tracker.recordDelivery(delivery());
    snapshots.length = 0;

    // Ten sub-second frames inside one displayed second must emit nothing.
    for (let i = 0; i < 10; i++) tracker.update(0.05);
    expect(snapshots).toHaveLength(0);

    tracker.update(0.6);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.windowRemainingSeconds).toBe(179);
  });

  it('beginAttempt clears the current attempt but never a completed challenge', () => {
    const { tracker } = tracked();
    tracker.recordDelivery(delivery());
    tracker.recordDelivery(delivery());

    tracker.beginAttempt();
    expect(tracker.getSnapshot().progress).toBe(0);
    expect(tracker.getSnapshot().windowActive).toBe(false);

    for (let i = 0; i < 5; i++) tracker.recordDelivery(delivery());
    expect(tracker.getSnapshot().completed).toBe(true);

    tracker.beginAttempt();
    expect(tracker.getSnapshot().completed).toBe(true);
    expect(tracker.getSnapshot().progress).toBe(5);
  });
});

describe('ChallengeTracker — credits and xp objectives', () => {
  it('accumulates credits instead of counting deliveries', () => {
    const { tracker } = tracked(
      challenge({
        objective: { metric: 'credits', target: 500, windowSeconds: 300 },
        description: 'Earn ¢500 in delivery pay in under 5 minutes.',
      })
    );

    tracker.recordDelivery(delivery(210, 80));
    tracker.recordDelivery(delivery(160, 60));
    expect(tracker.getSnapshot().progress).toBe(370);

    tracker.recordDelivery(delivery(150, 50));
    expect(tracker.getSnapshot().progress).toBe(500);
    expect(tracker.getSnapshot().completed).toBe(true);
  });

  it('ignores a non-positive increment rather than arming the window', () => {
    const { tracker } = tracked(
      challenge({ objective: { metric: 'credits', target: 500, windowSeconds: 300 } })
    );

    tracker.recordDelivery({ credits: 0, xp: 0, timeRatio: 1 });
    expect(tracker.getSnapshot().progress).toBe(0);
    expect(tracker.getSnapshot().windowActive).toBe(false);

    tracker.recordDelivery({ credits: -50, xp: 10, timeRatio: 1 });
    expect(tracker.getSnapshot().progress).toBe(0);
    expect(tracker.getSnapshot().windowActive).toBe(false);
  });

  it('accumulates xp for the xp objective', () => {
    const { tracker } = tracked(
      challenge({ objective: { metric: 'xp', target: 200, windowSeconds: 300 } })
    );

    tracker.recordDelivery(delivery(120, 80));
    tracker.recordDelivery(delivery(95, 35));
    tracker.recordDelivery(delivery(95, 35));
    tracker.recordDelivery(delivery(95, 50));

    expect(tracker.getSnapshot().progress).toBe(200);
    expect(tracker.getSnapshot().completed).toBe(true);
  });
});

describe('ChallengeTracker — hydration and reward idempotence', () => {
  it('resumes a partially completed day from the server state', () => {
    const { tracker } = tracked();
    tracker.hydrate({ progress: 3, completed: false, rewardGranted: false });

    const snapshot = tracker.getSnapshot();
    expect(snapshot.progress).toBe(3);
    expect(snapshot.bestProgress).toBe(3);
    expect(snapshot.completed).toBe(false);
  });

  it('clamps a resumed progress into the objective range', () => {
    const { tracker } = tracked();
    tracker.hydrate({ progress: 99, completed: false, rewardGranted: false });
    expect(tracker.getSnapshot().progress).toBe(5);
  });

  it('treats a server-completed challenge as done and already paid', () => {
    const { tracker } = tracked();
    tracker.hydrate({ progress: 5, completed: true, rewardGranted: true });

    const snapshot = tracker.getSnapshot();
    expect(snapshot.completed).toBe(true);
    expect(snapshot.progress).toBe(5);
    expect(snapshot.rewardGranted).toBe(true);
  });

  it('pays the reward once, even across a reload', () => {
    const { tracker, snapshots } = tracked();
    for (let i = 0; i < 5; i++) tracker.recordDelivery(delivery());
    snapshots.length = 0;

    tracker.markRewardGranted();
    tracker.markRewardGranted();
    expect(snapshots).toHaveLength(1);
    expect(tracker.isRewardGranted()).toBe(true);

    // A reload re-hydrates the same day, but as already-claimed by the server.
    tracker.hydrate({ progress: 5, completed: true, rewardGranted: true });
    expect(tracker.isRewardGranted()).toBe(true);
  });
});

describe('ChallengeTracker — switching days', () => {
  it('wipes progress when a different day arrives', () => {
    const { tracker } = tracked();
    tracker.recordDelivery(delivery());
    expect(tracker.getSnapshot().progress).toBe(1);

    tracker.setChallenge(challenge({ id: 'dc_2026-09-30', dayIndex: 272 }));
    const snapshot = tracker.getSnapshot();
    expect(snapshot.challengeId).toBe('dc_2026-09-30');
    expect(snapshot.progress).toBe(0);
    expect(snapshot.completed).toBe(false);
  });

  it('keeps progress when the same day is re-supplied', () => {
    const { tracker } = tracked();
    tracker.recordDelivery(delivery());
    tracker.setChallenge(challenge());
    expect(tracker.getSnapshot().progress).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { DRONE_TRANSITIONS, DroneBrain, isValidDroneTransition } from '@/game/systems/DroneBrain';
import type { Point } from '@/game/types/city';
import {
  DEFAULT_DRONE_TUNING,
  DRONE_STATES,
  type DronePerception,
  type DroneStateTransition,
} from '@/game/types/enemy';

/** A square patrol loop. Big enough that no waypoint sits on the courier's test position. */
const ROUTE: Point[] = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 400 },
  { x: 0, y: 400 },
];

/**
 * Builds a perception from real geometry instead of hand-written booleans, so the tests
 * exercise the actual radii (`detectionRadius` / `loseRadius`) rather than a copy of them.
 */
function lookFrom(self: Point, player: Point): DronePerception {
  const distanceToPlayer = Math.hypot(player.x - self.x, player.y - self.y);

  return {
    playerPosition: { x: player.x, y: player.y },
    distanceToPlayer,
    playerVisible: distanceToPlayer <= DEFAULT_DRONE_TUNING.detectionRadius,
    playerWithinLoseRadius: distanceToPlayer <= DEFAULT_DRONE_TUNING.loseRadius,
  };
}

/** The courier, far outside both radii. */
function courierGone(self: Point): DronePerception {
  return lookFrom(self, { x: self.x + 5000, y: self.y });
}

/** Boots a drone straight into `patrol`: idle is a deployment delay, not the subject. */
function patrollingBrain(): DroneBrain {
  const brain = new DroneBrain(ROUTE);
  const self = { x: 200, y: 0 };
  brain.update(self, courierGone(self), DEFAULT_DRONE_TUNING.idleDurationSeconds);
  return brain;
}

describe('DroneBrain - boot and patrol', () => {
  it('holds in idle until the boot delay elapses, then reports the transition once', () => {
    const brain = new DroneBrain(ROUTE);
    const self = { x: 200, y: 0 };

    const warming = brain.update(self, courierGone(self), 1);
    expect(warming.state).toBe('idle');
    expect(warming.transition).toBeNull();

    const deployed = brain.update(self, courierGone(self), 0.3);
    expect(deployed.state).toBe('patrol');
    expect(deployed.transition).toEqual({ from: 'idle', to: 'patrol' });

    // The edge is reported on the tick it happens and never again.
    const settled = brain.update(self, courierGone(self), 0.1);
    expect(settled.transition).toBeNull();
  });

  it('patrols the route at patrol speed towards the next waypoint', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };

    const intent = brain.update(self, courierGone(self), 0.1);

    expect(intent.state).toBe('patrol');
    expect(intent.speed).toBe(DEFAULT_DRONE_TUNING.patrolSpeed);
    expect(intent.target).toEqual({ x: 0, y: 0 });
    expect(intent.direction).toEqual({ x: -1, y: 0 });
  });

  it('advances the waypoint once it is within the arrival radius', () => {
    const brain = patrollingBrain();
    const onCorner = { x: 0, y: 0 };

    // Standing on waypoint 0: the plan must roll to waypoint 1 instead of orbiting it.
    const intent = brain.update(onCorner, courierGone(onCorner), 0.1);

    expect(brain.getSnapshot().waypointIndex).toBe(1);
    expect(intent.target).toEqual({ x: 400, y: 0 });
    expect(intent.direction).toEqual({ x: 1, y: 0 });
  });

  it('holds still rather than producing NaN when self and target coincide', () => {
    const brain = new DroneBrain([{ x: 0, y: 0 }]);
    const origin = { x: 0, y: 0 };
    brain.update(origin, courierGone(origin), 2);

    const intent = brain.update(origin, courierGone(origin), 0.1);

    expect(Number.isFinite(intent.direction.x)).toBe(true);
    expect(Number.isFinite(intent.direction.y)).toBe(true);
    expect(intent.speed).toBe(0);
  });
});


describe('DroneBrain - acquisition', () => {
  it('cuts straight from idle to chase when the courier is in range at boot', () => {
    const brain = new DroneBrain(ROUTE);
    const self = { x: 0, y: 0 };

    const intent = brain.update(self, lookFrom(self, { x: 120, y: 0 }), 0.1);

    expect(intent.state).toBe('chase');
    expect(intent.transition).toEqual({ from: 'idle', to: 'chase' });
    expect(intent.speed).toBe(DEFAULT_DRONE_TUNING.chaseSpeed);
    expect(intent.direction).toEqual({ x: 1, y: 0 });
  });

  it('leaves patrol for chase as soon as the courier enters the detection radius', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };

    const intent = brain.update(self, lookFrom(self, { x: 300, y: 0 }), 0.1);

    expect(intent.state).toBe('chase');
    expect(intent.transition).toEqual({ from: 'patrol', to: 'chase' });
    expect(intent.target).toEqual({ x: 300, y: 0 });
  });

  it('ignores a courier outside the detection radius while patrolling', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };
    // 300px: outside detection (260) but inside lose (340).
    const intent = brain.update(self, lookFrom(self, { x: 500, y: 0 }), 0.1);

    expect(intent.state).toBe('patrol');
    expect(intent.transition).toBeNull();
  });
});

describe('DroneBrain - losing and re-acquiring the target', () => {
  it('keeps chasing inside the hysteresis band instead of flickering to search', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };

    brain.update(self, lookFrom(self, { x: 300, y: 0 }), 0.1);
    expect(brain.getSnapshot().state).toBe('chase');

    // Well past `loseSightGraceSeconds`, but still inside `loseRadius`.
    for (let i = 0; i < 30; i += 1) {
      const intent = brain.update(self, lookFrom(self, { x: 500, y: 0 }), 0.1);
      expect(intent.state).toBe('chase');
      expect(intent.transition).toBeNull();
    }

    expect(brain.getSnapshot().sightLostSeconds).toBeGreaterThan(
      DEFAULT_DRONE_TUNING.loseSightGraceSeconds
    );
  });

  it('drops to search only once the courier is gone for the whole grace period', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };

    brain.update(self, lookFrom(self, { x: 300, y: 0 }), 0.1);
    expect(brain.getSnapshot().state).toBe('chase');

    let elapsed = 0;
    let dropped: DroneStateTransition | null = null;

    for (let i = 0; i < 100 && dropped === null; i += 1) {
      const intent = brain.update(self, courierGone(self), 0.1);
      elapsed += 0.1;
      if (intent.transition) dropped = intent.transition;
    }

    expect(dropped).toEqual({ from: 'chase', to: 'search' });
    expect(elapsed).toBeGreaterThanOrEqual(DEFAULT_DRONE_TUNING.loseSightGraceSeconds - 0.05);
  });

  it('chases the remembered position during the grace window, not the live one', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };
    const seenPlayer = { x: 300, y: 0 };

    brain.update(self, lookFrom(self, seenPlayer), 0.1);

    const intent = brain.update(self, courierGone(self), 0.1);

    expect(intent.state).toBe('chase');
    expect(intent.target).toEqual(seenPlayer);
    expect(intent.speed).toBe(DEFAULT_DRONE_TUNING.chaseSpeed);
  });

  it('sweeps the cold trail for the full search duration, then resumes patrol', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };

    brain.update(self, lookFrom(self, { x: 300, y: 0 }), 0.1);
    for (let i = 0; i < 40 && brain.getSnapshot().state !== 'search'; i += 1) {
      brain.update(self, courierGone(self), 0.1);
    }
    expect(brain.getSnapshot().state).toBe('search');

    let swept = 0;
    let resumed: DroneStateTransition | null = null;
    for (let i = 0; i < 200 && resumed === null; i += 1) {
      const intent = brain.update(self, courierGone(self), 0.1);
      swept += 0.1;
      if (intent.transition) resumed = intent.transition;
    }

    expect(resumed).toEqual({ from: 'search', to: 'patrol' });
    expect(swept).toBeGreaterThanOrEqual(DEFAULT_DRONE_TUNING.searchDurationSeconds - 0.05);
  });

  it('re-acquires the courier mid-search', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };

    brain.update(self, lookFrom(self, { x: 300, y: 0 }), 0.1);
    for (let i = 0; i < 100 && brain.getSnapshot().state !== 'search'; i += 1) {
      brain.update(self, courierGone(self), 0.1);
    }
    expect(brain.getSnapshot().state).toBe('search');

    const intent = brain.update(self, lookFrom(self, { x: 300, y: 0 }), 0.1);

    expect(intent.state).toBe('chase');
    expect(intent.transition).toEqual({ from: 'search', to: 'chase' });
  });
});


describe('DroneBrain - transition table discipline', () => {
  it('only ever walks edges that the transition table declares legal', () => {
    const brain = new DroneBrain(ROUTE);
    const self = { x: 200, y: 0 };

    // One long scripted life: boot, patrol, chase, lose, search, re-acquire, lose again.
    const script: DronePerception[] = [
      courierGone(self),
      courierGone(self),
      courierGone(self),
      lookFrom(self, { x: 300, y: 0 }),
      lookFrom(self, { x: 300, y: 0 }),
      courierGone(self),
      courierGone(self),
      courierGone(self),
      courierGone(self),
      lookFrom(self, { x: 300, y: 0 }),
      courierGone(self),
    ];

    const seen: DroneStateTransition[] = [];
    for (const perception of script) {
      const intent = brain.update(self, perception, 0.6);
      if (intent.transition) seen.push(intent.transition);
    }

    // The scripted life must actually have exercised the machine, not idled through it.
    expect(seen.length).toBeGreaterThanOrEqual(3);

    for (const edge of seen) {
      expect(isValidDroneTransition(edge.from, edge.to)).toBe(true);
      expect(DRONE_TRANSITIONS[edge.from]).toContain(edge.to);
      expect(edge.from).not.toBe(edge.to);
      expect(DRONE_STATES).toContain(edge.to);
    }
  });

  it('declares no path back to idle — idle is a boot state only', () => {
    for (const state of DRONE_STATES) {
      expect(DRONE_TRANSITIONS[state]).not.toContain('idle');
    }
  });

  it('declares no CHASE -> PATROL edge, so losing the courier always searches first', () => {
    expect(DRONE_TRANSITIONS.chase).toEqual(['search']);
  });

  it('lists every state as a source, so the table is total', () => {
    for (const state of DRONE_STATES) {
      expect(DRONE_TRANSITIONS[state].length).toBeGreaterThan(0);
      for (const to of DRONE_TRANSITIONS[state]) {
        expect(DRONE_STATES).toContain(to);
      }
    }
  });
});

describe('DroneBrain - reset', () => {
  it('reboots to idle with route position and memory cleared', () => {
    const brain = patrollingBrain();
    const self = { x: 200, y: 0 };

    brain.update(self, lookFrom(self, { x: 300, y: 0 }), 0.1);
    expect(brain.getSnapshot().state).toBe('chase');
    expect(brain.getSnapshot().lastKnownPlayer).not.toBeNull();

    brain.reset();

    const snapshot = brain.getSnapshot();
    expect(snapshot.state).toBe('idle');
    expect(snapshot.stateAgeSeconds).toBe(0);
    expect(snapshot.waypointIndex).toBe(0);
    expect(snapshot.lastKnownPlayer).toBeNull();
    expect(snapshot.sightLostSeconds).toBe(0);
  });

  it('replays identically after a reset — the brain reads the same from the outside', () => {
    const self = { x: 200, y: 0 };
    const perceptions = [courierGone(self), lookFrom(self, { x: 300, y: 0 }), courierGone(self)];

    const play = (): unknown[] => {
      const brain = new DroneBrain(ROUTE);
      const intents: unknown[] = [];
      for (const perception of perceptions) intents.push(brain.update(self, perception, 0.4));
      brain.reset();
      for (const perception of perceptions) intents.push(brain.update(self, perception, 0.4));
      return intents;
    };

    expect(play()).toEqual(play());
  });
});

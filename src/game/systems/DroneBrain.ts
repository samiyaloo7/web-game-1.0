import type {
  DroneIntent,
  DronePerception,
  DroneState,
  DroneStateTransition,
  DroneTuning,
} from '../types/enemy';
import { DEFAULT_DRONE_TUNING } from '../types/enemy';
import type { Point } from '../types/city';

/**
 * The drone finite state machine.
 *
 * What is a finite state machine?
 * ------------------------------
 * An FSM describes a system as a fixed set of *states* plus the *events* that move it
 * between them. At any moment the drone is in exactly one state, and the only way that
 * changes is an explicit, listed transition. There is no "sort of chasing": either the
 * drone is in `chase` or it is not.
 *
 * Why this shape suits game AI:
 *
 *   1. It is exhaustive. Four states means four behaviours to write, and a reviewer can
 *      read the whole AI in one screen.
 *   2. It is debuggable. `brain.getSnapshot().state` tells you exactly what the agent
 *      thinks it is doing; you never have to infer intent from a soup of velocity,
 *      timers and booleans.
 *   3. It is testable. Transitions are pure functions of (state, perception, time), so
 *      every rule is provable in a unit test with no rendering engine — see
 *      `tests/unit/DroneBrain.test.ts`.
 *   4. It is extensible. A new ability is a new state plus its edges in
 *      `DRONE_TRANSITIONS`, and that table is asserted against at test time, so an
 *      illegal edge fails loudly instead of shipping.
 *   5. It scales along the standard game-AI ladder. One agent with four states is exactly
 *      where an FSM should be used; hierarchical FSM, behaviour trees or utility AI only
 *      start to pay off once the state count and agent count grow.
 *
 * The FSM lives here in plain TypeScript, with no Phaser import at all. The entity that
 * owns a brain only *applies* the resulting `DroneIntent`. That separation is what makes
 * a future pathfinding implementation a drop-in: same brain, better movement.
 */

/**
 * The legal edges of the machine. This is documentation *and* runtime-checked policy:
 * `DroneBrain` validates every transition against it, and the test suite walks the same
 * table looking for illegal edges.
 *
 * The intended cycle is:
 *
 *     IDLE -> PATROL -> CHASE -> SEARCH -> PATROL
 *
 * plus the two shortcuts that fall out of the sensor model:
 *
 *     IDLE -> CHASE    the courier is already in range when the drone boots
 *     SEARCH -> CHASE  the courier is re-acquired while sweeping the cold trail
 *
 * Note there is no `CHASE -> PATROL` edge: a drone that loses its target always sweeps
 * the last known position first. Jumping straight back to patrol would make the drone
 * look like it forgot the courier instantly.
 */
export const DRONE_TRANSITIONS: Readonly<Record<DroneState, readonly DroneState[]>> = {
  idle: ['patrol', 'chase'],
  patrol: ['chase'],
  chase: ['search'],
  search: ['chase', 'patrol'],
};

/** True when `to` is a legal edge from `from`. Used to validate the brain at runtime. */
export function isValidDroneTransition(from: DroneState, to: DroneState): boolean {
  return DRONE_TRANSITIONS[from].includes(to);
}

/** Below this, two points count as coincident. Avoids a 0/0 normalise producing NaN. */
const DIRECTION_EPSILON = 0.0001;

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Unit vector from `from` towards `to`, or `{0,0}` when the two points coincide.
 *
 * Returning zero instead of `NaN` matters: a courier standing exactly on a drone must not
 * poison the physics body with a NaN velocity.
 */
export function directionBetween(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < DIRECTION_EPSILON) return { x: 0, y: 0 };
  return { x: dx / length, y: dy / length };
}

/**
 * Turns raw geometry into the only world knowledge the FSM is allowed to consume.
 *
 * Kept as a free function so tests can fabricate perception without a scene, and so
 * richer sensing (vision cones, line-of-sight against buildings, sound) can be added
 * later without editing a single transition rule.
 */
export function sensePlayer(
  dronePosition: Point,
  playerPosition: Point,
  tuning: DroneTuning = DEFAULT_DRONE_TUNING
): DronePerception {
  const distanceToPlayer = distanceBetween(dronePosition, playerPosition);

  return {
    playerPosition: { x: playerPosition.x, y: playerPosition.y },
    distanceToPlayer,
    playerVisible: distanceToPlayer <= tuning.detectionRadius,
    playerWithinLoseRadius: distanceToPlayer <= tuning.loseRadius,
  };
}

/** Serialisable view of the brain, for debug overlays and test assertions. */
export interface DroneBrainSnapshot {
  state: DroneState;
  stateAgeSeconds: number;
  waypointIndex: number;
  lastKnownPlayer: Point | null;
  sightLostSeconds: number;
}

/**
 * Internal: the steering decision for one tick.
 *
 * Deliberately *not* exported. The brain's public contract is `DroneIntent`; this is just
 * the intermediate value the state switch produces before the transition is attached.
 */
interface MovementPlan {
  direction: Point;
  speed: number;
  target: Point;
}

export class DroneBrain {
  private readonly route: readonly Point[];
  private readonly tuning: DroneTuning;

  private currentState: DroneState = 'idle';
  private stateAgeSeconds = 0;
  private waypointIndex = 0;
  private lastKnownPlayer: Point | null = null;
  private sightLostSeconds = 0;

  /**
   * @param route Closed patrol loop. An empty route is legal: the drone then holds
   *              position while still running its full state machine.
   * @param tuning Behaviour numbers. Defaults to `DEFAULT_DRONE_TUNING`.
   */
  constructor(route: readonly Point[] = [], tuning: DroneTuning = DEFAULT_DRONE_TUNING) {
    this.route = route;
    this.tuning = tuning;
  }

  public get state(): DroneState {
    return this.currentState;
  }

  public get routeLength(): number {
    return this.route.length;
  }

  /**
   * Advances the machine one tick and reports what to do next.
   *
   * The order is deliberate: sense, decide, then move. A state change can only happen
   * through `applyTransition`, which validates against `DRONE_TRANSITIONS`.
   */
  public update(self: Point, perception: DronePerception, deltaSeconds: number): DroneIntent {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;

    this.stateAgeSeconds += dt;

    // Remember where the courier was whenever they are actually seen: that memory is what
    // the SEARCH state sweeps afterwards, and what CHASE falls back to during the grace
    // window after contact is lost.
    if (perception.playerVisible) {
      this.lastKnownPlayer = { x: perception.playerPosition.x, y: perception.playerPosition.y };
      this.sightLostSeconds = 0;
    } else {
      this.sightLostSeconds += dt;
    }

    // Hysteresis: while chasing, the wider `loseRadius` keeps the pursuit alive, so the
    // courier cannot jitter the drone between CHASE and SEARCH by hovering on the edge.
    const stillTracked = perception.playerVisible || perception.playerWithinLoseRadius;

    const nextState = this.decideNextState(perception.playerVisible, stillTracked);
    const transition = nextState === null ? null : this.applyTransition(nextState);

    const movement = this.buildMovementPlan(self, perception, stillTracked);

    return {
      state: this.currentState,
      direction: movement.direction,
      speed: movement.speed,
      target: movement.target,
      transition,
    };
  }

  /** Returns the state to move to this tick, or `null` to stay put. */
  private decideNextState(playerVisible: boolean, stillTracked: boolean): DroneState | null {
    switch (this.currentState) {
      case 'idle':
        // A courier standing in the deployment zone is worth an immediate response.
        if (playerVisible) return 'chase';
        return this.stateAgeSeconds >= this.tuning.idleDurationSeconds ? 'patrol' : null;

      case 'patrol':
        return playerVisible ? 'chase' : null;

      case 'chase':
        // Give up only once the courier is outside the wide radius *and* has stayed gone
        // for the grace period. That is what makes losing the player feel earned.
        if (!stillTracked && this.sightLostSeconds >= this.tuning.loseSightGraceSeconds) {
          return 'search';
        }
        return null;

      case 'search':
        if (playerVisible) return 'chase';
        return this.stateAgeSeconds >= this.tuning.searchDurationSeconds ? 'patrol' : null;

      default:
        return assertNever(this.currentState);
    }
  }

  private applyTransition(next: DroneState): DroneStateTransition {
    const from = this.currentState;

    if (!isValidDroneTransition(from, next)) {
      // A programming error rather than a gameplay event: report it, then refuse to move so
      // the agent keeps behaving predictably instead of entering an undefined state.
      console.warn(`[DroneBrain] illegal transition ${from} -> ${next}; staying in ${from}`);
      return { from, to: from };
    }

    this.currentState = next;
    this.stateAgeSeconds = 0;

    if (next === 'chase' || next === 'patrol') {
      this.sightLostSeconds = 0;
    }
    if (next === 'idle') {
      this.waypointIndex = 0;
    }

    return { from, to: next };
  }

  /** Per-state movement: simple steering only. No pathfinding, by design. */
  private buildMovementPlan(self: Point, perception: DronePerception, stillTracked: boolean): MovementPlan {
    switch (this.currentState) {
      case 'idle':
        return this.hold(self);

      case 'patrol':
        return this.patrolPlan(self);

      case 'chase': {
        // Direct pursuit: fly at the courier. If they are outside both radii we are inside
        // the grace window and instead fly at the remembered position, which reads as a
        // pursuit about to overshoot — exactly the intended "you got away" feel.
        const knowledge = stillTracked ? perception.playerPosition : this.lastKnownPlayer;
        if (knowledge === null) return this.hold(self);
        return this.driveTowards(self, knowledge, this.tuning.chaseSpeed);
      }

      case 'search': {
        const target = this.lastKnownPlayer;
        if (target === null) return this.hold(self);
        // Sit on the last known position and let the scanner sweep. The sweep itself is a
        // rendering concern; the FSM only decides when the trail goes cold.
        if (distanceBetween(self, target) <= this.tuning.waypointArriveRadius) return this.hold(self);
        return this.driveTowards(self, target, this.tuning.searchSpeed);
      }

      default:
        return assertNever(this.currentState);
    }
  }

  private patrolPlan(self: Point): MovementPlan {
    const waypoint = this.route[this.waypointIndex];
    if (waypoint === undefined) return this.hold(self);

    if (distanceBetween(self, waypoint) <= this.tuning.waypointArriveRadius) {
      this.waypointIndex = (this.waypointIndex + 1) % this.route.length;
    }

    const nextWaypoint = this.route[this.waypointIndex];
    if (nextWaypoint === undefined) return this.hold(self);

    return this.driveTowards(self, nextWaypoint, this.tuning.patrolSpeed);
  }

  private driveTowards(self: Point, target: Point, speed: number): MovementPlan {
    const direction = directionBetween(self, target);
    const isHolding = direction.x === 0 && direction.y === 0;
    return {
      direction,
      speed: isHolding ? 0 : speed,
      target: { x: target.x, y: target.y },
    };
  }

  private hold(self: Point): MovementPlan {
    return { direction: { x: 0, y: 0 }, speed: 0, target: { x: self.x, y: self.y } };
  }

  /** Full reset: back to a freshly deployed drone at the head of its route. */
  public reset(): void {
    this.currentState = 'idle';
    this.stateAgeSeconds = 0;
    this.waypointIndex = 0;
    this.lastKnownPlayer = null;
    this.sightLostSeconds = 0;
  }

  public getSnapshot(): DroneBrainSnapshot {
    return {
      state: this.currentState,
      stateAgeSeconds: this.stateAgeSeconds,
      waypointIndex: this.waypointIndex,
      lastKnownPlayer: this.lastKnownPlayer === null ? null : { ...this.lastKnownPlayer },
      sightLostSeconds: this.sightLostSeconds,
    };
  }
}

/** Compile-time exhaustiveness guard: adding a state forces every switch to be updated. */
function assertNever(state: never): never {
  throw new Error(`[DroneBrain] unhandled drone state: ${String(state)}`);
}
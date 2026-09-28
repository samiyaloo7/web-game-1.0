import type { Point } from './city';

/**
 * Pure, Phaser-free description of the security drone AI.
 *
 * Nothing in this file depends on the rendering engine, so the drone brain can be
 * unit tested in plain Node exactly like `CityGenerator`. The finite state machine
 * is where the bugs live, so it must not need a canvas to be verified.
 */

/**
 * The four states of the drone finite state machine.
 *
 *   idle   - freshly deployed; boots sensors for a moment before taking up patrol
 *   patrol - follows a fixed route of road intersections
 *   chase  - has the courier in sensor range and is driving straight at them
 *   search - courier escaped; sweeps the last known position, then resumes patrol
 */
export type DroneState = 'idle' | 'patrol' | 'chase' | 'search';

/** Ordered list of every state. Handy for exhaustive iteration and debug output. */
export const DRONE_STATES: readonly DroneState[] = ['idle', 'patrol', 'chase', 'search'];

/** Human-readable labels for debug overlays and HUD readouts. */
export const DRONE_STATE_LABELS: Readonly<Record<DroneState, string>> = {
  idle: 'IDLE',
  patrol: 'PATROL',
  chase: 'CHASE',
  search: 'SEARCH',
};

/**
 * Every number that shapes drone behaviour, in one place.
 *
 * `chaseSpeed` is deliberately below the player's top speed (310 px/s) so a courier
 * who commits to running can always escape — "losing the player" has to be a real
 * outcome, not a dice roll.
 */
export interface DroneTuning {
  /** Cruise speed while patrolling a route. */
  patrolSpeed: number;
  /** Pursuit speed once the courier is detected. */
  chaseSpeed: number;
  /** Speed while sweeping the last known position. */
  searchSpeed: number;
  /** How close the courier must be for the drone to notice them. */
  detectionRadius: number;
  /**
   * Outer radius that keeps an active chase alive. Larger than `detectionRadius`
   * on purpose: that gap is *hysteresis*, so a courier hovering right on the
   * detection edge does not make the drone flicker between CHASE and SEARCH.
   */
  loseRadius: number;
  /** Boot delay before the first patrol order. */
  idleDurationSeconds: number;
  /** How long a drone sweeps a cold trail before giving up and resuming patrol. */
  searchDurationSeconds: number;
  /** Grace period after the courier slips out of range before giving up pursuit. */
  loseSightGraceSeconds: number;
  /** Hull damage dealt on contact. */
  contactDamage: number;
  /** Per-drone delay between two contact hits, so a swarm cannot bite every frame. */
  contactCooldownSeconds: number;
  /** Distance at which a patrol waypoint counts as reached. */
  waypointArriveRadius: number;
}

export const DEFAULT_DRONE_TUNING: DroneTuning = {
  patrolSpeed: 92,
  chaseSpeed: 205,
  searchSpeed: 120,
  detectionRadius: 260,
  loseRadius: 340,
  idleDurationSeconds: 1.2,
  searchDurationSeconds: 5,
  loseSightGraceSeconds: 1.4,
  contactDamage: 18,
  contactCooldownSeconds: 0.9,
  waypointArriveRadius: 26,
};

/**
 * Everything the brain is allowed to know about the world this tick.
 *
 * The brain never reads a Phaser object: the entity (or a test) fills this in, which
 * is what keeps the AI deterministic, replayable and unit testable.
 */
export interface DronePerception {
  /** Courier position in world pixels. */
  playerPosition: Point;
  /** Straight-line distance from the drone to the courier. */
  distanceToPlayer: number;
  /** True when the courier is inside `detectionRadius`. */
  playerVisible: boolean;
  /** True when the courier is inside the wider `loseRadius`. */
  playerWithinLoseRadius: boolean;
}

/** A single FSM edge, reported on the tick it happens. */
export interface DroneStateTransition {
  from: DroneState;
  to: DroneState;
}

/**
 * The brain's output: an engine-agnostic movement order.
 *
 * Because the brain only produces intent (never velocity, never a Phaser body), the
 * movement model can be swapped — steering today, pathfinding or a flow field later —
 * without touching a single transition rule.
 */
export interface DroneIntent {
  state: DroneState;
  /** Unit vector to travel along. `{0,0}` means "hold position". */
  direction: Point;
  /** Speed in px/s the entity should settle at. `0` means "hold position". */
  speed: number;
  /** World point this state is currently driving towards (for debug overlays). */
  target: Point;
  /** Set on the single tick a transition occurred, otherwise `null`. */
  transition: DroneStateTransition | null;
}

/** Deterministic spawn order for one drone: where it starts and what it patrols. */
export interface DroneSpawnPlan {
  id: string;
  /** Starting position, always a road intersection. Also `route[0]`. */
  spawn: Point;
  /** Closed patrol loop. Consecutive points are always joined by a straight road. */
  route: Point[];
  /** Per-drone speed multiplier so a squad does not move in lockstep. */
  speedScale: number;
}

/** Knobs for how a district is policed. */
export interface EnemyConfig {
  /**
   * Upper bound on drones to place. `0` derives a map-scaled budget
   * (`deriveDroneCount`): roughly one drone per seven city blocks.
   */
  droneCount: number;
  /** Keep drones at least this far from the courier's spawn point. */
  minSpawnDistanceFromPlayer: number;
  /** Keep drones at least this far from each other, so threats stay spread out. */
  minDroneSeparation: number;
  /** +/- fraction applied to every drone's speed, for a less robotic squad. */
  droneSpeedJitter: number;
}

export const DEFAULT_ENEMY_CONFIG: EnemyConfig = {
  droneCount: 0,
  // Larger than `detectionRadius`, so the courier is never detected on the first frame.
  minSpawnDistanceFromPlayer: 420,
  minDroneSeparation: 260,
  droneSpeedJitter: 0.18,
};
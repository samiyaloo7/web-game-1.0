import Phaser from 'phaser';
import type { ProgressionSnapshot, ProgressionState } from './types/progression';


/**
 * Game-to-UI Event Map.
 * Events emitted by the Phaser simulation loop for React HUD to observe.
 */
export interface GameToUiEvents {
  /** Emitted when mission state, target, or phase changes */
  'mission:updated': {
    status: 'unassigned' | 'pickup_available' | 'in_transit' | 'success' | 'failed';
    packageName: string;
    cargoCategory: string;
    pickupZone: string;
    destinationName: string;
    destinationZone: string;
    timeLimitSeconds: number;
    remainingTimeSeconds: number;
    distance: number;
  };
  /** Quantized (1-second rounded) timer update during active transit */
  'mission:tick': {
    remainingTimeSeconds: number;
  };
  /** Emitted when credits, XP, or run counts change */
  'stats:updated': {
    credits: number;
    xp: number;
    score: number;
    completedCount: number;
    failedCount: number;
  };
  /**
   * Career progression mirror: fired only when money, XP, rank or owned upgrades
   * change (a completed delivery, a garage purchase, a reset) — never per frame.
   * Carries the fully derived stat block, so React renders numbers instead of
   * re-deriving game rules.
   */
  'progression:updated': ProgressionSnapshot;

  /** Emitted when game pause state toggles */
  'game:paused-changed': {
    isPaused: boolean;
  };
  /** Emitted when a new city has been generated, carrying its seed for replay */
  'city:generated': {
    seed: number;
    seedLabel: string;
    cols: number;
    rows: number;
    width: number;
    height: number;
    locationCount: number;
    buildingCount: number;
    obstacleCount: number;
  };
  /** Emitted whenever hull integrity, the shield window, or the wrecked flag changes */
  'player:health-changed': {
    health: number;
    maxHealth: number;
    invulnerable: boolean;
    isDead: boolean;
  };
  /**
   * Emitted only when the security picture actually changes (a drone starts or stops
   * tracking, or the nearest threat crosses a 100px bucket). A 60 FPS pursuit must never
   * emit per frame — see `ARCHITECTURE.md` §11, React render shielding.
   */
  'enemy:threat-changed': {
    trackingCount: number;
    nearestDistance: number;
  };
  /** Emitted when a run begins or ends, so the HUD can raise the game-over screen */
  'game:run-state-changed': {
    status: 'active' | 'over';
    reason: 'destroyed' | null;
    survivedSeconds: number;
  };
  /**
   * Emitted once per finished delivery attempt.
   *
   * Carries *references*, not the payout: the package id tells the server which
   * catalog row to price, and `timeRatio` says how much of the timer was left.
   * The credits are deliberately absent — the server recomputes them from its own
   * `package_defs` table and the courier's stored upgrades, so the browser can
   * describe the run but can never assert what it earned.
   *
   * The React layer turns this into `POST /api/scores`; Phaser itself never
   * imports Supabase or `fetch`.
   */
  'delivery:recorded': {
    status: 'completed' | 'failed';
    /** Key into the server-owned catalog. */
    packageId: string;
    /** Fraction of the timer remaining, 0..1. */
    timeRatio: number;
    /** Wall-clock seconds spent on the run. */
    durationSeconds: number;
    /** What the client believes it earned. Audit only — the server ignores it. */
    claimedCredits: number;
  };
  /** Engine lifecycle notifications */
  'game:ready': void;
  'game:destroyed': void;
}

/**
 * UI-to-Game Command Map.
 * Commands dispatched by React UI into the Phaser simulation engine.
 */
export interface UiToGameCommands {
  'cmd:toggle-pause': void;
  'cmd:set-pause': { paused: boolean };
  'cmd:restart-mission': void;
  /** Revive the courier and reset the district in place after a game over. */
  'cmd:restart-run': void;
  /** Generate a fresh city. Omit `seed` to roll a random one. */
  'cmd:regenerate-city': { seed?: number | string };
  /**
   * Hydrate the career profile from the database.
   *
   * Sent by `useProgressionSync` once the persisted row has loaded. The scene
   * treats the payload as *untrusted input*: `PlayerProgression`'s constructor
   * sanitises money, XP and upgrade levels, and rank is re-derived locally rather
   * than trusted from the wire. Loading a career is deliberately not a full
   * reset — the run in progress keeps its hull, speed and current mission.
   */
  'cmd:load-progression': { state: ProgressionState };
}

export type AllGameEvents = GameToUiEvents & UiToGameCommands;

/**
 * Strongly typed EventBus extending Phaser's EventEmitter.
 * Acts as the decoupled bidirectional communication bridge between Phaser and React.
 */
class TypedEventBus extends Phaser.Events.EventEmitter {
  emitEvent<K extends keyof GameToUiEvents>(
    event: K,
    ...args: GameToUiEvents[K] extends void ? [] : [GameToUiEvents[K]]
  ): boolean {
    return super.emit(event, ...args);
  }

  onEvent<K extends keyof GameToUiEvents>(
    event: K,
    fn: (data: GameToUiEvents[K]) => void,
    context?: unknown
  ): this {
    return super.on(event, fn, context);
  }

  offEvent<K extends keyof GameToUiEvents>(
    event: K,
    fn?: (data: GameToUiEvents[K]) => void,
    context?: unknown
  ): this {
    return super.off(event, fn, context);
  }

  sendCommand<K extends keyof UiToGameCommands>(
    cmd: K,
    ...args: UiToGameCommands[K] extends void ? [] : [UiToGameCommands[K]]
  ): boolean {
    return super.emit(cmd, ...args);
  }

  onCommand<K extends keyof UiToGameCommands>(
    cmd: K,
    fn: (data: UiToGameCommands[K]) => void,
    context?: unknown
  ): this {
    return super.on(cmd, fn, context);
  }

  offCommand<K extends keyof UiToGameCommands>(
    cmd: K,
    fn?: (data: UiToGameCommands[K]) => void,
    context?: unknown
  ): this {
    return super.off(cmd, fn, context);
  }
}

export const EventBus = new TypedEventBus();

import Phaser from 'phaser';
import type { ProgressionSnapshot } from './types/progression';


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

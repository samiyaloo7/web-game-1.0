import Phaser from 'phaser';

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
  /** Emitted when game pause state toggles */
  'game:paused-changed': {
    isPaused: boolean;
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

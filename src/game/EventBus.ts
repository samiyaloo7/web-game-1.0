import Phaser from 'phaser';
import type { ProgressionSnapshot, ProgressionState } from './types/progression';
import type { ChallengeProgressSnapshot, DailyChallenge } from './types/challenge';
import type { Occluder } from './systems/HudOcclusion';


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
  /**
   * Emitted when the set of HUD panels currently covering a tracked entity changes.
   *
   * The scene computes this from pure geometry and gates it on a signature, so a
   * courier weaving under a panel boundary at 60 FPS still produces only a handful
   * of events per minute — the `ARCHITECTURE.md` §11 render-shielding rule applies
   * here as much as anywhere else.
   *
   * Panels fade rather than disappear: live readouts (timer, hull) stay legible,
   * they just stop hiding the world behind them.
   */
  'hud:occlusion-changed': {
    /** Panel ids currently covering something, e.g. `['hud-mission']`. */
    occludedPanelIds: string[];
  };
  /**
   * Live daily-challenge state.
   *
   * Fired on real changes only — the tracker quantizes its window countdown to
   * whole seconds, so a 60 FPS attempt emits at most one event per second rather
   * than sixty. Carries the fully rendered challenge, so React never re-derives
   * the objective.
   */
  'challenge:progress': ChallengeProgressSnapshot;
  /**
   * Fired once when the objective is met, so React can report the completion to
   * the server and pay the reward exactly once.
   *
   * The payload carries the *numbers the game observed*; the amount actually paid
   * is the server's (`record_challenge_progress` re-derives it from the day's
   * generated challenge), which is why Phaser emits a fact and not a payout.
   */
  'challenge:completed': {
    challengeId: string;
    dayIndex: number;
    progress: number;
    target: number;
    rewardCredits: number;
    rewardXp: number;
  };
  /**
   * Engine lifecycle notifications.
   *
   * `game:ready` is emitted by the scene once its command listeners are registered and
   * the first dispatch exists; `game:destroyed` on shutdown. The HUD uses the pair to
   * tell "the simulation is live" from "the canvas is merely on screen".
   */
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
  /**
   * The HUD publishes its measured panel rects, in the canvas's own 1280x720 space.
   *
   * This is the seam between the two coordinate systems. React owns the DOM layout
   * (it knows how wide a panel actually rendered), Phaser owns the camera (it knows
   * what is on screen) — neither can see the other's half, and hard-coding panel
   * sizes here would silently rot the moment the HUD is edited. So React measures
   * once per layout change and reports; the scene converts that into which panels
   * are covering what.
   *
   * Rects are already scaled into game pixels by the sender, so the scene never has
   * to reason about CSS transforms or the canvas letterbox.
   */
  'cmd:sync-hud-occluders': { occluders: Occluder[] };
  /**
   * Hydrate (or replace) the day's daily challenge.
   *
   * Sent by `useDailyChallenge` after the *server* has decided which day it is —
   * never from the browser's own clock. The tracker treats a different id as a new
   * day and resets its attempt; the same id is a no-op so a refetch cannot wipe
   * live progress.
   *
   * `progress` resumes the courier's own row (how far they already got, and
   * whether the reward has already been paid) so a reload neither loses progress
   * nor pays twice.
   */
  'cmd:load-daily-challenge': {
    challenge: DailyChallenge | null;
    progress: {
      progress: number;
      completed: boolean;
      rewardGranted: boolean;
    } | null;
  };
  /**
   * Pay a confirmed challenge reward into the local career.
   *
   * Sent only after the server has recorded the completion (or, in a local-only
   * session with no Supabase, immediately by the fallback path). The scene applies
   * it through `PlayerProgression`, so the wallet/rank update and the debounced
   * save behave exactly as they do for a delivery payout.
   */
  'cmd:grant-challenge-reward': {
    challengeId: string;
    credits: number;
    xp: number;
  };
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

import { create } from 'zustand';
import { GameToUiEvents } from '@/game/EventBus';
import { xpToAdvance } from '@/game/systems/ProgressionMath';
import { DEFAULT_BASE_STATS, STARTING_MONEY } from '@/game/types/progression';
import type { ProgressionSnapshot } from '@/game/types/progression';

export interface HudMissionState {
  status: 'unassigned' | 'pickup_available' | 'in_transit' | 'success' | 'failed';
  packageName: string;
  cargoCategory: string;
  pickupZone: string;
  destinationName: string;
  destinationZone: string;
  timeLimitSeconds: number;
  remainingTimeSeconds: number;
  distance: number;
}

export interface HudStatsState {
  credits: number;
  xp: number;
  score: number;
  completedCount: number;
  failedCount: number;
}

/** Procedural city metadata surfaced in the HUD. */
export interface HudCityState {
  seed: number;
  seedLabel: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  locationCount: number;
  buildingCount: number;
  obstacleCount: number;
}

/** Courier hull state, driven by the pure `PlayerVitals` system inside `GameScene`. */
export interface HudVitalsState {
  health: number;
  maxHealth: number;
  invulnerable: boolean;
  isDead: boolean;
}

/** Security-droid picture: how many are locked on, and how close the nearest one is. */
export interface HudThreatState {
  trackingCount: number;
  nearestDistance: number;
}

/**
 * Career progression as mirrored from the game.
 *
 * This is *UI state*: a read-only projection of the authoritative `PlayerProgression`
 * game state, refreshed only when the game emits `progression:updated`. React may read
 * and render it freely, but it is never the source of truth and is never mutated here —
 * all rules (level derivation, prices, affordability) stay on the game side.
 */
export type HudProgressionState = ProgressionSnapshot;

/** Run lifecycle, so the HUD knows when to raise the game-over screen. */
export interface HudRunState {
  status: 'active' | 'over';
  reason: 'destroyed' | null;
  survivedSeconds: number;
}

interface GameStoreState {
  // Mission state
  mission: HudMissionState;
  // Session stats
  stats: HudStatsState;
  // Career progression mirror (persistent game state projected into the UI)
  progression: HudProgressionState;
  // Generated city metadata
  city: HudCityState;
  // Courier hull + security threat picture
  vitals: HudVitalsState;
  threat: HudThreatState;
  // Run lifecycle
  run: HudRunState;
  // Pause state
  isPaused: boolean;
  // Engine ready flag
  isEngineReady: boolean;
  /**
   * Persistence health, surfaced by the HUD so a courier can tell "saved" from
   * "silently not saving". UI state only — the authoritative career always lives
   * in the game's `PlayerProgression`.
   */
  syncStatus: 'idle' | 'saving' | 'saved' | 'error' | 'offline';
  /**
   * Set by the server's own `is_new_best` flag when a delivery beats the
   * courier's previous record. Server-decided, so a tampered client cannot
   * trigger the celebration.
   */
  isNewPersonalBest: boolean;

  // Actions
  setMission: (mission: GameToUiEvents['mission:updated']) => void;
  setTimerTick: (remainingTimeSeconds: number) => void;
  setStats: (stats: GameToUiEvents['stats:updated']) => void;
  setProgression: (progression: GameToUiEvents['progression:updated']) => void;
  setCity: (city: GameToUiEvents['city:generated']) => void;
  setVitals: (vitals: GameToUiEvents['player:health-changed']) => void;
  setThreat: (threat: GameToUiEvents['enemy:threat-changed']) => void;
  setRunState: (run: GameToUiEvents['game:run-state-changed']) => void;
  setIsPaused: (isPaused: boolean) => void;
  setIsEngineReady: (isReady: boolean) => void;
  setSyncStatus: (status: GameStoreState['syncStatus']) => void;
  setIsNewPersonalBest: (isNewBest: boolean) => void;
  resetSession: () => void;
}

const initialMission: HudMissionState = {
  status: 'unassigned',
  packageName: 'NO ACTIVE ASSIGNMENT',
  cargoCategory: 'N/A',
  pickupZone: 'STANDBY',
  destinationName: 'PENDING',
  destinationZone: 'PENDING',
  timeLimitSeconds: 0,
  remainingTimeSeconds: 0,
  distance: 0,
};

const initialStats: HudStatsState = {
  credits: 0,
  xp: 0,
  score: 0,
  completedCount: 0,
  failedCount: 0,
};

/**
 * Factory-default profile, kept in lockstep with `PlayerProgression` defaults so the
 * HUD shows correct numbers in the frame before the game's first snapshot arrives.
 */
const initialProgression: HudProgressionState = {
  money: STARTING_MONEY,
  xp: 0,
  level: 1,
  xpIntoLevel: 0,
  xpToNextLevel: xpToAdvance(1),
  levelProgress: 0,
  maxHealth: DEFAULT_BASE_STATS.maxHealth,
  speed: DEFAULT_BASE_STATS.speed,
  rewardMultiplier: DEFAULT_BASE_STATS.rewardMultiplier,
  timerBonusSeconds: DEFAULT_BASE_STATS.timerBonusSeconds,
  upgrades: {},
};

const initialCity: HudCityState = {
  seed: 0,
  seedLabel: '--',
  cols: 0,
  rows: 0,
  width: 0,
  height: 0,
  locationCount: 0,
  buildingCount: 0,
  obstacleCount: 0,
};

const initialVitals: HudVitalsState = {
  health: 100,
  maxHealth: 100,
  invulnerable: false,
  isDead: false,
};

const initialThreat: HudThreatState = {
  trackingCount: 0,
  nearestDistance: 0,
};

const initialRun: HudRunState = {
  status: 'active',
  reason: null,
  survivedSeconds: 0,
};

export const useGameStore = create<GameStoreState>((set) => ({
  mission: initialMission,
  stats: initialStats,
  progression: initialProgression,
  city: initialCity,
  vitals: initialVitals,
  threat: initialThreat,
  run: initialRun,
  isPaused: false,
  isEngineReady: false,
  syncStatus: 'idle',
  isNewPersonalBest: false,

  setMission: (mission) =>
    set({
      mission: {
        status: mission.status,
        packageName: mission.packageName,
        cargoCategory: mission.cargoCategory,
        pickupZone: mission.pickupZone,
        destinationName: mission.destinationName,
        destinationZone: mission.destinationZone,
        timeLimitSeconds: mission.timeLimitSeconds,
        remainingTimeSeconds: mission.remainingTimeSeconds,
        distance: mission.distance,
      },
    }),

  setTimerTick: (remainingTimeSeconds) =>
    set((state) => ({
      mission: {
        ...state.mission,
        remainingTimeSeconds,
      },
    })),

  setStats: (stats) => set({ stats }),

  setProgression: (progression) => set({ progression }),

  setCity: (city) => set({ city }),

  setVitals: (vitals) => set({ vitals }),

  setThreat: (threat) => set({ threat }),

  setRunState: (run) => set({ run }),

  setIsPaused: (isPaused) => set({ isPaused }),

  setIsEngineReady: (isReady) => set({ isEngineReady: isReady }),

  setSyncStatus: (syncStatus) => set({ syncStatus }),

  setIsNewPersonalBest: (isNewPersonalBest) => set({ isNewPersonalBest }),

  /**
   * Clears the *session* view only. `progression` is deliberately untouched: the career
   * profile is game state that outlives any single run and is republished by the game
   * itself whenever it actually changes.
   */
  resetSession: () =>
    set({
      mission: initialMission,
      stats: initialStats,
      city: initialCity,
      vitals: initialVitals,
      threat: initialThreat,
      run: initialRun,
      isPaused: false,
      isEngineReady: false,
    }),
}));

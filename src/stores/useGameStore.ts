import { create } from 'zustand';
import { GameToUiEvents } from '@/game/EventBus';
import { xpToAdvance } from '@/game/systems/ProgressionMath';
import { DEFAULT_BASE_STATS, STARTING_MONEY } from '@/game/types/progression';
import { EMPTY_CHALLENGE_SNAPSHOT } from '@/game/types/challenge';
import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioSettings,
} from '@/game/audio/AudioSettings';
import type { ChallengeProgressSnapshot } from '@/game/types/challenge';
import type { ProgressionSnapshot } from '@/game/types/progression';

/**
 * How the daily challenge is getting on with the server.
 *
 *  - `idle`     — nothing to report (no challenge, or still playing an attempt)
 *  - `syncing`  — a completion is being recorded
 *  - `granted`  — the server confirmed it and the reward is in the wallet
 *  - `offline`  — local-only session (no Supabase), reward paid locally
 *  - `error`    — the uplink failed; the HUD offers a retry-by-refresh
 */
export type ChallengeSyncStatus = 'idle' | 'syncing' | 'granted' | 'offline' | 'error';

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
   * Audio preferences as the HUD edits them.
   *
   * UI state, hydrated from localStorage by `useAudioSettings` and pushed into the
   * engine over `cmd:set-audio-settings`. The engine sanitises on its side too, so
   * a stale or hand-edited value can never reach the gain nodes unchecked.
   */
  audio: AudioSettings;
  /**
   * False until the browser's autoplay policy has allowed the AudioContext to run.
   *
   * Driven by `audio:state-changed`, never by React guessing — only the engine can
   * tell whether a `resume()` actually took.
   */
  audioUnlocked: boolean;
  /**
   * Connectivity, mirrored from `navigator.onLine` plus the `online`/`offline`
   * events. UI state only: every network call still fails on its own merits, so
   * a stale value here can delay a retry but can never authorise anything.
   */
  isOnline: boolean;
  /**
   * How many offline operations are waiting to be replayed (scores and daily
   * challenge progress). Driven by `useOfflineSync` after every outbox change.
   */
  pendingSyncCount: number;
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
  /**
   * Ids of the HUD panels currently covering something the courier needs to see.
   *
   * Written only by the game over `hud:occlusion-changed`, and already
   * signature-gated scene-side — a panel that covers the parcel for ten seconds
   * produces exactly one update, not six hundred. Panels read this to lower their own
   * opacity, so live readouts stay on screen without hiding the world behind them.
   */
  occludedPanelIds: string[];

  /**
   * Live daily-challenge mirror.
   *
   * UI state, like `mission` and `progression`: written only by the game over
   * `challenge:progress`, and already render-gated on the game side (the tracker
   * quantizes to whole seconds), so writing it verbatim cannot cause per-frame
   * renders. The authoritative challenge always lives in `ChallengeTracker`.
   */
  challenge: ChallengeProgressSnapshot;
  /**
   * How the challenge is getting on with the server, surfaced by the HUD so a
   * courier can tell "reward paid" from "could not reach the uplink".
   */
  challengeSyncStatus: ChallengeSyncStatus;

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

  /** Mirrors `navigator.onLine`; see the field's docblock for why it is UI-only. */
  setIsOnline: (isOnline: boolean) => void;
  /** Outbox depth, republished whenever an operation is enqueued or replayed. */
  setPendingSyncCount: (pendingSyncCount: number) => void;

  /** Replaces the audio preferences wholesale (hydrate, or any slider change). */
  setAudioSettings: (audio: AudioSettings) => void;
  /** Mirrors the engine's autoplay handshake. */
  setAudioUnlocked: (audioUnlocked: boolean) => void;
  setSyncStatus: (status: GameStoreState['syncStatus']) => void;
  setIsNewPersonalBest: (isNewBest: boolean) => void;
  setOccludedPanelIds: (occludedPanelIds: string[]) => void;
  setChallenge: (challenge: GameToUiEvents['challenge:progress']) => void;
  setChallengeSyncStatus: (status: ChallengeSyncStatus) => void;
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
  audio: { ...DEFAULT_AUDIO_SETTINGS },
  audioUnlocked: false,
  isOnline: true,
  pendingSyncCount: 0,
  syncStatus: 'idle',
  isNewPersonalBest: false,
  occludedPanelIds: [],
  challenge: EMPTY_CHALLENGE_SNAPSHOT,
  challengeSyncStatus: 'idle',

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

  setAudioSettings: (audio) => set({ audio: { ...audio } }),

  setAudioUnlocked: (audioUnlocked) => set({ audioUnlocked }),

  setIsOnline: (isOnline) => set({ isOnline }),

  setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),

  setSyncStatus: (syncStatus) => set({ syncStatus }),

  setIsNewPersonalBest: (isNewPersonalBest) => set({ isNewPersonalBest }),

  setOccludedPanelIds: (occludedPanelIds) => set({ occludedPanelIds }),

  setChallenge: (challenge) => set({ challenge }),

  setChallengeSyncStatus: (challengeSyncStatus) => set({ challengeSyncStatus }),

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
      occludedPanelIds: [],
    }),
}));

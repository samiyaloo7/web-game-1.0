import { create } from 'zustand';
import { GameToUiEvents } from '@/game/EventBus';

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

interface GameStoreState {
  // Mission state
  mission: HudMissionState;
  // Session stats
  stats: HudStatsState;
  // Pause state
  isPaused: boolean;
  // Engine ready flag
  isEngineReady: boolean;

  // Actions
  setMission: (mission: GameToUiEvents['mission:updated']) => void;
  setTimerTick: (remainingTimeSeconds: number) => void;
  setStats: (stats: GameToUiEvents['stats:updated']) => void;
  setIsPaused: (isPaused: boolean) => void;
  setIsEngineReady: (isReady: boolean) => void;
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

export const useGameStore = create<GameStoreState>((set) => ({
  mission: initialMission,
  stats: initialStats,
  isPaused: false,
  isEngineReady: false,

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

  setIsPaused: (isPaused) => set({ isPaused }),

  setIsEngineReady: (isReady) => set({ isEngineReady: isReady }),

  resetSession: () =>
    set({
      mission: initialMission,
      stats: initialStats,
      isPaused: false,
      isEngineReady: false,
    }),
}));

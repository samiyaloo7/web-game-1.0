/**
 * Represents the discrete phases of a delivery mission run.
 */
export type MissionStatus =
  | 'unassigned' // No package in the sector yet
  | 'pickup_available' // Package spawned in the world, waiting for player pickup
  | 'in_transit' // Package on board, countdown timer ticking, destination active
  | 'success' // Package delivered on time, rewards displayed
  | 'failed'; // Timer reached 0 or delivery failed

/**
 * Data specification for a package type. Designed to be data-driven.
 */
export interface PackageDefinition {
  id: string;
  name: string;
  weightCategory: 'light' | 'standard' | 'heavy';
  fragility: 'durable' | 'fragile';
  baseRewardCredits: number;
  baseRewardXp: number;
}

/**
 * Static or procedurally chosen locations across the city sector.
 */
export interface DeliveryLocation {
  id: string;
  name: string;
  zone: string;
  x: number;
  y: number;
}

/**
 * Active delivery mission data state.
 */
export interface ActiveMission {
  id: string;
  packageDef: PackageDefinition;
  pickupLocation: DeliveryLocation;
  dropoffLocation: DeliveryLocation;
  timeLimitSeconds: number;
  remainingTimeSeconds: number;
  status: MissionStatus;
  calculatedDistance: number;
  rewards?: {
    credits: number;
    xp: number;
    timeBonus: number;
  };
}

/**
 * Player career stats during this continuous play session.
 */
export interface SessionDeliveryStats {
  completedCount: number;
  failedCount: number;
  totalCreditsEarned: number;
  totalXpEarned: number;
}

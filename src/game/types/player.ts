/**
 * Discriminated union / enum describing the player's mechanical motion state.
 */
export type PlayerMovementState = 'idle' | 'moving';

/**
 * Configuration options for tuning player kinematics.
 */
export interface PlayerConfig {
  /** Maximum forward movement speed in pixels per second */
  speed: number;
  /** Acceleration rate in pixels per second squared */
  acceleration: number;
  /** Drag coefficient (damping) applied when no input is pressed [0..1] */
  drag: number;
}

export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  speed: 280,
  acceleration: 1200,
  drag: 0.88,
};

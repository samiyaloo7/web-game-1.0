/**
 * Player health as a pure system.
 *
 * Why not put `health` on the `Player` sprite? Because health is *rules*, not
 * rendering: damage, invulnerability frames and the game-over threshold are exactly
 * the things that must be verifiable without a canvas or a physics world. `Player`
 * stays a kinematic entity; `PlayerVitals` owns the numbers.
 *
 * The invulnerability window is what makes contact damage survivable: without it a
 * swarm of overlapping drones would drain the hull in a single frame.
 */

export interface VitalsConfig {
  /** Hull integrity at full health. */
  maxHealth: number;
  /** Seconds of immunity granted after taking a hit. */
  invulnerabilitySeconds: number;
}

export const DEFAULT_VITALS_CONFIG: VitalsConfig = {
  maxHealth: 100,
  invulnerabilitySeconds: 1.25,
};

/** Read-only snapshot handed to the HUD. */
export interface VitalState {
  health: number;
  maxHealth: number;
  /** 0..1, ready for a progress bar. */
  healthRatio: number;
  invulnerable: boolean;
  isDead: boolean;
}

/** Outcome of an attempted hit, so callers know whether to flash/shake the camera. */
export interface DamageResult {
  /** `false` when the hit was absorbed: dead, invulnerable, or a non-positive amount. */
  applied: boolean;
  /** Damage actually removed from the hull. */
  amount: number;
  remainingHealth: number;
  isDead: boolean;
}

function notApplied(health: number): DamageResult {
  return { applied: false, amount: 0, remainingHealth: health, isDead: false };
}

export class PlayerVitals {
  private readonly config: VitalsConfig;
  private healthValue: number;
  private invulnerabilityRemaining: number = 0;

  constructor(config: Partial<VitalsConfig> = {}) {
    this.config = { ...DEFAULT_VITALS_CONFIG, ...config };
    this.healthValue = this.config.maxHealth;
  }

  public get maxHealth(): number {
    return this.config.maxHealth;
  }

  /** Hull integrity, rounded for display. */
  public get health(): number {
    return Math.round(this.healthValue);
  }

  public get isDead(): boolean {
    return this.healthValue <= 0;
  }

  public get isInvulnerable(): boolean {
    return this.invulnerabilityRemaining > 0;
  }

  /**
   * Applies damage unless the hull is already destroyed or shielded.
   * A landed hit always starts a fresh invulnerability window.
   */
  public applyDamage(amount: number): DamageResult {
    if (!Number.isFinite(amount) || amount <= 0) return notApplied(this.health);
    if (this.isDead) return { applied: false, amount: 0, remainingHealth: 0, isDead: true };
    if (this.isInvulnerable) return notApplied(this.health);

    this.healthValue = Math.max(0, this.healthValue - amount);
    this.invulnerabilityRemaining = this.config.invulnerabilitySeconds;

    return {
      applied: true,
      amount,
      remainingHealth: this.health,
      isDead: this.isDead,
    };
  }

  /** Repairs the hull. Returns the amount actually restored. Never revives a wreck. */
  public heal(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0 || this.isDead) return 0;

    const before = this.healthValue;
    this.healthValue = Math.min(this.config.maxHealth, this.healthValue + amount);
    return Math.round(this.healthValue - before);
  }

  /** Ticks the invulnerability window down. Call once per frame. */
  public update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.invulnerabilityRemaining = Math.max(0, this.invulnerabilityRemaining - deltaSeconds);
  }

  /** Full repair plus a cleared shield window, used when a run is restarted. */
  public reset(): void {
    this.healthValue = this.config.maxHealth;
    this.invulnerabilityRemaining = 0;
  }

  public getState(): VitalState {
    return {
      health: this.health,
      maxHealth: this.config.maxHealth,
      healthRatio: this.config.maxHealth > 0 ? this.healthValue / this.config.maxHealth : 0,
      invulnerable: this.isInvulnerable,
      isDead: this.isDead,
    };
  }
}
import {
  ActiveMission,
  PackageDefinition,
  SessionDeliveryStats,
} from '../types/delivery';
import type { CityLocation } from '../types/city';
import { PACKAGE_CATALOG } from '../data/deliveryData';
import { EventBus } from '../EventBus';
import { SeededRandom } from './SeededRandom';
import { pickMissionLocations } from './CityGenerator';
import { applyRewardMultiplier } from './ProgressionMath';


export type DeliveryEventCallback = (mission: ActiveMission) => void;

/**
 * DeliveryManager coordinates the complete lifecycle of deliveries:
 * - Generating new missions from the generated city's locations
 * - Distance calculations & generous dynamic time limit formulas
 * - State machine updates (pickup -> in_transit -> success | failed)
 * - Bonus & reward calculations
 *
 * Randomness is injected as a `SeededRandom` rather than `Math.random()`, so a run
 * is reproducible: same city seed -> same sequence of dispatches.
 */
export class DeliveryManager {
  private currentMission: ActiveMission | null = null;
  private missionCounter: number = 0;
  private readonly minMissionDistance: number;
  /** Career tuning from the progression system: 1× payout and no bonus time until applied. */
  private rewardMultiplier: number = 1;
  private timerBonusSeconds: number = 0;
  private sessionStats: SessionDeliveryStats = {
    completedCount: 0,
    failedCount: 0,
    totalCreditsEarned: 0,
    totalXpEarned: 0,
  };

  private onMissionUpdated?: DeliveryEventCallback;
  private lastEmittedSecond: number = -1;

  constructor(onMissionUpdated?: DeliveryEventCallback, minMissionDistance: number = 0) {
    this.onMissionUpdated = onMissionUpdated;
    this.minMissionDistance = minMissionDistance;
  }

  /**
   * Applies the courier's career stat block (broker-licence payout multiplier and
   * Chrono-Stamped Manifest timer bonus). Invalid values are ignored rather than
   * clamped, so a bad payload can never wipe working tuning; call it again after any
   * upgrade purchase to re-sync dispatch with the new profile.
   */
  public applyProgressionTuning(tuning: {
    rewardMultiplier?: number;
    timerBonusSeconds?: number;
  }): void {
    if (
      tuning.rewardMultiplier !== undefined &&
      Number.isFinite(tuning.rewardMultiplier) &&
      tuning.rewardMultiplier >= 0
    ) {
      this.rewardMultiplier = tuning.rewardMultiplier;
    }

    if (tuning.timerBonusSeconds !== undefined && Number.isFinite(tuning.timerBonusSeconds)) {
      this.timerBonusSeconds = Math.max(0, Math.round(tuning.timerBonusSeconds));
    }
  }


  /**
   * Spawns a new delivery mission from the generated city's locations.
   * Returns `null` when the city cannot support a delivery (fewer than 2 locations).
   */
  public generateNewMission(
    locations: readonly CityLocation[],
    rng: SeededRandom
  ): ActiveMission | null {
    if (locations.length < 2) {
      return null;
    }

    // 1. Pick a package
    const packageDef: PackageDefinition = rng.pick(PACKAGE_CATALOG);

    // 2. Pick a pickup and a far-enough drop-off (both guaranteed to be on road)
    const [pickupLocation, dropoffLocation] = pickMissionLocations(
      locations,
      rng,
      this.minMissionDistance
    );

    // 3. Compute straight-line transit distance
    const dx = dropoffLocation.x - pickupLocation.x;
    const dy = dropoffLocation.y - pickupLocation.y;
    const calculatedDistance = Math.hypot(dx, dy);

    // 4. Time limit formula:
    // Generous for early testing: Base 12s + (distance / 180 px/s), plus any bonus
    // seconds granted by the Chrono-Stamped Manifest upgrade.
    const baseSeconds = 12;
    const transitSeconds = Math.round(calculatedDistance / 180);
    const timeLimitSeconds = baseSeconds + transitSeconds + this.timerBonusSeconds;

    this.missionCounter += 1;
    const mission: ActiveMission = {
      id: `msn_${rng.seed}_${this.missionCounter}`,
      packageDef,
      pickupLocation,
      dropoffLocation,
      timeLimitSeconds,
      remainingTimeSeconds: timeLimitSeconds,
      status: 'pickup_available',
      calculatedDistance: Math.round(calculatedDistance),
    };

    this.currentMission = mission;
    this.lastEmittedSecond = Math.ceil(timeLimitSeconds);
    this.notifyUpdate();
    return mission;
  }

  /**
   * Called when player enters the pickup zone.
   */
  public pickupPackage(): boolean {
    if (!this.currentMission || this.currentMission.status !== 'pickup_available') {
      return false;
    }

    this.currentMission.status = 'in_transit';
    this.lastEmittedSecond = Math.ceil(this.currentMission.remainingTimeSeconds);
    this.notifyUpdate();
    return true;
  }

  /**
   * Called when player successfully reaches destination while in_transit.
   */
  public completeDelivery(): boolean {
    if (!this.currentMission || this.currentMission.status !== 'in_transit') {
      return false;
    }

    // Reward calculation:
    // Base Credits + Time Bonus (percentage of remaining time preserved)
    const timeRatio = Math.max(
      0,
      this.currentMission.remainingTimeSeconds / this.currentMission.timeLimitSeconds
    );
    const timeBonus = Math.round(this.currentMission.packageDef.baseRewardCredits * 0.5 * timeRatio);
    // The broker-licence multiplier scales base pay and time bonus together. XP is left
    // untouched on purpose: rank pacing stays identical for every build.
    const finalCredits = applyRewardMultiplier(
      this.currentMission.packageDef.baseRewardCredits,
      timeBonus,
      this.rewardMultiplier
    );
    const finalXp = this.currentMission.packageDef.baseRewardXp;

    this.currentMission.status = 'success';
    this.currentMission.rewards = {
      credits: finalCredits,
      xp: finalXp,
      timeBonus,
    };

    // Update career stats
    this.sessionStats.completedCount += 1;
    this.sessionStats.totalCreditsEarned += finalCredits;
    this.sessionStats.totalXpEarned += finalXp;

    this.notifyUpdate();
    this.emitStatsUpdate();
    return true;
  }

  /**
   * Called each frame while in_transit to countdown the timer.
   */
  public updateTimer(deltaSeconds: number): void {
    if (!this.currentMission || this.currentMission.status !== 'in_transit') {
      return;
    }

    this.currentMission.remainingTimeSeconds = Math.max(
      0,
      this.currentMission.remainingTimeSeconds - deltaSeconds
    );

    // Quantized 1-second interval check for React HUD
    const currentSecondInt = Math.ceil(this.currentMission.remainingTimeSeconds);
    if (currentSecondInt !== this.lastEmittedSecond) {
      this.lastEmittedSecond = currentSecondInt;
      EventBus.emitEvent('mission:tick', {
        remainingTimeSeconds: currentSecondInt,
      });
    }

    if (this.currentMission.remainingTimeSeconds <= 0) {
      this.currentMission.status = 'failed';
      this.sessionStats.failedCount += 1;
      this.notifyUpdate();
      this.emitStatsUpdate();
    }
  }

  public getCurrentMission(): ActiveMission | null {
    return this.currentMission;
  }

  public getSessionStats(): SessionDeliveryStats {
    return { ...this.sessionStats };
  }

  public emitStatsUpdate(): void {
    const score = this.sessionStats.totalCreditsEarned + this.sessionStats.totalXpEarned * 2;
    EventBus.emitEvent('stats:updated', {
      credits: this.sessionStats.totalCreditsEarned,
      xp: this.sessionStats.totalXpEarned,
      score,
      completedCount: this.sessionStats.completedCount,
      failedCount: this.sessionStats.failedCount,
    });
  }

  private notifyUpdate(): void {
    if (!this.currentMission) return;

    if (this.onMissionUpdated) {
      this.onMissionUpdated(this.currentMission);
    }

    EventBus.emitEvent('mission:updated', {
      status: this.currentMission.status,
      packageName: this.currentMission.packageDef.name,
      cargoCategory: `${this.currentMission.packageDef.weightCategory.toUpperCase()} • ${this.currentMission.packageDef.fragility.toUpperCase()}`,
      pickupZone: this.currentMission.pickupLocation.zone,
      destinationName: this.currentMission.dropoffLocation.name,
      destinationZone: this.currentMission.dropoffLocation.zone,
      timeLimitSeconds: this.currentMission.timeLimitSeconds,
      remainingTimeSeconds: Math.ceil(this.currentMission.remainingTimeSeconds),
      distance: this.currentMission.calculatedDistance,
    });
  }
}

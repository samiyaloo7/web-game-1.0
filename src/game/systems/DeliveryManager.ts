import {
  ActiveMission,
  PackageDefinition,
  DeliveryLocation,
  SessionDeliveryStats,
} from '../types/delivery';
import { PACKAGE_CATALOG, SECTOR_LOCATIONS } from '../data/deliveryData';
import { EventBus } from '../EventBus';

export type DeliveryEventCallback = (mission: ActiveMission) => void;

/**
 * DeliveryManager coordinates the complete lifecycle of deliveries:
 * - Generating new procedural/catalog missions
 * - Distance calculations & generous dynamic time limit formulas
 * - State machine updates (pickup -> in_transit -> success | failed)
 * - Bonus & reward calculations
 */
export class DeliveryManager {
  private currentMission: ActiveMission | null = null;
  private sessionStats: SessionDeliveryStats = {
    completedCount: 0,
    failedCount: 0,
    totalCreditsEarned: 0,
    totalXpEarned: 0,
  };

  private onMissionUpdated?: DeliveryEventCallback;
  private lastEmittedSecond: number = -1;

  constructor(onMissionUpdated?: DeliveryEventCallback) {
    this.onMissionUpdated = onMissionUpdated;
  }

  /**
   * Spawns a new delivery mission by picking random locations and package definitions.
   */
  public generateNewMission(): ActiveMission {
    // 1. Pick a random package
    const pkgIndex = Math.floor(Math.random() * PACKAGE_CATALOG.length);
    const packageDef = PACKAGE_CATALOG[pkgIndex] as PackageDefinition;

    // 2. Pick distinct pickup and dropoff locations
    const availableLocs = [...SECTOR_LOCATIONS];
    const pickupIdx = Math.floor(Math.random() * availableLocs.length);
    const pickupLocation = availableLocs.splice(pickupIdx, 1)[0] as DeliveryLocation;

    const dropoffIdx = Math.floor(Math.random() * availableLocs.length);
    const dropoffLocation = availableLocs[dropoffIdx] as DeliveryLocation;

    // 3. Compute Euclidean transit distance
    const dx = dropoffLocation.x - pickupLocation.x;
    const dy = dropoffLocation.y - pickupLocation.y;
    const calculatedDistance = Math.hypot(dx, dy);

    // 4. Time limit formula:
    // Generous for early testing: Base 12s + (distance / 180 px/s)
    const baseSeconds = 12;
    const transitSeconds = Math.round(calculatedDistance / 180);
    const timeLimitSeconds = baseSeconds + transitSeconds;

    const mission: ActiveMission = {
      id: `msn_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
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
    const finalCredits = this.currentMission.packageDef.baseRewardCredits + timeBonus;
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

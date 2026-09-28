import * as Phaser from 'phaser';
import { SecurityDrone } from '../entities/SecurityDrone';
import type { Point } from '../types/city';
import type { DroneIntent, DronePerception, DroneSpawnPlan, DroneState, DroneTuning } from '../types/enemy';
import { DEFAULT_DRONE_TUNING } from '../types/enemy';
import { sensePlayer } from './DroneBrain';
import { EventBus } from '../EventBus';

/** Overlay colour per drone state: cyan = unaware, amber = suspicious, pink = hunting. */
const THREAT_ACCENTS: Readonly<Record<DroneState, number>> = {
  idle: 0x00f0ff,
  patrol: 0x00f0ff,
  chase: 0xff007f,
  search: 0xffaa00,
};

/**
 * Owns every security drone in the district: spawning, ticking their brains, and drawing
 * the threat readout they project onto the world.
 *
 * This is the only enemy file that touches Phaser. It keeps no AI rules of its own — it
 * feeds perception into each brain and applies the returned intent — so behaviour changes
 * never require editing this class.
 */
export class DroneDirector {
  private readonly scene: Phaser.Scene;
  private readonly tuning: DroneTuning;
  private readonly drones: SecurityDrone[] = [];
  private readonly group: Phaser.Physics.Arcade.Group;
  private readonly threatLayer: Phaser.GameObjects.Graphics;

  /** Last values pushed to React; `-1` forces the first emit. */
  private lastTrackingCount = -1;
  private lastNearestBucket = -1;

  constructor(scene: Phaser.Scene, tuning: DroneTuning = DEFAULT_DRONE_TUNING) {
    this.scene = scene;
    this.tuning = tuning;

    // One group lets a single collider/overlap cover the whole squad.
    this.group = scene.physics.add.group();

    // Depth 1: above the city (negative depths), below beacons (2) and the courier (10).
    this.threatLayer = scene.add.graphics().setDepth(1);
  }

  /** Instantiates the drones described by a deterministic spawn plan. */
  public spawnFromPlans(plans: readonly DroneSpawnPlan[]): void {
    for (const plan of plans) {
      const drone = new SecurityDrone(this.scene, plan, this.tuning);
      this.group.add(drone);
      this.drones.push(drone);
    }
  }

  /** The arcade group, for colliders and overlaps built by the scene. */
  public getGroup(): Phaser.Physics.Arcade.Group {
    return this.group;
  }

  public getDrones(): readonly SecurityDrone[] {
    return this.drones;
  }

  /** Sends every drone home and clears the overlay. Used by "restart run". */
  public resetAll(): void {
    for (const drone of this.drones) {
      drone.resetToSpawn();
    }
    this.lastTrackingCount = -1;
    this.lastNearestBucket = -1;
    this.threatLayer.clear();
  }

  public destroy(): void {
    this.threatLayer.destroy();
    this.drones.length = 0;
    // `true` destroys the drone sprites inside the group as well.
    this.group.destroy(true);
  }

  /**
   * Ticks every brain and redraws the threat overlays.
   *
   * @param playerPosition courier position in world pixels
   */
  public update(deltaSeconds: number, playerPosition: Point): void {
    let trackingCount = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    this.threatLayer.clear();

    for (const drone of this.drones) {
      const perception = sensePlayer(drone.position, playerPosition, this.tuning);
      const intent = drone.updateDrone(deltaSeconds, perception);

      if (intent.state === 'chase') trackingCount += 1;
      nearestDistance = Math.min(nearestDistance, perception.distanceToPlayer);

      this.drawThreatOverlay(drone, intent, perception);
    }

    this.emitThreatIfChanged(trackingCount, nearestDistance);
  }

  private drawThreatOverlay(
    drone: SecurityDrone,
    intent: DroneIntent,
    perception: DronePerception
  ): void {
    const accent = THREAT_ACCENTS[intent.state];

    if (intent.state === 'chase') {
      // Show exactly why the courier is being hunted: the sensor bubble plus a hard line.
      this.threatLayer.lineStyle(2, accent, 0.2);
      this.threatLayer.strokeCircle(drone.x, drone.y, this.tuning.detectionRadius);
      this.threatLayer.lineStyle(1.5, accent, 0.45);
      this.threatLayer.lineBetween(
        drone.x,
        drone.y,
        perception.playerPosition.x,
        perception.playerPosition.y
      );
      return;
    }

    if (intent.state === 'search') {
      // A pinging marker on the cold trail tells the player where they were last seen.
      this.threatLayer.lineStyle(2, accent, 0.14);
      this.threatLayer.strokeCircle(drone.x, drone.y, this.tuning.detectionRadius * 0.7);

      const lastKnown = drone.brain.getSnapshot().lastKnownPlayer;
      if (lastKnown) {
        this.threatLayer.lineStyle(1.5, accent, 0.5);
        this.threatLayer.strokeCircle(lastKnown.x, lastKnown.y, 16);
      }
      return;
    }

    // Idle / patrol: a rotating scanner beam reads as "sweeping for intruders".
    const sweep = this.scene.time.now / 900 + (drone.x + drone.y) / 260;
    const reach = this.tuning.detectionRadius * 0.55;
    this.threatLayer.lineStyle(2, accent, 0.3);
    this.threatLayer.lineBetween(
      drone.x,
      drone.y,
      drone.x + Math.cos(sweep) * reach,
      drone.y + Math.sin(sweep) * reach
    );
  }

  /**
   * Pushes a threat summary to the React HUD — but only when it changes.
   *
   * `ARCHITECTURE.md` is explicit that high-frequency game state must not be bound to
   * React state, so a 60 FPS pursuit must not emit 60 events per second. The tracking count
   * is inherently discrete, and distance is quantised into 100px buckets, which caps the
   * traffic at a handful of events per second while still reading as live in the HUD.
   */
  private emitThreatIfChanged(trackingCount: number, nearestDistance: number): void {
    const hasTarget = Number.isFinite(nearestDistance);
    const bucket = hasTarget ? Math.round(nearestDistance / 100) : -1;

    if (trackingCount === this.lastTrackingCount && bucket === this.lastNearestBucket) return;

    this.lastTrackingCount = trackingCount;
    this.lastNearestBucket = bucket;

    EventBus.emitEvent('enemy:threat-changed', {
      trackingCount,
      nearestDistance: hasTarget ? Math.round(nearestDistance) : 0,
    });
  }
}
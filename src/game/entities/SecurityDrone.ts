import * as Phaser from 'phaser';
import type { Point } from '../types/city';
import type { DroneIntent, DronePerception, DroneSpawnPlan, DroneTuning } from '../types/enemy';
import { DroneBrain } from '../systems/DroneBrain';

/** Radius of the drone's collision circle, in texture pixels. */
const BODY_RADIUS = 12;
/** How quickly the hull's velocity closes on the FSM's requested velocity (per second). */
const STEERING_RATE = 5.5;
/** How quickly the hull rotates towards its heading (per second). */
const TURN_RATE = 7;

/**
 * A security drone: the Phaser half of the enemy AI.
 *
 * All decisions live in `DroneBrain` (pure, unit tested). This class is deliberately dumb:
 * it asks the brain for an intent and then *applies* it to an arcade body — steering,
 * rotation, hover bob, contact cooldown. Because the split is "decide" versus "apply", a
 * future brain (pathfinding, flow field, squad tactics) drops in without touching physics,
 * and the current brain can be tested without a canvas.
 */
export class SecurityDrone extends Phaser.Physics.Arcade.Sprite {
  public static readonly TEXTURE_KEY = 'security-drone';

  public readonly plan: DroneSpawnPlan;
  public readonly tuning: DroneTuning;
  public readonly brain: DroneBrain;

  /** Seconds until this drone may claw the courier again. */
  private contactCooldownRemaining = 0;
  private hoverTimer = 0;

  constructor(scene: Phaser.Scene, plan: DroneSpawnPlan, tuning: DroneTuning) {
    super(scene, plan.spawn.x, plan.spawn.y, SecurityDrone.TEXTURE_KEY);

    this.plan = plan;
    this.tuning = tuning;
    this.brain = new DroneBrain(plan.route, tuning);

    SecurityDrone.ensureTexture(scene);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    // A circle body matches the drawn hull, so contact reads the way it looks.
    body.setCircle(BODY_RADIUS, (32 - BODY_RADIUS * 2) / 2, (32 - BODY_RADIUS * 2) / 2);

    // Below the courier (10) and above beacons (2) / threat overlays (1).
    this.setDepth(8);
  }

  /** World position as plain data, so the brain never touches a Phaser object. */
  public get position(): Point {
    return { x: this.x, y: this.y };
  }

  /**
   * Ticks the brain and applies the result. Returns the intent so the director can draw
   * debug/threat overlays without recomputing anything.
   */
  public updateDrone(deltaSeconds: number, perception: DronePerception): DroneIntent {
    const intent = this.brain.update(this.position, perception, deltaSeconds);

    this.contactCooldownRemaining = Math.max(0, this.contactCooldownRemaining - deltaSeconds);

    const body = this.body as Phaser.Physics.Arcade.Body;
    const speed = intent.speed * this.plan.speedScale;

    // Steering, not teleporting: lerping towards the requested velocity gives the drone
    // weight, so it overshoots a little when it changes its mind mid-chase.
    const blend = Math.min(1, STEERING_RATE * deltaSeconds);
    body.setVelocity(
      Phaser.Math.Linear(body.velocity.x, intent.direction.x * speed, blend),
      Phaser.Math.Linear(body.velocity.y, intent.direction.y * speed, blend)
    );

    if (intent.direction.x !== 0 || intent.direction.y !== 0) {
      // +PI/2 because the sprite is drawn nose-up.
      const targetAngle = Math.atan2(intent.direction.y, intent.direction.x) + Math.PI / 2;
      this.rotation = Phaser.Math.Angle.RotateTo(
        this.rotation,
        targetAngle,
        TURN_RATE * deltaSeconds
      );
    }

    // Hover bob keeps the drone reading as airborne even while the FSM holds position.
    this.hoverTimer += deltaSeconds;
    const pulse = 1 + Math.sin(this.hoverTimer * 5) * 0.035;
    this.setScale(pulse, pulse);

    return intent;
  }

  /** Per-drone gate so a swarm cannot land every hit on the same frame. */
  public canDealContactDamage(): boolean {
    return this.contactCooldownRemaining <= 0;
  }

  /** Starts this drone's contact cooldown and immediate knockback recovery. */
  public registerContactDamage(): void {
    this.contactCooldownRemaining = this.tuning.contactCooldownSeconds;
  }

  /** Sends the drone home, stops it dead, and reboots the FSM. Used by "restart run". */
  public resetToSpawn(): void {
    this.brain.reset();
    this.contactCooldownRemaining = 0;
    this.hoverTimer = 0;

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.reset(this.plan.spawn.x, this.plan.spawn.y);
    body.setVelocity(0, 0);

    this.setPosition(this.plan.spawn.x, this.plan.spawn.y);
    this.setRotation(0);
    this.setScale(1, 1);
  }

  /** Procedural hull texture, generated once per scene. */
  public static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(SecurityDrone.TEXTURE_KEY)) return;

    const g = scene.make.graphics({ x: 0, y: 0 });

    // Rotor nubs first, so the hull plates sit on top of them.
    g.fillStyle(0x00f0ff, 0.85);
    g.fillRect(15, 1, 2, 5);
    g.fillRect(15, 26, 2, 5);
    g.fillRect(1, 15, 5, 2);
    g.fillRect(26, 15, 5, 2);

    // Armoured hull.
    g.fillStyle(0x1b2030, 1);
    g.fillCircle(16, 16, 13);
    g.fillStyle(0x2a3245, 1);
    g.fillCircle(16, 16, 8.5);

    g.lineStyle(2, 0xff007f, 0.95);
    g.strokeCircle(16, 16, 13);
    g.lineStyle(1, 0xff007f, 0.35);
    g.strokeCircle(16, 16, 8.5);

    // Targeting lens, aimed by the sprite's rotation.
    g.fillStyle(0xff3b5c, 1);
    g.fillCircle(16, 11, 3.2);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(16, 10, 1.1);

    g.generateTexture(SecurityDrone.TEXTURE_KEY, 32, 32);
    g.destroy();
  }
}
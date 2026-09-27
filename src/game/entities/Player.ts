import * as Phaser from 'phaser';
import { PlayerConfig, PlayerMovementState, DEFAULT_PLAYER_CONFIG } from '../types/player';

export interface MovementInput {
  moveX: number; // -1 (left), 0, 1 (right)
  moveY: number; // -1 (up), 0, 1 (down)
}

/**
 * Player encapsulates the hoverbike entity, its physical arcade body,
 * internal state machine ('idle' | 'moving'), and procedural animations/effects.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  private config: PlayerConfig;
  private movementState: PlayerMovementState = 'idle';
  private engineGlow: Phaser.GameObjects.Graphics;
  private animTimer: number = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, config: Partial<PlayerConfig> = {}) {
    super(scene, x, y, 'player-courier');

    this.config = { ...DEFAULT_PLAYER_CONFIG, ...config };

    // Add to scene display list and physics world
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Setup engine exhaust glow graphics that follows the hoverbike
    this.engineGlow = scene.add.graphics();

    this.initPhysics();
  }

  private initPhysics(): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    body.setDamping(true);
    body.setDrag(this.config.drag);
    body.setMaxVelocity(this.config.speed);

    // Shrink physics hitbox slightly inside the sprite for forgiving gameplay collision
    body.setSize(24, 30);
    body.setOffset(4, 5);
  }

  /**
   * Update method called every tick of the game loop.
   * @param delta Milliseconds elapsed since the previous frame
   * @param input Normalized movement vector (-1 to 1)
   */
  public updatePlayer(delta: number, input: MovementInput): void {
    const deltaSeconds = delta / 1000;
    this.animTimer += deltaSeconds;

    const body = this.body as Phaser.Physics.Arcade.Body;

    // 1. Determine target state and apply delta-time scaled acceleration
    const isInputActive = input.moveX !== 0 || input.moveY !== 0;

    if (isInputActive) {
      this.movementState = 'moving';

      // Normalize diagonal vectors so moving diagonally isn't √2 faster
      let nx = input.moveX;
      let ny = input.moveY;
      if (nx !== 0 && ny !== 0) {
        nx *= 0.7071;
        ny *= 0.7071;
      }

      // Delta-time based acceleration: velocity change = acceleration * dt
      const accelX = nx * this.config.acceleration;
      const accelY = ny * this.config.acceleration;
      body.setAcceleration(accelX, accelY);

      // Smoothly rotate hoverbike toward motion direction
      const targetAngle = Math.atan2(ny, nx) + Math.PI / 2;
      // Interpolate angle smoothly for hover vehicle feel
      this.rotation = Phaser.Math.Angle.RotateTo(this.rotation, targetAngle, 12 * deltaSeconds);
    } else {
      this.movementState = 'idle';
      body.setAcceleration(0, 0);
    }

    // 2. Visual Animation: Hover oscillation & Engine exhaust
    this.updateVisualState();
  }

  private updateVisualState(): void {
    this.engineGlow.clear();

    if (this.movementState === 'idle') {
      // Idle Hover Animation: Subtle sine-wave scale pulsing (engine idling)
      const pulse = 1 + Math.sin(this.animTimer * 4) * 0.04;
      this.setScale(pulse, pulse);

      // Low amber idle engine exhaust
      this.renderThrusters(0xffaa00, 4 + Math.sin(this.animTimer * 6) * 1.5, 0.4);
    } else {
      // Moving State: Solid scale + fiery cyan/pink nitro exhaust
      this.setScale(1, 1);

      // High-energy engine trail flickering with animation timer
      const flameLength = 8 + Math.sin(this.animTimer * 20) * 3;
      this.renderThrusters(0x00f0ff, flameLength, 0.85);
    }
  }

  private renderThrusters(color: number, length: number, alpha: number): void {
    // Calculate world positions behind the hoverbike according to current rotation
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);

    // Thruster offsets relative to sprite center (nose is upward):
    // Left nozzle: (-8, 16), Right nozzle: (8, 16)
    const nozzles = [
      { lx: -8, ly: 16 },
      { lx: 8, ly: 16 },
    ];

    this.engineGlow.fillStyle(color, alpha);

    for (const nozzle of nozzles) {
      // Rotate relative coordinates
      const worldX = this.x + (nozzle.lx * cos - nozzle.ly * sin);
      const worldY = this.y + (nozzle.lx * sin + nozzle.ly * cos);

      // Draw exhaust flame extending backward
      const tipX = worldX + sin * length;
      const tipY = worldY - cos * length;

      this.engineGlow.fillCircle(worldX, worldY, 3);
      this.engineGlow.lineStyle(2, color, alpha);
      this.engineGlow.lineBetween(worldX, worldY, tipX, tipY);
    }
  }

  /**
   * Returns read-only current snapshot of player position & state for game queries.
   */
  public getState(): {
    state: PlayerMovementState;
    x: number;
    y: number;
    speed: number;
    rotation: number;
  } {
    const body = this.body as Phaser.Physics.Arcade.Body;
    return {
      state: this.movementState,
      x: this.x,
      y: this.y,
      speed: Math.round(body.speed),
      rotation: this.rotation,
    };
  }

  public setSpeed(newSpeed: number): void {
    this.config.speed = newSpeed;
    (this.body as Phaser.Physics.Arcade.Body).setMaxVelocity(newSpeed);
  }

  public override destroy(fromScene?: boolean): void {
    this.engineGlow.destroy();
    super.destroy(fromScene);
  }
}

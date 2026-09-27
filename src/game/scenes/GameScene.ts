import * as Phaser from 'phaser';
import { Player } from '../entities/Player';
import { InputManager } from '../systems/InputManager';

/**
 * GameScene is the primary Phaser Scene where the real-time simulation loop runs.
 * It manages the world canvas, physics bounds, background grid, and player updates.
 */
export class GameScene extends Phaser.Scene {
  private player!: Player;
  private inputManager!: InputManager;
  private telemetryText!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    this.createProgrammaticTextures();
  }

  create(): void {
    const worldWidth = 1280;
    const worldHeight = 720;

    // 1. Draw a cyberpunk grid background
    this.createGridBackground(worldWidth, worldHeight);

    // 2. Set physics bounds
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

    // 3. Instantiate decoupled input system
    this.inputManager = new InputManager(this);

    // 4. Instantiate Player entity (encapsulating physics, animation, and state)
    this.player = new Player(this, worldWidth / 2, worldHeight / 2, {
      speed: 300,
      acceleration: 1400,
      drag: 0.88,
    });

    // 5. In-canvas Telemetry Overlay
    this.add.text(16, 16, 'NEON COURIER // SECTOR 04 ACTIVE', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#00f0ff',
    });

    this.stateText = this.add.text(16, 36, 'STATUS: IDLE', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ffaa00',
    });

    this.telemetryText = this.add.text(16, 54, 'POS: [0, 0] | SPEED: 0 KM/H', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#94a3b8',
    });
  }

  /**
   * The Game Loop's update step.
   * @param time Total game elapsed time in ms
   * @param delta Milliseconds elapsed since the previous tick (delta time)
   */
  override update(_time: number, delta: number): void {
    if (!this.player || !this.inputManager) return;

    // 1. Read input intent from InputManager
    const input = this.inputManager.getMovementInput();

    // 2. Advance player simulation using delta time
    this.player.updatePlayer(delta, input);

    // 3. Inspect player state
    const playerSnapshot = this.player.getState();

    // 4. Update in-canvas telemetry text
    const statusColor = playerSnapshot.state === 'moving' ? '#39ff14' : '#ffaa00';
    this.stateText.setText(`STATUS: ${playerSnapshot.state.toUpperCase()}`);
    this.stateText.setColor(statusColor);

    this.telemetryText.setText(
      `POS: [${Math.round(playerSnapshot.x)}, ${Math.round(playerSnapshot.y)}] | SPEED: ${playerSnapshot.speed} KM/H`
    );
  }

  /**
   * Generates lightweight, procedural textures into Phaser's TextureManager.
   */
  private createProgrammaticTextures(): void {
    if (!this.textures.exists('player-courier')) {
      const graphics = this.make.graphics({ x: 0, y: 0 });

      // Hoverbike Chassis (arrowhead / wedge shape)
      graphics.fillStyle(0x00f0ff, 1); // Neon cyan hull
      graphics.beginPath();
      graphics.moveTo(16, 2);   // Nose
      graphics.lineTo(30, 36);  // Right wing
      graphics.lineTo(16, 28);  // Engine indenture
      graphics.lineTo(2, 36);   // Left wing
      graphics.closePath();
      graphics.fillPath();

      // Wing outline for definition
      graphics.lineStyle(1.5, 0xffffff, 0.9);
      graphics.strokePath();

      // Cockpit canopy
      graphics.fillStyle(0xff007f, 1); // Neon pink canopy
      graphics.fillCircle(16, 18, 4.5);

      // Dual engine thruster housings
      graphics.fillStyle(0x171b26, 1);
      graphics.fillRect(5, 30, 6, 6);
      graphics.fillRect(21, 30, 6, 6);

      graphics.generateTexture('player-courier', 32, 40);
      graphics.destroy();
    }
  }

  /**
   * Renders a glowing neon city grid to serve as the street map.
   */
  private createGridBackground(width: number, height: number): void {
    const grid = this.add.graphics();
    const gridSize = 40;

    // Dark asphalt
    grid.fillStyle(0x0a0c14, 1);
    grid.fillRect(0, 0, width, height);

    // Grid lines
    grid.lineStyle(1, 0x171e2e, 0.8);

    for (let x = 0; x <= width; x += gridSize) {
      grid.moveTo(x, 0);
      grid.lineTo(x, height);
    }

    for (let y = 0; y <= height; y += gridSize) {
      grid.moveTo(0, y);
      grid.lineTo(width, y);
    }

    grid.strokePath();

    // Outer neon boundary border
    grid.lineStyle(3, 0x00f0ff, 0.6);
    grid.strokeRect(4, 4, width - 8, height - 8);

    // Subtle center marker
    grid.lineStyle(1, 0xff007f, 0.4);
    grid.strokeCircle(width / 2, height / 2, 60);
  }
}


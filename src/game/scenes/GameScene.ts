import * as Phaser from 'phaser';

/**
 * GameScene is the primary Phaser Scene where the real-time gameplay loop runs.
 * It manages the world canvas, physics world, tile/grid visuals, and player updates.
 */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private readonly playerSpeed: number = 240;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    // We generate programmatic textures here so the game does not depend on external image files during early dev.
    this.createProgrammaticTextures();
  }

  create(): void {
    const worldWidth = 1280;
    const worldHeight = 720;

    // 1. Draw a cyberpunk grid background
    this.createGridBackground(worldWidth, worldHeight);

    // 2. Set physics bounds
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

    // 3. Create the player hoverbike sprite using the generated texture
    this.player = this.physics.add.sprite(worldWidth / 2, worldHeight / 2, 'player-courier');
    this.player.setCollideWorldBounds(true);
    this.player.setDamping(true);
    this.player.setDrag(0.85); // Adds a nice drift / momentum deceleration feel
    this.player.setMaxVelocity(this.playerSpeed);

    // 4. Setup keyboard controls: Arrow keys + WASD
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    }

    // 5. Add a simple HUD label directly inside the canvas to show coordinates
    this.add.text(16, 16, 'SECTOR 04 // SIMULATION ONLINE', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#00f0ff',
    });

    this.add.text(16, 36, 'CONTROLS: WASD / ARROWS TO NAVIGATE', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#94a3b8',
    });
  }

  override update(): void {
    if (!this.player || !this.cursors || !this.wasd) return;

    let moveX = 0;
    let moveY = 0;

    // Handle horizontal movement
    if (this.cursors.left.isDown || this.wasd.A.isDown) {
      moveX -= 1;
    }
    if (this.cursors.right.isDown || this.wasd.D.isDown) {
      moveX += 1;
    }

    // Handle vertical movement
    if (this.cursors.up.isDown || this.wasd.W.isDown) {
      moveY -= 1;
    }
    if (this.cursors.down.isDown || this.wasd.S.isDown) {
      moveY += 1;
    }

    // Normalize diagonal velocity so diagonal moving isn't sqrt(2) faster
    if (moveX !== 0 && moveY !== 0) {
      moveX *= 0.7071;
      moveY *= 0.7071;
    }

    // Apply acceleration / velocity
    const targetVelocityX = moveX * this.playerSpeed;
    const targetVelocityY = moveY * this.playerSpeed;

    this.player.setVelocity(targetVelocityX, targetVelocityY);

    // Rotate player sprite toward direction of motion
    if (moveX !== 0 || moveY !== 0) {
      const angle = Math.atan2(moveY, moveX);
      this.player.setRotation(angle + Math.PI / 2); // Oriented upward by default
    }
  }

  /**
   * Generates lightweight, procedural textures into Phaser's TextureManager.
   * This provides crisp visuals without needing external asset downloads.
   */
  private createProgrammaticTextures(): void {
    // Check if texture already exists (e.g. across scene restarts)
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

      // Cockpit canopy
      graphics.fillStyle(0xff007f, 1); // Neon pink canopy
      graphics.fillCircle(16, 18, 5);

      // Dual engine thrusters
      graphics.fillStyle(0xffaa00, 1); // Amber engine exhaust
      graphics.fillRect(6, 32, 4, 6);
      graphics.fillRect(22, 32, 4, 6);

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

    // Neon grid lines
    grid.lineStyle(1, 0x1e2638, 0.7);

    for (let x = 0; x <= width; x += gridSize) {
      grid.moveTo(x, 0);
      grid.lineTo(x, height);
    }

    for (let y = 0; y <= height; y += gridSize) {
      grid.moveTo(0, y);
      grid.lineTo(width, y);
    }

    grid.strokePath();

    // Road borders (outer boundary glow)
    grid.lineStyle(3, 0x00f0ff, 0.5);
    grid.strokeRect(4, 4, width - 8, height - 8);
  }
}

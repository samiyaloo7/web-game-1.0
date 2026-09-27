import * as Phaser from 'phaser';

/**
 * Visual pickup beacon and interactive trigger zone.
 * Has an animated neon pulse ring and floating crate icon.
 */
export class PackageDrop extends Phaser.GameObjects.Container {
  private baseRing: Phaser.GameObjects.Graphics;
  private crateSprite: Phaser.GameObjects.Sprite;
  private labelText: Phaser.GameObjects.Text;
  private animTimer: number = 0;
  public readonly interactionRadius: number = 48;

  constructor(scene: Phaser.Scene, x: number, y: number, packageName: string) {
    super(scene, x, y);

    this.baseRing = scene.add.graphics();
    this.add(this.baseRing);

    // Ensure package texture exists
    PackageDrop.ensureTexture(scene);

    this.crateSprite = scene.add.sprite(0, 0, 'package-crate');
    this.add(this.crateSprite);

    this.labelText = scene.add.text(0, -32, packageName.toUpperCase(), {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffaa00',
      backgroundColor: '#08090de6',
      padding: { x: 4, y: 2 },
    });
    this.labelText.setOrigin(0.5, 0.5);
    this.add(this.labelText);

    scene.add.existing(this);
  }

  public updateAnimation(deltaSeconds: number): void {
    this.animTimer += deltaSeconds;

    // Hover bobbing effect for the crate
    this.crateSprite.y = Math.sin(this.animTimer * 5) * 4;

    // Animated beacon rings on ground
    this.baseRing.clear();

    const ringScale = (this.animTimer * 1.5) % 1;
    const ringRadius = this.interactionRadius * ringScale;
    const alpha = 1 - ringScale;

    // Outer expanding wave
    this.baseRing.lineStyle(2, 0xffaa00, alpha * 0.8);
    this.baseRing.strokeCircle(0, 0, ringRadius);

    // Inner static ring
    this.baseRing.lineStyle(1.5, 0xffaa00, 0.9);
    this.baseRing.strokeCircle(0, 0, this.interactionRadius * 0.45);

    // Semi-transparent target fill
    this.baseRing.fillStyle(0xffaa00, 0.12);
    this.baseRing.fillCircle(0, 0, this.interactionRadius * 0.45);
  }

  public static ensureTexture(scene: Phaser.Scene): void {
    if (!scene.textures.exists('package-crate')) {
      const g = scene.make.graphics({ x: 0, y: 0 });

      // Crate body: Cyber amber container
      g.fillStyle(0xffaa00, 1);
      g.fillRect(4, 4, 24, 24);

      // Inner tech lines
      g.lineStyle(2, 0x08090d, 1);
      g.strokeRect(6, 6, 20, 20);
      g.lineBetween(6, 6, 26, 26);
      g.lineBetween(26, 6, 6, 26);

      // Glowing power core in center of crate
      g.fillStyle(0x00f0ff, 1);
      g.fillCircle(16, 16, 3.5);

      g.generateTexture('package-crate', 32, 32);
      g.destroy();
    }
  }

  public override destroy(fromScene?: boolean): void {
    this.baseRing.destroy();
    this.crateSprite.destroy();
    this.labelText.destroy();
    super.destroy(fromScene);
  }
}

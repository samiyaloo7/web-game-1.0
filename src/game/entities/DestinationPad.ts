import * as Phaser from 'phaser';

/**
 * Visual destination dropoff zone with a high-intensity neon landing pad and target beacon.
 */
export class DestinationPad extends Phaser.GameObjects.Container {
  private padGraphics: Phaser.GameObjects.Graphics;
  private labelText: Phaser.GameObjects.Text;
  private animTimer: number = 0;
  public readonly interactionRadius: number = 54;

  constructor(scene: Phaser.Scene, x: number, y: number, destinationName: string) {
    super(scene, x, y);

    this.padGraphics = scene.add.graphics();
    this.add(this.padGraphics);

    this.labelText = scene.add.text(0, -42, `DELIVER: ${destinationName.toUpperCase()}`, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ff007f',
      backgroundColor: '#08090de6',
      padding: { x: 4, y: 2 },
    });
    this.labelText.setOrigin(0.5, 0.5);
    this.add(this.labelText);

    scene.add.existing(this);
  }

  public updateAnimation(deltaSeconds: number): void {
    this.animTimer += deltaSeconds;

    this.padGraphics.clear();

    // 1. Crosshair lines
    this.padGraphics.lineStyle(1.5, 0xff007f, 0.6);
    this.padGraphics.lineBetween(-this.interactionRadius, 0, this.interactionRadius, 0);
    this.padGraphics.lineBetween(0, -this.interactionRadius, 0, this.interactionRadius);

    // 2. Rotating radar arc
    const angle = this.animTimer * 3;
    const arcLen = Math.PI / 2;
    this.padGraphics.lineStyle(3, 0xff007f, 0.9);
    this.padGraphics.beginPath();
    this.padGraphics.arc(0, 0, this.interactionRadius * 0.7, angle, angle + arcLen);
    this.padGraphics.strokePath();

    // 3. Pulsing drop ring
    const pulse = 0.8 + Math.sin(this.animTimer * 6) * 0.2;
    this.padGraphics.fillStyle(0xff007f, 0.15 * pulse);
    this.padGraphics.fillCircle(0, 0, this.interactionRadius * 0.55);

    this.padGraphics.lineStyle(2, 0xff007f, 0.8);
    this.padGraphics.strokeCircle(0, 0, this.interactionRadius * 0.55);

    // 4. Center beacon dot
    this.padGraphics.fillStyle(0x00f0ff, 1);
    this.padGraphics.fillCircle(0, 0, 4);
  }

  public override destroy(fromScene?: boolean): void {
    this.padGraphics.destroy();
    this.labelText.destroy();
    super.destroy(fromScene);
  }
}

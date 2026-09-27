import * as Phaser from 'phaser';
import { MovementInput } from '../entities/Player';

/**
 * InputManager decouples raw browser/keyboard polling from entity gameplay logic.
 * It polls WASD and Arrow Keys and produces a normalized direction vector.
 */
export class InputManager {
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  } | null = null;

  constructor(scene: Phaser.Scene) {
    if (scene.input.keyboard) {
      this.cursors = scene.input.keyboard.createCursorKeys();
      this.wasd = {
        W: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    }
  }

  /**
   * Polls currently depressed keys and returns horizontal and vertical input intents.
   */
  public getMovementInput(): MovementInput {
    let moveX = 0;
    let moveY = 0;

    if (!this.cursors || !this.wasd) {
      return { moveX: 0, moveY: 0 };
    }

    // Left
    if (this.cursors.left.isDown || this.wasd.A.isDown) {
      moveX -= 1;
    }
    // Right
    if (this.cursors.right.isDown || this.wasd.D.isDown) {
      moveX += 1;
    }
    // Up
    if (this.cursors.up.isDown || this.wasd.W.isDown) {
      moveY -= 1;
    }
    // Down
    if (this.cursors.down.isDown || this.wasd.S.isDown) {
      moveY += 1;
    }

    return { moveX, moveY };
  }
}

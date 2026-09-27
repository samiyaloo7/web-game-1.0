import * as Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';

/**
 * Factory function to construct Phaser GameConfig dynamically attached to a specific DOM container.
 * This guarantees that Phaser attaches cleanly to the React container ref without hardcoded DOM IDs.
 */
export function createGameConfig(parentContainer: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO, // Automatically chooses WebGL, falls back to Canvas 2D
    parent: parentContainer,
    width: 1280,
    height: 720,
    backgroundColor: '#0a0c14',
    scale: {
      mode: Phaser.Scale.FIT, // Scales proportionally to fit the parent container
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 }, // Top-down game: no vertical gravity
        debug: false,
      },
    },
    scene: [GameScene],
  };
}

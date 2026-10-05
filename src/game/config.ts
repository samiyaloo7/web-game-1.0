import * as Phaser from 'phaser';
import { GameScene, GameSceneOptions } from './scenes/GameScene';
import { GAME_HEIGHT, GAME_WIDTH } from './viewport';

/**
 * Factory function to construct Phaser GameConfig dynamically attached to a specific DOM container.
 * This guarantees that Phaser attaches cleanly to the React container ref without hardcoded DOM IDs.
 *
 * `options.seed` is the procedural city seed. Pass one to replay a known district,
 * or omit it and GameScene rolls a fresh city for the run.
 */
export function createGameConfig(
  parentContainer: HTMLElement,
  options: GameSceneOptions = {}
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO, // Automatically chooses WebGL, falls back to Canvas 2D
    parent: parentContainer,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0a0c14',
    // Sound is synthesised by the game's own Web Audio engine (`GameAudio`), so
    // Phaser's audio manager is switched off entirely: one AudioContext, one set
    // of autoplay rules to obey, and no idle sound plugin holding a device open.
    audio: {
      noAudio: true,
    },
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
    // A scene instance (not a class) so the seed reaches GameScene before it boots.
    scene: [new GameScene(options)],
  };
}

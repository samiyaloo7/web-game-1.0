import * as Phaser from 'phaser';

/**
 * EffectsDirector — particles, shockwaves, floating numbers and camera shake.
 *
 * ## Why emitters are pooled rather than created per event
 *
 * Spawning a `ParticleEmitter` for every pickup would allocate a pool of particles
 * each time and leave garbage for the GC whenever an effect ended mid-burst. Two
 * emitters are therefore built once at boot (`emitting` disabled, `frequency: -1`)
 * and every event just calls `explode()` on them — the same reasoning as the HUD's
 * render shielding in `ARCHITECTURE.md` §11: steady state, no per-event allocation.
 *
 * The same applies to the shockwave rings: a fixed pool of `Graphics` objects is
 * recycled round-robin, so a burst of deliveries cannot grow the display list.
 *
 * ## Ownership
 *
 * Everything here is created through the scene, so Phaser tears down whatever is
 * still alive on shutdown. `destroy()` exists to release the pooled objects *and*
 * their tweens eagerly when the district or the scene goes away.
 */
const TEXTURE_SPARK = 'fx-spark';
const TEXTURE_SHARD = 'fx-shard';

/** Particles sit above the courier and the drones, but below the banner (depth 30). */
const DEPTH_PARTICLES = 14;
const DEPTH_RING = 13;
const DEPTH_FLOAT_TEXT = 20;

/** How many shockwave rings exist at once; they are recycled, never allocated. */
const RING_POOL_SIZE = 4;

export class EffectsDirector {
  private readonly scene: Phaser.Scene;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly shards: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rings: Phaser.GameObjects.Graphics[] = [];
  private ringCursor = 0;
  private destroyed = false;

  /**
   * Generates the two procedural particle textures.
   *
   * Called from `GameScene.preload()`: particle textures must exist before an
   * emitter can be constructed, and `ensureTextures` is idempotent so a re-boot
   * into the same texture manager is harmless.
   */
  public static ensureTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists(TEXTURE_SPARK)) {
      // A plain white disc: tinting and additive blending do the colour work, and
      // a soft edge keeps bursts from looking like square confetti.
      const spark = scene.make.graphics({ x: 0, y: 0 });
      spark.fillStyle(0xffffff, 1);
      spark.fillCircle(5, 5, 5);
      spark.fillStyle(0xffffff, 0.45);
      spark.fillCircle(5, 5, 7);
      spark.generateTexture(TEXTURE_SPARK, 14, 14);
      spark.destroy();
    }

    if (!scene.textures.exists(TEXTURE_SHARD)) {
      const shard = scene.make.graphics({ x: 0, y: 0 });
      shard.fillStyle(0xffffff, 1);
      shard.beginPath();
      shard.moveTo(5, 0);
      shard.lineTo(10, 9);
      shard.lineTo(5, 18);
      shard.lineTo(0, 9);
      shard.closePath();
      shard.fillPath();
      shard.generateTexture(TEXTURE_SHARD, 10, 18);
      shard.destroy();
    }
  }

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    EffectsDirector.ensureTextures(scene);

    this.sparks = scene.add.particles(0, 0, TEXTURE_SPARK, {
      // Explode mode: no continuous flow, only explicit bursts below.
      frequency: -1,
      maxParticles: 400,
      maxAliveParticles: 220,
      lifespan: { min: 260, max: 640 },
      speed: { min: 40, max: 250 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.1, end: 0 },
      alpha: { start: 1, end: 0 },
      // Additive blending is what makes these read as light rather than as dots.
      blendMode: 'ADD',
      tint: [0x00f0ff, 0xffffff, 0xffaa00, 0xff007f, 0x39ff14],
      reserve: 220,
    });
    this.sparks.setDepth(DEPTH_PARTICLES);

    this.shards = scene.add.particles(0, 0, TEXTURE_SHARD, {
      frequency: -1,
      maxParticles: 160,
      maxAliveParticles: 90,
      lifespan: { min: 500, max: 1100 },
      speed: { min: 60, max: 320 },
      angle: { min: 0, max: 360 },
      gravityY: 520,
      rotate: { min: 0, max: 360 },
      scale: { start: 1, end: 0.3 },
      alpha: { start: 1, end: 0 },
      tint: [0xff007f, 0xffaa00, 0x00f0ff, 0x8b93a7],
      reserve: 90,
    });
    this.shards.setDepth(DEPTH_PARTICLES);

    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const ring = this.scene.add.graphics();
      ring.setDepth(DEPTH_RING);
      ring.setVisible(false);
      this.rings.push(ring);
    }
  }

  /** Camera shake, so every intensity the game uses is named in one place. */
  public shake(durationMs: number, intensity: number): void {
    if (this.destroyed) return;
    this.scene.cameras.main.shake(durationMs, intensity, true);
  }

  /** The crate comes off the ground: an amber spark puff and a soft ring. */
  public pickupBurst(x: number, y: number): void {
    if (this.destroyed) return;
    this.sparks.explode(16, x, y);
    this.ring(x, y, 0xffaa00, 36, 340);
  }

  /** Handover confirmed: the loudest celebration in the game. */
  public deliveryBurst(x: number, y: number): void {
    if (this.destroyed) return;
    this.sparks.explode(34, x, y);
    this.shards.explode(10, x, y);
    this.ring(x, y, 0x39ff14, 60, 520);
    this.ring(x, y, 0x00f0ff, 44, 430);
  }

  /** Hull hit: sparks thrown back off the courier. */
  public damageBurst(x: number, y: number): void {
    if (this.destroyed) return;
    this.sparks.explode(14, x, y);
    this.ring(x, y, 0xff007f, 30, 280);
  }

  /** Total loss — debris, a wide shockwave pair, and the caller's big shake. */
  public explosion(x: number, y: number): void {
    if (this.destroyed) return;
    this.sparks.explode(46, x, y);
    this.shards.explode(26, x, y);
    this.ring(x, y, 0xffaa00, 72, 620);
    this.ring(x, y, 0xff007f, 52, 470);
  }

  /**
   * Rising, fading label — used for payout callouts above the drop pad.
   *
   * One text object per call, destroyed by its own tween. The tween is owned by the
   * scene's tween manager, so a shutdown mid-flight reclaims both together.
   */
  public floatText(x: number, y: number, message: string, color: number): void {
    if (this.destroyed) return;

    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const text = this.scene.add
      .text(x, y, message, {
        fontFamily: 'monospace',
        fontSize: '16px',
        fontStyle: 'bold',
        color: hex,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_FLOAT_TEXT);

    text.setShadow(0, 0, hex, 8);

    this.scene.tweens.add({
      targets: text,
      y: y - 52,
      alpha: 0,
      duration: 950,
      ease: 'Cubic.Out',
      onComplete: () => text.destroy(),
    });
  }

  /**
   * Recycles one ring from the pool, faded and small, and grows it out.
   *
   * Round-robin rather than "find an idle one": under a burst of simultaneous
   * events the oldest ring is the one worth stealing, and the cursor makes that
   * O(1) instead of a scan.
   */
  private ring(x: number, y: number, color: number, radius: number, duration: number): void {
    const graphic = this.rings[this.ringCursor];
    if (!graphic) return;
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;

    // The previous tween may still be running on a stolen ring; kill it first so
    // two tweens never fight over the same scale/alpha.
    this.scene.tweens.killTweensOf(graphic);

    graphic.clear();
    graphic.setPosition(x, y);
    graphic.lineStyle(3, color, 0.95);
    graphic.strokeCircle(0, 0, radius);
    graphic.setVisible(true);
    graphic.setAlpha(0.95);
    graphic.setScale(0.3);

    this.scene.tweens.add({
      targets: graphic,
      scale: 1.7,
      alpha: 0,
      duration,
      ease: 'Cubic.Out',
      onComplete: () => graphic.setVisible(false),
    });
  }

  /**
   * Idempotent: the scene may call this on a district jump and again on shutdown.
   *
   * Each release is guarded because scene SHUTDOWN ordering is Phaser's own —
   * `DisplayList.shutdown()` runs before this handler and destroys every game
   * object in it. `GameObject.destroy()` is self-guarding for that reason, but the
   * tween manager may already be gone too, so nothing here is allowed to throw
   * during a teardown.
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const ring of this.rings) {
      try {
        this.scene.tweens.killTweensOf(ring);
        ring.destroy();
      } catch {
        // Already torn down with the scene.
      }
    }
    this.rings.length = 0;

    try {
      this.sparks.destroy();
      this.shards.destroy();
    } catch {
      // Already torn down with the scene.
    }
  }
}

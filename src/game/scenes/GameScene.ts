import * as Phaser from 'phaser';
import { Player } from '../entities/Player';
import { PackageDrop } from '../entities/PackageDrop';
import { DestinationPad } from '../entities/DestinationPad';
import { InputManager } from '../systems/InputManager';
import { DeliveryManager } from '../systems/DeliveryManager';
import { DroneDirector } from '../systems/DroneDirector';
import { PlayerVitals } from '../systems/PlayerVitals';
import { SecurityDrone } from '../entities/SecurityDrone';
import { ActiveMission } from '../types/delivery';
import type { CityMap } from '../types/city';
import type { DroneTuning } from '../types/enemy';
import { DEFAULT_DRONE_TUNING } from '../types/enemy';
import { EventBus } from '../EventBus';
import { GameAudio } from '../audio/GameAudio';
import { getBrowserStorage } from '../audio/AudioSettings';
import type { AudioSettings } from '../audio/AudioSettings';
import type { SfxName } from '../audio/GameAudio';
import { EffectsDirector } from '../systems/EffectsDirector';
import { CityRenderer } from '../renderers/CityRenderer';
import { createRunSeed, generateCity, validateCity } from '../systems/CityGenerator';
import { planDroneSpawns } from '../systems/DroneSpawner';
import { SeededRandom } from '../systems/SeededRandom';
import { PlayerProgression } from '../systems/PlayerProgression';
import { ChallengeTracker } from '../systems/ChallengeTracker';
import { DEFAULT_BASE_STATS } from '../types/progression';
import { computeTimeRatio } from '../../lib/scoring/delivery';
import type { ProgressionState } from '../types/progression';
import type { DailyChallenge } from '../types/challenge';
import {
  clampToSafeArea,
  computeOcclusionSignature,
  computeSafeArea,
  deflateRect,
  findOccludersFor,
  indicatorAngle,
  pointInRect,
} from '../systems/HudOcclusion';
import type { Occluder, Point, Rect } from '../systems/HudOcclusion';
import { GAME_HEIGHT, GAME_WIDTH } from '../viewport';

/** Options accepted by the scene instance built in `config.ts`. */
export interface GameSceneOptions {
  /** Seed for the procedural city. Omit it to roll a fresh city for every run. */
  seed?: number | string;
}

/**
 * Half-extent used to box a tracked entity for the HUD occlusion test, in world units.
 *
 * Deliberately generous: the parcel's beacon ring (radius 48) and the drop pad's
 * landing circle (radius 54) are both wider than the sprite at their centre, and
 * fading a panel a few pixels early is a much better failure than leaving a crate
 * hidden underneath one.
 */
const TRACKED_ENTITY_RADIUS = 44;

/**
 * How far inside the safe-area boundary the objective chevron is anchored.
 *
 * The chevron points *away* from the anchor, toward the objective, so anchoring it on
 * the boundary would bury its tip under the very panel it is pointing past. Pulling the
 * anchor back by the chevron's own reach (the 16px tip plus a 4px breathing gap) lands
 * the tip exactly on the boundary — the marker's whole body stays in clear air.
 */
const INDICATOR_REACH = 20;

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private inputManager!: InputManager;
  private deliveryManager!: DeliveryManager;
  private activePackageDrop: PackageDrop | null = null;
  private activeDestinationPad: DestinationPad | null = null;
  private guideArrow!: Phaser.GameObjects.Graphics;
  /**
   * Screen-space chevron marking where the current objective is when the HUD (or the
   * viewport edge) is hiding it. Pinned to the camera with `setScrollFactor(0)` so it
   * lives in viewport coordinates, unlike `guideArrow`, which orbits the courier out
   * in the world.
   */
  private hudIndicator!: Phaser.GameObjects.Graphics;
  private notificationBanner!: Phaser.GameObjects.Container;
  private bannerTitle!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private bannerBg!: Phaser.GameObjects.Graphics;
  private nextMissionCooldownTimer: number = 0;
  private isPaused: boolean = false;

  // Procedural city state. The generator produces plain data; CityRenderer draws it.
  private readonly initialSeed?: number | string;
  private cityMap!: CityMap;
  private cityRenderer!: CityRenderer;
  private cityCollider: Phaser.Physics.Arcade.Collider | null = null;
  /** Rebuilt alongside the squad so repeated district jumps do not stack overlaps. */
  private droneOverlap: Phaser.Physics.Arcade.Collider | null = null;
  private missionRng!: SeededRandom;

  /**
   * Career profile: money, XP, rank, upgrades. A pure system — the scene only mirrors
   * its snapshots to React and applies its derived stat block to the live run.
   */
  private progression!: PlayerProgression;

  /**
   * The day's challenge attempt. Another pure system: it owns the window, progress
   * and completion, and reports outward through its own callback. The scene feeds it
   * finished deliveries and per-frame delta — it never learns what a "player" is.
   */
  private challengeTracker!: ChallengeTracker;

  /**
   * Id of the challenge whose completion has already been announced.
   *
   * `challenge:completed` must fire exactly once per day: a second emission would
   * make React report (and pay) the reward twice. Seeded from the server's own
   * `completed` flag on load, so a resumed session does not re-announce.
   */
  private announcedChallengeId: string | null = null;

  // Combat. The vitals system owns the numbers; the director owns the drones.
  private vitals!: PlayerVitals;
  private droneDirector!: DroneDirector;
  private droneTuning: DroneTuning = DEFAULT_DRONE_TUNING;
  /** True once the hull is breached, until the player reboots or jumps districts. */
  private runOver: boolean = false;
  /** Seconds since the current run began, reported on the game-over screen. */
  private runElapsedSeconds: number = 0;
  /** Last vitals signature pushed to React, so unchanged frames emit nothing. */
  private lastVitalsSignature: string = '';

  /**
   * Sound engine for this boot.
   *
   * Constructed in `create()` and destroyed on SHUTDOWN: the scene is the only
   * thing that owns the AudioContext, so a teardown can never leave a context (or
   * a music timer) running behind an unmounted game.
   */
  private audio!: GameAudio;

  /**
   * Particles, shockwaves, floating payout text and camera shake — the visual
   * half of the same polish pass, pooled for the same reason.
   */
  private effects!: EffectsDirector;

  /** Pending "hide the banner" timer, cancelled whenever a newer banner replaces it. */
  private bannerHideTimer: Phaser.Time.TimerEvent | null = null;

  /**
   * Measured HUD panel rects, in game pixels, published by React over
   * `cmd:sync-hud-occluders` (see `useHudOcclusion`).
   *
   * The scene cannot measure these itself: panel sizes come from CSS text flow, and
   * `game/` deliberately owns no DOM. Empty means "nothing measured yet", which the
   * geometry correctly reads as "nothing is covering anything".
   */
  private hudOccluders: Occluder[] = [];
  /** Last occluded-panel set pushed to React, so unchanged frames emit nothing. */
  private lastOcclusionSignature: string = '';

  // Bound command handler references for clean removal
  private handleTogglePauseCommand = (): void => {
    this.togglePause();
  };

  private handleSetPauseCommand = (data: { paused: boolean }): void => {
    this.setPaused(data.paused);
  };

  private handleRestartMissionCommand = (): void => {
    this.restartCurrentMission();
  };

  private handleRegenerateCityCommand = (data: { seed?: number | string }): void => {
    this.regenerateCity(data.seed);
  };

  private handleRestartRunCommand = (): void => {
    this.restartRun();
  };

  /**
   * Hydrates the career from a persisted row.
   *
   * The payload arrives over the untrusted network, so it goes through
   * `PlayerProgression.hydrate` (which sanitises money, XP and upgrade levels)
   * instead of being written straight into the state. The derived stat block is
   * re-applied to the live run, so a returning courier's armour, speed, payout
   * and timer bonuses take effect immediately — but the current hull, city and
   * mission are untouched, because loading a career is not a new run.
   */
  private handleLoadProgressionCommand = (data: { state: ProgressionState }): void => {
    this.progression.hydrate(data.state);
    this.applyProgressionLoadout();
  };

  /**
   * Installs the day's challenge decided by the SERVER.
   *
   * The browser never computes "what day is it" for this; it relays the challenge
   * the route derived from its own clock (see `DAILY_CHALLENGES.md`). The tracker
   * resets only when the id actually changes, so a mid-day refetch is harmless.
   */
  private handleLoadDailyChallengeCommand = (data: {
    challenge: DailyChallenge | null;
    progress: { progress: number; completed: boolean; rewardGranted: boolean } | null;
  }): void => {
    this.challengeTracker.setChallenge(data.challenge);

    if (data.progress) {
      this.challengeTracker.hydrate(data.progress);
    }

    // A challenge the server already considers complete must not be announced
    // again, or its reward would be paid twice.
    this.announcedChallengeId = data.progress?.completed ? (data.challenge?.id ?? null) : null;
  };

  /**
   * Pays a confirmed challenge reward into the career.
   *
   * `recordDelivery` is the generic atomic credit+XP grant (one notify per call);
   * a challenge payout is the same transaction as a delivery payout, so it reuses
   * it rather than duplicating the wallet/rank arithmetic. Marking the reward
   * granted is what makes the HUD show "reward paid" and stops a re-announce.
   */
  private handleGrantChallengeRewardCommand = (data: {
    challengeId: string;
    credits: number;
    xp: number;
  }): void => {
    this.challengeTracker.markRewardGranted();
    this.progression.recordDelivery(data.credits, data.xp);
  };

  /**
   * Accepts freshly measured HUD panel rects from the DOM layer.
   *
   * Deliberately *not* sanitised beyond the geometry itself: these come from our own
   * HUD, and the worst a wrong rect can do is fade a panel or place a chevron
   * slightly oddly. Nothing here feeds gameplay state.
   *
   * The signature is reset so the next frame re-publishes even if the set of occluded
   * panels happens to be unchanged — panel rects moving while the *set* stays the same
   * still changes which panel is covering what, and React needs to see that.
   */
  private handleSyncHudOccludersCommand = (data: { occluders: Occluder[] }): void => {
    this.hudOccluders = data.occluders;
    this.lastOcclusionSignature = '';
  };

  /** Applies the HUD's volume/mute settings straight to the live gain nodes. */
  private handleSetAudioSettingsCommand = (data: AudioSettings): void => {
    this.audio.setSettings(data);
  };

  /**
   * A user gesture reached the game, so the AudioContext may attempt to start.
   *
   * The engine does the talking: it emits `audio:state-changed` only if the
   * browser actually allowed it, which is what drives the HUD's hint.
   */
  private handleUnlockAudioCommand = (): void => {
    this.audio.unlock();
  };

  /** One-shots triggered from React (interface ticks on HUD buttons). */
  private handlePlaySfxCommand = (data: { name: SfxName }): void => {
    this.audio.play(data.name);
  };

  constructor(options: GameSceneOptions = {}) {
    super({ key: 'GameScene' });
    this.initialSeed = options.seed;
  }

  preload(): void {
    this.createProgrammaticTextures();
    PackageDrop.ensureTexture(this);
  }

  create(): void {
    this.inputManager = new InputManager(this);

    // Scene-level services, built before any command can arrive: the audio engine
    // (one AudioContext, released on shutdown) and the pooled particle/shake
    // director. Both are owned by the scene, so nothing outlives it.
    this.audio = new GameAudio({
      storage: getBrowserStorage(),
      onStateChange: (state) => EventBus.emitEvent('audio:state-changed', state),
    });
    this.effects = new EffectsDirector(this);

    // The career profile lives outside the run: it survives restarts and district jumps,
    // and pushes its own snapshots outward through the injected callback (never through
    // a direct EventBus import, which would drag the engine into its unit tests).
    this.progression = new PlayerProgression({
      onChange: (snapshot) => EventBus.emitEvent('progression:updated', snapshot),
    });

    // The daily challenge runs on the same terms: game state with an injected
    // callback, so its rules stay testable without the EventBus.
    this.challengeTracker = new ChallengeTracker({
      onChange: (snapshot) => EventBus.emitEvent('challenge:progress', snapshot),
    });

    // Build the city first: it decides world bounds, the player spawn point and
    // the collision geometry the rest of the scene depends on.
    this.createCity(this.initialSeed ?? createRunSeed());

    this.deliveryManager = new DeliveryManager(
      (mission) => this.onMissionStateChanged(mission),
      this.cityMap.config.minMissionDistance
    );

    // Push the career stat block (speed, hull, payout, timer) into everything that runs
    // the district, before the first dispatch is generated below.
    this.applyProgressionLoadout();

    this.guideArrow = this.add.graphics();
    this.guideArrow.setDepth(5);

    // Objective marker for when the HUD (or the edge of the screen) is hiding the
    // parcel. Scroll factor 0 puts it in viewport space, where the safe-area geometry
    // is expressed; depth 6 keeps it above the guide arrow but below the banner.
    this.hudIndicator = this.add.graphics();
    this.hudIndicator.setDepth(6);
    this.hudIndicator.setScrollFactor(0);

    this.createNotificationBanner();

    // Register React UI command listeners
    EventBus.onCommand('cmd:toggle-pause', this.handleTogglePauseCommand);
    EventBus.onCommand('cmd:set-pause', this.handleSetPauseCommand);
    EventBus.onCommand('cmd:restart-mission', this.handleRestartMissionCommand);
    EventBus.onCommand('cmd:regenerate-city', this.handleRegenerateCityCommand);
    EventBus.onCommand('cmd:restart-run', this.handleRestartRunCommand);
    EventBus.onCommand('cmd:load-progression', this.handleLoadProgressionCommand);
    EventBus.onCommand('cmd:load-daily-challenge', this.handleLoadDailyChallengeCommand);
    EventBus.onCommand('cmd:grant-challenge-reward', this.handleGrantChallengeRewardCommand);
    EventBus.onCommand('cmd:sync-hud-occluders', this.handleSyncHudOccludersCommand);
    EventBus.onCommand('cmd:set-audio-settings', this.handleSetAudioSettingsCommand);
    EventBus.onCommand('cmd:unlock-audio', this.handleUnlockAudioCommand);
    EventBus.onCommand('cmd:play-sfx', this.handlePlaySfxCommand);

    // Clean up event listeners on scene shutdown
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Release the audio device and the pooled effects *before* announcing the
      // teardown: `GameAudio.destroy()` emits a final `audio:state-changed`, and
      // React's listener must still be alive to receive it.
      this.audio.destroy();
      this.effects.destroy();
      this.teardownCommandListeners();
      // Notify React that the simulation engine has torn down so the HUD
      // can reset its engine-ready flag instead of showing stale telemetry.
      EventBus.emitEvent('game:destroyed');
    });

    // Notify React that the engine and initial session stats are ready
    EventBus.emitEvent('game:ready');
    this.deliveryManager.emitStatsUpdate();
    // Seed the HUD with the starting profile before the first delivery pays out.
    EventBus.emitEvent('progression:updated', this.progression.getSnapshot());
    // ...and with the neutral challenge state, so the panel renders before the
    // server has answered with today's objective.
    EventBus.emitEvent('challenge:progress', this.challengeTracker.getSnapshot());

    // Start first delivery
    this.startNewDeliveryRun();

    // Hull and security droids come up last, so both can see the finished city.
    this.beginRun();
  }

  /**
   * Generates a city from `seed`, renders it, and re-parents the player and camera
   * onto the new map. Called on boot and whenever a fresh district is requested.
   */
  private createCity(seed: number | string): void {
    this.cityMap = generateCity({ seed });
    this.cityRenderer = new CityRenderer(this, this.cityMap);
    this.cityRenderer.render();

    const { width, height, spawn } = this.cityMap;

    // World and camera are driven by the generated map, so map size stays configurable.
    this.physics.world.setBounds(0, 0, width, height);
    this.cameras.main.setBounds(0, 0, width, height);

    if (this.player) {
      (this.player.body as Phaser.Physics.Arcade.Body).reset(spawn.x, spawn.y);
      this.player.setPosition(spawn.x, spawn.y);
    } else {
      this.player = new Player(this, spawn.x, spawn.y, {
        speed: DEFAULT_BASE_STATS.speed,
        acceleration: 1500,
        drag: 0.88,
      });
      this.player.setDepth(10);
    }

    // The city is larger than one screen, so the camera trails the courier.
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    // One collider covers every building and obstacle in the city.
    if (this.cityCollider) {
      this.cityCollider.destroy();
    }
    this.cityCollider = this.physics.add.collider(this.player, this.cityRenderer.getCollisionBodies());

    // Derive mission randomness from the city seed so a seed replays the whole run.
    this.missionRng = new SeededRandom(seed).fork('missions');

    // Never ship a city that could make a delivery impossible.
    const validation = validateCity(this.cityMap);
    if (!validation.valid) {
      console.warn('[CityGenerator] generated city failed validation:', validation.issues);
    }

    this.emitCityState();
    this.spawnDrones();
  }

  /**
   * Deploys the district's security squad from a deterministic plan.
   *
   * The plan is seeded off the city seed, so regenerating a district always replays the
   * same patrols — a shared seed reproduces the whole run, drones included.
   */
  private spawnDrones(): void {
    if (this.droneDirector) {
      this.droneDirector.destroy();
    }

    this.droneDirector = new DroneDirector(this, this.droneTuning);

    const droneRng = new SeededRandom(this.cityMap.seed).fork('drones');
    const plans = planDroneSpawns(this.cityMap, droneRng);

    this.droneDirector.spawnFromPlans(plans);

    // One overlap covers the whole squad. Contact is damage, not a solid collision, so a
    // drone can never shove the courier into a building and trap them.
    if (this.droneOverlap) {
      this.droneOverlap.destroy();
    }
    this.droneOverlap = this.physics.add.overlap(
      this.player,
      this.droneDirector.getGroup(),
      this.handleDroneContact,
      undefined,
      this
    );
  }

  /**
   * Arcade overlap callback, typed by Phaser's own `ArcadePhysicsCallback` so the editor
   * stays honest about what it may receive (a Tile is possible in principle).
   *
   * Contact is damage, not a solid collision, so a drone can never shove the courier into
   * a building and pin them there.
   */
  private handleDroneContact: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    _player,
    other
  ) => {
    if (this.runOver || !this.vitals) return;

    if (other instanceof SecurityDrone && !other.canDealContactDamage()) return;

    const result = this.vitals.applyDamage(this.droneTuning.contactDamage);
    if (!result.applied) return;

    if (other instanceof SecurityDrone) {
      other.registerContactDamage();
    }

    this.effects.shake(140, 0.006);
    this.effects.damageBurst(this.player.x, this.player.y);
    this.audio.play('damage');
    this.emitVitals();

    if (result.isDead) {
      this.endRun();
    }
  };

  /** Generates a brand-new district from the given (or a freshly rolled) seed. */
  public regenerateCity(seed?: number | string): void {
    this.clearMissionEntities();
    this.nextMissionCooldownTimer = 0;

    if (this.cityRenderer) {
      this.cityRenderer.destroy();
    }

    this.createCity(seed ?? createRunSeed());
    this.startNewDeliveryRun();

    // A new district is a clean slate: full hull, live run, droids already re-spawned by
    // `createCity -> spawnDrones`. Without this the game-over screen would persist over a
    // freshly generated map.
    this.beginRun();

    this.showBanner(
      'SECTOR RESEEDED',
      `New district grid generated from seed ${this.cityMap.seedLabel}`,
      0x00c8ff
    );
    this.scheduleBannerHide(2500);
  }

  private emitCityState(): void {
    EventBus.emitEvent('city:generated', {
      seed: this.cityMap.seed,
      seedLabel: this.cityMap.seedLabel,
      cols: this.cityMap.config.cols,
      rows: this.cityMap.config.rows,
      width: this.cityMap.width,
      height: this.cityMap.height,
      locationCount: this.cityMap.locations.length,
      buildingCount: this.cityMap.buildings.length,
      obstacleCount: this.cityMap.obstacles.length,
    });
  }

  private teardownCommandListeners(): void {
    EventBus.offCommand('cmd:toggle-pause', this.handleTogglePauseCommand);
    EventBus.offCommand('cmd:set-pause', this.handleSetPauseCommand);
    EventBus.offCommand('cmd:restart-mission', this.handleRestartMissionCommand);
    EventBus.offCommand('cmd:regenerate-city', this.handleRegenerateCityCommand);
    EventBus.offCommand('cmd:restart-run', this.handleRestartRunCommand);
    EventBus.offCommand('cmd:load-progression', this.handleLoadProgressionCommand);
    EventBus.offCommand('cmd:load-daily-challenge', this.handleLoadDailyChallengeCommand);
    EventBus.offCommand('cmd:grant-challenge-reward', this.handleGrantChallengeRewardCommand);
    EventBus.offCommand('cmd:sync-hud-occluders', this.handleSyncHudOccludersCommand);
    EventBus.offCommand('cmd:set-audio-settings', this.handleSetAudioSettingsCommand);
    EventBus.offCommand('cmd:unlock-audio', this.handleUnlockAudioCommand);
    EventBus.offCommand('cmd:play-sfx', this.handlePlaySfxCommand);
  }

  public togglePause(): void {
    this.setPaused(!this.isPaused);
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (this.isPaused) {
      this.physics.pause();
    } else {
      this.physics.resume();
    }

    // The score ducks while the simulation is suspended; see `GameAudio.setPaused`
    // for why it is a duck and not a context suspend.
    this.audio.setPaused(this.isPaused);

    // Emit event to React to keep UI pause button & overlay in sync
    EventBus.emitEvent('game:paused-changed', { isPaused: this.isPaused });
  }

  public restartCurrentMission(): void {
    this.startNewDeliveryRun();
  }

  /**
   * Arms a fresh run: full hull, live clock, and one HUD sync.
   *
   * Shared by boot, `restartRun` and `regenerateCity` so there is exactly one definition
   * of "the run is on", and no path through the scene can leave the game-over screen up
   * over a healthy courier.
   */
  private beginRun(): void {
    // Hull size and frame speed are re-read from progression on every run, so an armour
    // or engine purchase made between runs is live the moment the courier launches again.
    this.vitals = new PlayerVitals({
      maxHealth: this.progression.getEffectiveStats().maxHealth,
    });
    this.applyProgressionLoadout();

    this.runOver = false;
    this.runElapsedSeconds = 0;
    this.lastVitalsSignature = '';

    // A new run is a new timed attempt: the previous window (if any) is discarded
    // so the courier is never punished for dying mid-attempt. A completed
    // challenge stays completed — the tracker ignores this call.
    this.challengeTracker.beginAttempt();

    this.emitVitals();
    EventBus.emitEvent('game:run-state-changed', {
      status: 'active',
      reason: null,
      survivedSeconds: 0,
    });
  }

  /**
   * Wrecks the courier: freezes the sim in place and raises the game-over screen.
   *
   * Movement is zeroed here rather than by pausing physics, so a second attempt to pause
   * (the P key) still behaves normally while the overlay is up.
   */
  private endRun(): void {
    if (this.runOver) return;
    this.runOver = true;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setAcceleration(0, 0);
    body.setVelocity(0, 0);
    this.player.setAlpha(1);

    // The wreck is the loudest thing in the game: debris, a wide double ring and
    // the heaviest shake, with the descending sting a beat behind the blast.
    this.effects.explosion(this.player.x, this.player.y);
    this.effects.shake(480, 0.018);
    this.audio.play('explode');
    this.time.delayedCall(340, () => this.audio.play('gameOver'));

    EventBus.emitEvent('game:run-state-changed', {
      status: 'over',
      reason: 'destroyed',
      survivedSeconds: Math.round(this.runElapsedSeconds),
    });
  }

  /**
   * Retry after a wreck: same district, same squad, new hull.
   *
   * Deliberately *not* a full regeneration — retrying should be comparable, so the city,
   * the mission pool and the drone patrol plan are all left alone.
   */
  public restartRun(): void {
    const spawn = this.cityMap.spawn;
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    body.reset(spawn.x, spawn.y);
    body.setVelocity(0, 0);
    body.setAcceleration(0, 0);
    this.player.setPosition(spawn.x, spawn.y);
    this.player.setRotation(0);
    this.player.setAlpha(1);

    this.beginRun();
    this.droneDirector.resetAll();
    this.startNewDeliveryRun();

    this.showBanner(
      'SYSTEMS REBOOT',
      'Hull integrity restored. Security droids recalled to patrol.',
      0x00f0ff
    );
    this.scheduleBannerHide(2000);
  }

  /**
   * Applies the derived stat block to the live simulation: top speed onto the bike,
   * payout multiplier and timer bonus onto dispatch. Idempotent, so boot, every new
   * run and any future garage purchase may call it freely.
   */
  private applyProgressionLoadout(): void {
    const stats = this.progression.getEffectiveStats();

    this.player.setSpeed(stats.speed);
    this.deliveryManager.applyProgressionTuning({
      rewardMultiplier: stats.rewardMultiplier,
      timerBonusSeconds: stats.timerBonusSeconds,
    });
  }

  /**
   * Pushes hull state to React — but only when it actually changed.
   *
   * The signature check is the shield against per-frame renders described in
   * `ARCHITECTURE.md` §11: an untouched hull emits nothing, and the invulnerability
   * blink is driven from Phaser instead of React.
   */
  private emitVitals(): void {
    const state = this.vitals.getState();
    const signature = `${state.health}|${state.maxHealth}|${state.invulnerable}|${state.isDead}`;

    if (signature === this.lastVitalsSignature) return;
    this.lastVitalsSignature = signature;

    EventBus.emitEvent('player:health-changed', {
      health: state.health,
      maxHealth: state.maxHealth,
      invulnerable: state.invulnerable,
      isDead: state.isDead,
    });
  }

  override update(_time: number, delta: number): void {
    if (this.isPaused) return;

    const deltaSeconds = delta / 1000;

    // A wrecked run freezes in place behind the overlay: no input, no drone AI, no
    // delivery countdown. `endRun` already zeroed the movement, so nothing drifts.
    if (this.runOver) return;

    this.runElapsedSeconds += deltaSeconds;
    this.vitals.update(deltaSeconds);
    // The challenge window only advances while the sim is live — pausing (which
    // stops `update` entirely) pauses the attempt, which is what a pause is for.
    this.challengeTracker.update(deltaSeconds);

    const input = this.inputManager.getMovementInput();
    this.player.updatePlayer(delta, input);

    // i-frames are visualised as a hull blink by Phaser itself rather than by React, so
    // the per-frame invulnerability timer never reaches the UI layer.
    this.player.setAlpha(
      this.vitals.isInvulnerable ? (Math.sin(this.time.now / 45) > 0 ? 1 : 0.35) : 1
    );

    this.droneDirector.update(deltaSeconds, { x: this.player.x, y: this.player.y });
    this.emitVitals();

    this.deliveryManager.updateTimer(deltaSeconds);
    const mission = this.deliveryManager.getCurrentMission();

    if (this.activePackageDrop) {
      this.activePackageDrop.updateAnimation(deltaSeconds);
    }
    if (this.activeDestinationPad) {
      this.activeDestinationPad.updateAnimation(deltaSeconds);
    }

    if (mission) {
      this.checkInteractions(mission);
      this.updateGuideArrow(mission);
    }

    // Runs even with no mission, so a finished assignment clears its marker.
    this.updateHudOcclusion(mission);

    if (
      mission &&
      (mission.status === 'success' || mission.status === 'failed') &&
      this.nextMissionCooldownTimer > 0
    ) {
      this.nextMissionCooldownTimer -= deltaSeconds;
      if (this.nextMissionCooldownTimer <= 0) {
        this.hideBanner();
        this.startNewDeliveryRun();
      }
    }
  }

  private startNewDeliveryRun(): void {
    this.clearMissionEntities();

    // Locations come from the generated city, randomness from the run's seeded stream.
    const mission = this.deliveryManager.generateNewMission(
      this.cityMap.locations,
      this.missionRng
    );

    if (!mission) {
      this.showBanner(
        'NO DISPATCH AVAILABLE',
        'This district has no reachable delivery nodes.',
        0xff007f
      );
      this.scheduleBannerHide(2500);
      return;
    }

    this.activePackageDrop = new PackageDrop(
      this,
      mission.pickupLocation.x,
      mission.pickupLocation.y,
      mission.packageDef.name
    );
    this.activePackageDrop.setDepth(2);

    this.showBanner(
      'NEW DISPATCH AVAILABLE',
      `Locate and pick up ${mission.packageDef.name} at ${mission.pickupLocation.zone}`,
      0x00f0ff
    );

    this.scheduleBannerHide(2500);
  }

  private checkInteractions(mission: ActiveMission): void {
    const playerSnapshot = this.player.getState();

    if (mission.status === 'pickup_available' && this.activePackageDrop) {
      const dist = Phaser.Math.Distance.Between(
        playerSnapshot.x,
        playerSnapshot.y,
        this.activePackageDrop.x,
        this.activePackageDrop.y
      );

      if (dist <= this.activePackageDrop.interactionRadius) {
        this.onPackagePickedUp(mission);
      }
    } else if (mission.status === 'in_transit' && this.activeDestinationPad) {
      const dist = Phaser.Math.Distance.Between(
        playerSnapshot.x,
        playerSnapshot.y,
        this.activeDestinationPad.x,
        this.activeDestinationPad.y
      );

      if (dist <= this.activeDestinationPad.interactionRadius) {
        this.onPackageDelivered();
      }
    }
  }

  private onPackagePickedUp(mission: ActiveMission): void {
    // Captured before the crate is destroyed, so the burst lands where it was
    // rather than wherever the courier has drifted to by the time it plays.
    const crateX = this.activePackageDrop?.x ?? this.player.x;
    const crateY = this.activePackageDrop?.y ?? this.player.y;

    this.deliveryManager.pickupPackage();

    if (this.activePackageDrop) {
      this.activePackageDrop.destroy();
      this.activePackageDrop = null;
    }

    this.activeDestinationPad = new DestinationPad(
      this,
      mission.dropoffLocation.x,
      mission.dropoffLocation.y,
      mission.dropoffLocation.name
    );
    this.activeDestinationPad.setDepth(2);

    this.cameras.main.flash(200, 0, 240, 255, true);
    this.effects.pickupBurst(crateX, crateY);
    this.audio.play('pickup');

    this.showBanner(
      'CARGO SECURED - EN ROUTE',
      `Deliver to ${mission.dropoffLocation.name} (${mission.dropoffLocation.zone}) before timer expires!`,
      0xffaa00
    );

    this.scheduleBannerHide(2000);
  }

  private onPackageDelivered(): void {
    // Captured before the pad is destroyed — the celebration belongs where the
    // handover actually happened.
    const padX = this.activeDestinationPad?.x ?? this.player.x;
    const padY = this.activeDestinationPad?.y ?? this.player.y;

    this.deliveryManager.completeDelivery();
    const mission = this.deliveryManager.getCurrentMission();

    if (this.activeDestinationPad) {
      this.activeDestinationPad.destroy();
      this.activeDestinationPad = null;
    }

    this.cameras.main.flash(300, 57, 255, 20, true);
    this.effects.deliveryBurst(padX, padY);
    this.effects.shake(160, 0.005);
    this.audio.play('deliver');

    const credits = mission?.rewards?.credits ?? 0;
    const bonus = mission?.rewards?.timeBonus ?? 0;
    const xp = mission?.rewards?.xp ?? 0;

    // Pay the career profile (wallet + rank). Progression emits its own
    // `progression:updated` snapshot, so the HUD updates without any extra wiring here.
    const levelUp = this.progression.recordDelivery(credits, xp);
    const rankNote = levelUp.levelsGained > 0 ? ` // RANK ${levelUp.newLevel} REACHED!` : '';

    // Payout floats up off the pad, and a rank-up adds its own sting behind the
    // delivery fanfare rather than on top of it.
    this.effects.floatText(padX, padY - 30, `+¢${credits}`, 0x39ff14);
    if (levelUp.levelsGained > 0) {
      this.time.delayedCall(420, () => this.audio.play('rankUp'));
    }

    this.showBanner(
      'DELIVERY COMPLETE!',
      `Earned ¢${credits} (+¢${bonus} speed bonus) and +${xp} XP. Next assignment arriving...${rankNote}`,
      0x39ff14
    );

    this.nextMissionCooldownTimer = 3.5;

    // Feed the daily challenge. `->` the tracker decides whether this run counts
    // (metric match, window still open, challenge not already complete) and emits
    // `challenge:progress` through its own callback.
    if (mission) {
      const timeRatio = computeTimeRatio(mission.remainingTimeSeconds, mission.timeLimitSeconds);

      this.challengeTracker.recordDelivery({ credits, xp, timeRatio });
      const challenge = this.challengeTracker.getSnapshot();

      // Announce completion exactly once. React owns the network call and the
      // reward grant (useDailyChallenge → POST /api/challenges), so Phaser never
      // imports Supabase or `fetch` — the same split as `delivery:recorded`.
      if (
        challenge.completed &&
        challenge.challengeId !== null &&
        challenge.challengeId !== this.announcedChallengeId
      ) {
        this.announcedChallengeId = challenge.challengeId;
        EventBus.emitEvent('challenge:completed', {
          challengeId: challenge.challengeId,
          dayIndex: challenge.dayIndex ?? 0,
          progress: challenge.progress,
          target: challenge.target,
          rewardCredits: challenge.rewardCredits,
          rewardXp: challenge.rewardXp,
        });

        // A completed daily objective is rare, so it earns its own celebration:
        // a burst on the courier and the long ascending run, a beat after the
        // delivery fanfare has had room to land.
        this.effects.deliveryBurst(this.player.x, this.player.y);
        this.time.delayedCall(650, () => this.audio.play('missionComplete'));
      }
    }

    // Publish the run for the leaderboard. Note what is sent: a package id and a
    // time ratio, NOT the payout. The server prices the delivery from its own
    // catalog, so the browser describes the run but cannot assert what it earned.
    // React owns the network call (useScoreReporting → POST /api/scores), so
    // Phaser never imports Supabase or `fetch`.
    if (mission) {
      EventBus.emitEvent('delivery:recorded', {
        status: 'completed',
        packageId: mission.packageDef.id,
        timeRatio: computeTimeRatio(
          mission.remainingTimeSeconds,
          mission.timeLimitSeconds
        ),
        durationSeconds: mission.timeLimitSeconds - mission.remainingTimeSeconds,
        claimedCredits: credits,
      });
    }
  }

  private onMissionStateChanged(mission: ActiveMission): void {
    if (mission.status === 'failed') {
      this.clearMissionEntities();
      this.effects.shake(300, 0.01);
      this.audio.play('missionFailed');

      this.showBanner(
        'MISSION FAILED // TIMEOUT',
        'Cargo contract voided. Standby for next dispatch assignment...',
        0xff007f
      );

      this.nextMissionCooldownTimer = 3.5;

      // A failed delivery still belongs in the record. It awards nothing (the
      // `scores_paid_when_completed` CHECK enforces credits = xp = 0), but the
      // board's delivery count and the dossier's success rate both need it.
      EventBus.emitEvent('delivery:recorded', {
        status: 'failed',
        packageId: mission.packageDef.id,
        timeRatio: 0,
        durationSeconds: mission.timeLimitSeconds,
        claimedCredits: 0,
      });
    }
  }

  private updateGuideArrow(mission: ActiveMission): void {
    this.guideArrow.clear();

    let targetX = 0;
    let targetY = 0;
    let arrowColor = 0x00f0ff;

    if (mission.status === 'pickup_available' && this.activePackageDrop) {
      targetX = this.activePackageDrop.x;
      targetY = this.activePackageDrop.y;
      arrowColor = 0xffaa00;
    } else if (mission.status === 'in_transit' && this.activeDestinationPad) {
      targetX = this.activeDestinationPad.x;
      targetY = this.activeDestinationPad.y;
      arrowColor = 0xff007f;
    } else {
      return;
    }

    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, targetX, targetY);
    const orbitDistance = 46;

    const arrowX = this.player.x + Math.cos(angle) * orbitDistance;
    const arrowY = this.player.y + Math.sin(angle) * orbitDistance;

    this.guideArrow.fillStyle(arrowColor, 0.9);
    this.guideArrow.beginPath();
    this.guideArrow.moveTo(arrowX + Math.cos(angle) * 12, arrowY + Math.sin(angle) * 12);
    this.guideArrow.lineTo(
      arrowX + Math.cos(angle + 2.4) * 8,
      arrowY + Math.sin(angle + 2.4) * 8
    );
    this.guideArrow.lineTo(
      arrowX + Math.cos(angle - 2.4) * 8,
      arrowY + Math.sin(angle - 2.4) * 8
    );
    this.guideArrow.closePath();
    this.guideArrow.fillPath();
  }

  /**
   * Converts a world position into viewport ("screen") coordinates, in game pixels
   * measured from the canvas's top-left — the same space the HUD's measured rects
   * arrive in.
   *
   * `worldView` already folds in the camera scroll, and it accounts for the camera
   * being *clamped* at the map edges, which is exactly the case that puts the parcel
   * under the top-left HUD: the world stops scrolling, the courier keeps moving, and
   * the two drift into the same screen region. Deriving the offset from the camera
   * rather than from the courier's position keeps this correct there.
   *
   * The `zoom` multiply matters even though nothing zooms today: `worldView` shrinks
   * as zoom rises, so without it the two coordinate systems would silently diverge
   * the moment a zoom effect was added.
   */
  private worldToScreenPoint(worldX: number, worldY: number): Point {
    const camera = this.cameras.main;

    return {
      x: (worldX - camera.worldView.x) * camera.zoom,
      y: (worldY - camera.worldView.y) * camera.zoom,
    };
  }

  /** Viewport-space bounding box of a world-space entity with the given radius. */
  private worldToScreenRect(worldX: number, worldY: number, worldRadius: number): Rect {
    const centre = this.worldToScreenPoint(worldX, worldY);
    const radius = worldRadius * this.cameras.main.zoom;

    return {
      x: centre.x - radius,
      y: centre.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
  }

  /**
   * World position and marker colour of whatever the courier is currently being asked
   * to reach, or `null` when there is nothing to mark.
   *
   * Colours deliberately match the entities themselves (amber beacon for the crate,
   * pink pad for the dropoff), so the marker reads as "the thing you can see" rather
   * than as a third, unrelated icon.
   */
  private getObjectiveMarker(
    mission: ActiveMission | null
  ): { point: Point; color: number } | null {
    if (mission?.status === 'pickup_available' && this.activePackageDrop) {
      return {
        point: { x: this.activePackageDrop.x, y: this.activePackageDrop.y },
        color: 0xffaa00,
      };
    }

    if (mission?.status === 'in_transit' && this.activeDestinationPad) {
      return {
        point: { x: this.activeDestinationPad.x, y: this.activeDestinationPad.y },
        color: 0xff007f,
      };
    }

    return null;
  }

  /**
   * Decides which HUD panels are covering something that matters, tells React, and
   * pins a chevron to the safe-area edge when the objective is hidden.
   *
   * Two mechanisms, both from the pure `HudOcclusion` geometry:
   *
   * 1. **Fade** — React drops the opacity of every panel id returned here. The panel
   *    keeps its timer and controls, it just stops being an opaque lid over the map.
   * 2. **Indicator** — once the objective leaves the safe area (a panel is over it, or
   *    it is simply off-screen), a chevron appears on the boundary pointing at it, so
   *    the crate is findable without hunting underneath the HUD.
   *
   * Tracking the courier as well as the objective is deliberate: the camera clamps at
   * the map edges, so the player's own bike can slide under the top bar even when the
   * objective cannot.
   *
   * The emit is signature-gated, per `ARCHITECTURE.md` §11 — a courier idling under a
   * panel edge produces one event, not one per frame.
   */
  private updateHudOcclusion(mission: ActiveMission | null): void {
    this.hudIndicator.clear();

    const tracked: Rect[] = [
      this.worldToScreenRect(this.player.x, this.player.y, TRACKED_ENTITY_RADIUS),
    ];
    const marker = this.getObjectiveMarker(mission);

    if (marker) {
      tracked.push(this.worldToScreenRect(marker.point.x, marker.point.y, TRACKED_ENTITY_RADIUS));
    }

    // A small array scanned linearly: there are at most four panels, so this beats
    // allocating a `Set` on every frame of the simulation loop.
    const occludedIds: string[] = [];
    for (const rect of tracked) {
      for (const id of findOccludersFor(rect, this.hudOccluders)) {
        if (!occludedIds.includes(id)) occludedIds.push(id);
      }
    }

    // Sorted, so the payload is deterministic for a given set regardless of the order
    // the panels happened to be discovered in.
    occludedIds.sort();
    const signature = computeOcclusionSignature(occludedIds);

    if (signature !== this.lastOcclusionSignature) {
      this.lastOcclusionSignature = signature;
      EventBus.emitEvent('hud:occlusion-changed', { occludedPanelIds: occludedIds });
    }

    if (marker) this.drawObjectiveIndicator(marker);
  }

  /**
   * Pins a chevron to the nearest safe-area edge in the direction of the objective.
   *
   * Distinct from `updateGuideArrow`, and both are needed. That one orbits the courier
   * to answer "which way do I drive?" — useless when the crate is already on screen but
   * behind a panel, because the answer is "it is right there", not a bearing. This one
   * answers "where is the thing I cannot see?", which is the actual failure mode: the
   * objective sitting in the top-left under the mission panel.
   *
   * Nothing is drawn while the objective is inside the safe area, since by then it is
   * unobstructed and a marker would be pure noise.
   */
  private drawObjectiveIndicator(marker: { point: Point; color: number }): void {
    // The viewport the occluders were measured against — the canvas's own game space,
    // not the CSS pixel space the page sees.
    const viewport: Rect = { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT };
    const safeArea = computeSafeArea(viewport, this.hudOccluders);
    const target = this.worldToScreenPoint(marker.point.x, marker.point.y);

    if (pointInRect(target, safeArea)) return;

    // Clamp against the boundary pulled in by the chevron's own reach, so the whole
    // marker — tip included — lands in clear air instead of under the panel edge.
    const anchor = clampToSafeArea(target, deflateRect(safeArea, INDICATOR_REACH));
    this.drawChevron(anchor, indicatorAngle(anchor, target), marker.color);
  }

  /**
   * Draws a chevron at `anchor` pointing along `angle`.
   *
   * Same silhouette as the guide arrow, so the two read as one visual vocabulary — but
   * drawn in viewport space, against the safe-area border, rather than out in the city.
   * The dark stroke is what keeps it legible over both the pale road grid and the
   * near-black district floor.
   */
  private drawChevron(anchor: Point, angle: number, color: number): void {
    const tip = 16;
    const shoulder = 10;

    this.hudIndicator.fillStyle(color, 0.95);
    this.hudIndicator.beginPath();
    this.hudIndicator.moveTo(anchor.x + Math.cos(angle) * tip, anchor.y + Math.sin(angle) * tip);
    this.hudIndicator.lineTo(
      anchor.x + Math.cos(angle + 2.4) * shoulder,
      anchor.y + Math.sin(angle + 2.4) * shoulder
    );
    this.hudIndicator.lineTo(
      anchor.x + Math.cos(angle - 2.4) * shoulder,
      anchor.y + Math.sin(angle - 2.4) * shoulder
    );
    this.hudIndicator.closePath();
    this.hudIndicator.fillPath();
    this.hudIndicator.lineStyle(2, 0x08090d, 0.85);
    this.hudIndicator.strokePath();
  }

  private clearMissionEntities(): void {
    if (this.activePackageDrop) {
      this.activePackageDrop.destroy();
      this.activePackageDrop = null;
    }
    if (this.activeDestinationPad) {
      this.activeDestinationPad.destroy();
      this.activeDestinationPad = null;
    }
    this.guideArrow.clear();
  }

  private createNotificationBanner(): void {
    // Pinned to the camera (`setScrollFactor(0)`) and positioned in viewport space,
    // because the city is now larger than the screen.
    this.notificationBanner = this.add.container(
      this.scale.width / 2,
      this.scale.height / 2 - 120
    );
    this.notificationBanner.setDepth(30);
    this.notificationBanner.setScrollFactor(0);
    this.notificationBanner.setVisible(false);

    this.bannerBg = this.add.graphics();
    this.bannerBg.setScrollFactor(0);
    this.notificationBanner.add(this.bannerBg);

    this.bannerTitle = this.add.text(0, -14, '', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    this.bannerTitle.setOrigin(0.5, 0.5);
    this.bannerTitle.setScrollFactor(0);
    this.notificationBanner.add(this.bannerTitle);

    this.bannerSub = this.add.text(0, 14, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#cbd5e1',
    });
    this.bannerSub.setOrigin(0.5, 0.5);
    this.bannerSub.setScrollFactor(0);
    this.notificationBanner.add(this.bannerSub);
  }

  private showBanner(title: string, sub: string, accentColor: number): void {
    this.bannerTitle.setText(title);
    this.bannerSub.setText(sub);

    this.bannerBg.clear();
    this.bannerBg.fillStyle(0x08090d, 0.92);
    this.bannerBg.lineStyle(2, accentColor, 0.9);
    this.bannerBg.fillRoundedRect(-320, -36, 640, 72, 8);
    this.bannerBg.strokeRoundedRect(-320, -36, 640, 72, 8);

    // A newer banner supersedes the old one's fade-out *and* its hide timer:
    // without this, a delayed hide scheduled for the previous banner would blink
    // the new one away mid-read.
    this.tweens.killTweensOf(this.notificationBanner);
    this.cancelBannerHide();

    this.notificationBanner.setVisible(true);
    // Pop in from 94% with a slight overshoot, so every announcement lands as an
    // event rather than as text that was always there.
    this.notificationBanner.setAlpha(0);
    this.notificationBanner.setScale(0.94);
    this.tweens.add({
      targets: this.notificationBanner,
      alpha: 1,
      scale: 1,
      duration: 260,
      ease: 'Back.Out',
    });
  }

  private hideBanner(): void {
    this.cancelBannerHide();
    if (!this.notificationBanner.visible) return;

    // Kill the pop-in tween first, so the fade does not fight it for `alpha`.
    this.tweens.killTweensOf(this.notificationBanner);
    this.tweens.add({
      targets: this.notificationBanner,
      alpha: 0,
      duration: 180,
      ease: 'Cubic.In',
      onComplete: () => this.notificationBanner.setVisible(false),
    });
  }

  /**
   * Hides the current banner after `delayMs` — unless a newer banner replaces it
   * first, in which case the pending hide is cancelled and the newer message gets
   * its full reading time.
   */
  private scheduleBannerHide(delayMs: number): void {
    this.cancelBannerHide();
    this.bannerHideTimer = this.time.delayedCall(delayMs, () => {
      this.bannerHideTimer = null;
      this.hideBanner();
    });
  }

  private cancelBannerHide(): void {
    if (this.bannerHideTimer) {
      // `false` = do not dispatch: the timer is being replaced, not fulfilled.
      this.bannerHideTimer.remove(false);
      this.bannerHideTimer = null;
    }
  }

  private createProgrammaticTextures(): void {
    if (!this.textures.exists('player-courier')) {
      const graphics = this.make.graphics({ x: 0, y: 0 });

      graphics.fillStyle(0x00f0ff, 1);
      graphics.beginPath();
      graphics.moveTo(16, 2);
      graphics.lineTo(30, 36);
      graphics.lineTo(16, 28);
      graphics.lineTo(2, 36);
      graphics.closePath();
      graphics.fillPath();

      graphics.lineStyle(1.5, 0xffffff, 0.9);
      graphics.strokePath();

      graphics.fillStyle(0xff007f, 1);
      graphics.fillCircle(16, 18, 4.5);

      graphics.fillStyle(0x171b26, 1);
      graphics.fillRect(5, 30, 6, 6);
      graphics.fillRect(21, 30, 6, 6);

      graphics.generateTexture('player-courier', 32, 40);
      graphics.destroy();
    }
  }
}

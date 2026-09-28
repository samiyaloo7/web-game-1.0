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
import { CityRenderer } from '../renderers/CityRenderer';
import { createRunSeed, generateCity, validateCity } from '../systems/CityGenerator';
import { planDroneSpawns } from '../systems/DroneSpawner';
import { SeededRandom } from '../systems/SeededRandom';
import { PlayerProgression } from '../systems/PlayerProgression';
import { DEFAULT_BASE_STATS } from '../types/progression';

/** Options accepted by the scene instance built in `config.ts`. */
export interface GameSceneOptions {
  /** Seed for the procedural city. Omit it to roll a fresh city for every run. */
  seed?: number | string;
}

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private inputManager!: InputManager;
  private deliveryManager!: DeliveryManager;
  private activePackageDrop: PackageDrop | null = null;
  private activeDestinationPad: DestinationPad | null = null;
  private guideArrow!: Phaser.GameObjects.Graphics;
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

    // The career profile lives outside the run: it survives restarts and district jumps,
    // and pushes its own snapshots outward through the injected callback (never through
    // a direct EventBus import, which would drag the engine into its unit tests).
    this.progression = new PlayerProgression({
      onChange: (snapshot) => EventBus.emitEvent('progression:updated', snapshot),
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

    this.createNotificationBanner();

    // Register React UI command listeners
    EventBus.onCommand('cmd:toggle-pause', this.handleTogglePauseCommand);
    EventBus.onCommand('cmd:set-pause', this.handleSetPauseCommand);
    EventBus.onCommand('cmd:restart-mission', this.handleRestartMissionCommand);
    EventBus.onCommand('cmd:regenerate-city', this.handleRegenerateCityCommand);
    EventBus.onCommand('cmd:restart-run', this.handleRestartRunCommand);

    // Clean up event listeners on scene shutdown
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
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

    this.cameras.main.shake(140, 0.006);
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
    this.time.delayedCall(2500, () => this.hideBanner());
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
    this.time.delayedCall(2000, () => this.hideBanner());
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
      this.time.delayedCall(2500, () => this.hideBanner());
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

    this.time.delayedCall(2500, () => this.hideBanner());
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

    this.showBanner(
      'CARGO SECURED - EN ROUTE',
      `Deliver to ${mission.dropoffLocation.name} (${mission.dropoffLocation.zone}) before timer expires!`,
      0xffaa00
    );

    this.time.delayedCall(2000, () => this.hideBanner());
  }

  private onPackageDelivered(): void {
    this.deliveryManager.completeDelivery();
    const mission = this.deliveryManager.getCurrentMission();

    if (this.activeDestinationPad) {
      this.activeDestinationPad.destroy();
      this.activeDestinationPad = null;
    }

    this.cameras.main.flash(300, 57, 255, 20, true);

    const credits = mission?.rewards?.credits ?? 0;
    const bonus = mission?.rewards?.timeBonus ?? 0;
    const xp = mission?.rewards?.xp ?? 0;

    // Pay the career profile (wallet + rank). Progression emits its own
    // `progression:updated` snapshot, so the HUD updates without any extra wiring here.
    const levelUp = this.progression.recordDelivery(credits, xp);
    const rankNote = levelUp.levelsGained > 0 ? ` // RANK ${levelUp.newLevel} REACHED!` : '';

    this.showBanner(
      'DELIVERY COMPLETE!',
      `Earned ¢${credits} (+¢${bonus} speed bonus) and +${xp} XP. Next assignment arriving...${rankNote}`,
      0x39ff14
    );

    this.nextMissionCooldownTimer = 3.5;
  }

  private onMissionStateChanged(mission: ActiveMission): void {
    if (mission.status === 'failed') {
      this.clearMissionEntities();
      this.cameras.main.shake(300, 0.01);

      this.showBanner(
        'MISSION FAILED // TIMEOUT',
        'Cargo contract voided. Standby for next dispatch assignment...',
        0xff007f
      );

      this.nextMissionCooldownTimer = 3.5;
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

    this.notificationBanner.setVisible(true);
    this.notificationBanner.setAlpha(1);
  }

  private hideBanner(): void {
    this.notificationBanner.setVisible(false);
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

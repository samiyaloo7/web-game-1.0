import * as Phaser from 'phaser';
import { Player } from '../entities/Player';
import { PackageDrop } from '../entities/PackageDrop';
import { DestinationPad } from '../entities/DestinationPad';
import { InputManager } from '../systems/InputManager';
import { DeliveryManager } from '../systems/DeliveryManager';
import { ActiveMission } from '../types/delivery';
import { EventBus } from '../EventBus';

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

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    this.createProgrammaticTextures();
    PackageDrop.ensureTexture(this);
  }

  create(): void {
    const worldWidth = 1280;
    const worldHeight = 720;

    this.createGridBackground(worldWidth, worldHeight);
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

    this.inputManager = new InputManager(this);
    this.deliveryManager = new DeliveryManager((mission) => this.onMissionStateChanged(mission));

    this.guideArrow = this.add.graphics();
    this.guideArrow.setDepth(5);

    this.player = new Player(this, worldWidth / 2, worldHeight / 2, {
      speed: 310,
      acceleration: 1500,
      drag: 0.88,
    });
    this.player.setDepth(10);

    this.createNotificationBanner(worldWidth, worldHeight);

    // Register React UI command listeners
    EventBus.onCommand('cmd:toggle-pause', this.handleTogglePauseCommand);
    EventBus.onCommand('cmd:set-pause', this.handleSetPauseCommand);
    EventBus.onCommand('cmd:restart-mission', this.handleRestartMissionCommand);

    // Clean up event listeners on scene shutdown
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.teardownCommandListeners();
    });

    // Notify React that the engine and initial session stats are ready
    EventBus.emitEvent('game:ready');
    this.deliveryManager.emitStatsUpdate();

    // Start first delivery
    this.startNewDeliveryRun();
  }

  private teardownCommandListeners(): void {
    EventBus.offCommand('cmd:toggle-pause', this.handleTogglePauseCommand);
    EventBus.offCommand('cmd:set-pause', this.handleSetPauseCommand);
    EventBus.offCommand('cmd:restart-mission', this.handleRestartMissionCommand);
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

  override update(_time: number, delta: number): void {
    if (this.isPaused) return;

    const deltaSeconds = delta / 1000;

    const input = this.inputManager.getMovementInput();
    this.player.updatePlayer(delta, input);

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
    const mission = this.deliveryManager.generateNewMission();

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

    this.showBanner(
      'DELIVERY COMPLETE!',
      `Earned ¢${credits} (+¢${bonus} speed bonus) and +${xp} XP. Next assignment arriving...`,
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

  private createNotificationBanner(worldWidth: number, worldHeight: number): void {
    this.notificationBanner = this.add.container(worldWidth / 2, worldHeight / 2 - 120);
    this.notificationBanner.setDepth(30);
    this.notificationBanner.setVisible(false);

    this.bannerBg = this.add.graphics();
    this.notificationBanner.add(this.bannerBg);

    this.bannerTitle = this.add.text(0, -14, '', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    this.bannerTitle.setOrigin(0.5, 0.5);
    this.notificationBanner.add(this.bannerTitle);

    this.bannerSub = this.add.text(0, 14, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#cbd5e1',
    });
    this.bannerSub.setOrigin(0.5, 0.5);
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

  private createGridBackground(width: number, height: number): void {
    const grid = this.add.graphics();
    const gridSize = 40;

    grid.fillStyle(0x0a0c14, 1);
    grid.fillRect(0, 0, width, height);

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

    grid.lineStyle(3, 0x00f0ff, 0.6);
    grid.strokeRect(4, 4, width - 8, height - 8);

    grid.lineStyle(1, 0xff007f, 0.3);
    grid.strokeCircle(width / 2, height / 2, 80);
  }
}

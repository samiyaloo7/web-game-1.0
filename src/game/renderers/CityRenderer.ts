import * as Phaser from 'phaser';
import type { CityMap, ObstacleKind } from '../types/city';

/**
 * Neon accent palette. Buildings pick a variant deterministically at generation
 * time, so the renderer stays dumb: it only maps data to pixels.
 */
const BUILDING_ACCENTS = [0x00f0ff, 0xff007f, 0xffaa00, 0x8b5cf6];

const OBSTACLE_ACCENTS: Record<ObstacleKind, number> = {
  barrier: 0xffaa00,
  wreck: 0xff007f,
  drone: 0x8b5cf6,
};

/**
 * Renders a `CityMap` into a Phaser scene and exposes matching static collision
 * bodies.
 *
 * This is the only city-related class that knows Phaser exists, which is the point:
 * the generator produces plain data, this class turns it into graphics and physics.
 * Nothing here decides *what* the city looks like — only how it is drawn.
 */
export class CityRenderer {
  private readonly scene: Phaser.Scene;
  private readonly map: CityMap;
  private readonly groundLayer: Phaser.GameObjects.Graphics;
  private readonly structureLayer: Phaser.GameObjects.Graphics;
  private readonly detailLayer: Phaser.GameObjects.Graphics;
  private readonly collisionBodies: Phaser.Physics.Arcade.StaticGroup;
  private isBuilt = false;

  constructor(scene: Phaser.Scene, map: CityMap) {
    this.scene = scene;
    this.map = map;

    // Depth ordering: ground under everything, structures above ground but below
    // gameplay entities (beacons sit at depth 2, the player at 10).
    this.groundLayer = scene.add.graphics().setDepth(-20);
    this.structureLayer = scene.add.graphics().setDepth(-10);
    this.detailLayer = scene.add.graphics().setDepth(-9);

    this.collisionBodies = scene.physics.add.staticGroup();
  }

  /** Draws the city once. Safe to call repeatedly. */
  public render(): void {
    if (this.isBuilt) return;
    this.isBuilt = true;

    this.drawGround();
    this.drawStructures();
    this.createCollisionBodies();
  }

  /** Group of invisible static rectangles matching buildings and obstacles. */
  public getCollisionBodies(): Phaser.Physics.Arcade.StaticGroup {
    return this.collisionBodies;
  }

  public destroy(): void {
    this.groundLayer.destroy();
    this.structureLayer.destroy();
    this.detailLayer.destroy();
    // `true` destroys the invisible collision rectangles as well.
    this.collisionBodies.destroy(true);
  }

  private drawGround(): void {
    const { config, width, height, roads, intersections } = this.map;
    const halfRoad = config.roadWidth / 2;
    const g = this.groundLayer;

    g.fillStyle(0x07080d, 1);
    g.fillRect(0, 0, width, height);

    // Asphalt spans. Drawing full spans means intersections are covered for free.
    g.fillStyle(0x12141c, 1);
    for (const road of roads) {
      const length = road.end - road.start;
      if (road.orientation === 'vertical') {
        g.fillRect(road.center - halfRoad, road.start, road.width, length);
      } else {
        g.fillRect(road.start, road.center - halfRoad, length, road.width);
      }
    }

    // Slightly lighter crossing plates so junctions read as junctions.
    g.fillStyle(0x1b202c, 1);
    for (const node of intersections) {
      g.fillRect(node.x - halfRoad, node.y - halfRoad, config.roadWidth, config.roadWidth);
    }

    // Neon curb edges.
    g.lineStyle(1, 0xff007f, 0.14);
    for (const road of roads) {
      if (road.orientation === 'vertical') {
        g.lineBetween(road.center - halfRoad + 1, road.start, road.center - halfRoad + 1, road.end);
        g.lineBetween(road.center + halfRoad - 1, road.start, road.center + halfRoad - 1, road.end);
      } else {
        g.lineBetween(road.start, road.center - halfRoad + 1, road.end, road.center - halfRoad + 1);
        g.lineBetween(road.start, road.center + halfRoad - 1, road.end, road.center + halfRoad - 1);
      }
    }

    // Dashed lane divider down the middle of every road.
    const dash = 14;
    const step = 26;
    g.lineStyle(2, 0x00f0ff, 0.16);
    for (const road of roads) {
      if (road.orientation === 'vertical') {
        for (let y = road.start + 10; y < road.end; y += step) {
          g.lineBetween(road.center, y, road.center, Math.min(y + dash, road.end));
        }
      } else {
        for (let x = road.start + 10; x < road.end; x += step) {
          g.lineBetween(x, road.center, Math.min(x + dash, road.end), road.center);
        }
      }
    }

    // Crossing corner ticks + a border to frame the sector.
    g.lineStyle(2, 0x00f0ff, 0.45);
    const tick = 8;
    const reach = halfRoad - 6;
    for (const node of intersections) {
      g.lineBetween(node.x - reach, node.y - reach, node.x - reach + tick, node.y - reach);
      g.lineBetween(node.x - reach, node.y - reach, node.x - reach, node.y - reach + tick);
      g.lineBetween(node.x + reach, node.y - reach, node.x + reach - tick, node.y - reach);
      g.lineBetween(node.x + reach, node.y - reach, node.x + reach, node.y - reach + tick);
    }

    g.lineStyle(3, 0x00f0ff, 0.5);
    g.strokeRect(2, 2, width - 4, height - 4);
  }

  private drawStructures(): void {
    const s = this.structureLayer;

    for (const building of this.map.buildings) {
      const accent = BUILDING_ACCENTS[building.variant % BUILDING_ACCENTS.length] ?? 0x00f0ff;
      const left = building.x - building.width / 2;
      const top = building.y - building.height / 2;

      s.fillStyle(0x0b0e16, 1);
      s.fillRect(left, top, building.width, building.height);

      s.fillStyle(accent, 0.05 + building.heightTier * 0.03);
      s.fillRect(left, top, building.width, building.height);

      s.lineStyle(2, accent, 0.7);
      s.strokeRect(left, top, building.width, building.height);

      // Inner roof line reads as a setback / rooftop structure.
      s.lineStyle(1, accent, 0.28);
      s.strokeRect(left + 8, top + 8, building.width - 16, building.height - 16);

      // Window grid. Taller tiers get denser lit windows.
      const inset = 14;
      const spacing = 12;
      s.fillStyle(accent, 0.45);
      for (let y = top + inset; y <= top + building.height - inset; y += spacing) {
        for (let x = left + inset; x <= left + building.width - inset; x += spacing) {
          if (building.heightTier === 1 && (Math.round(x) + Math.round(y)) % 3 !== 0) continue;
          s.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
    }

    const d = this.detailLayer;
    for (const obstacle of this.map.obstacles) {
      const accent = OBSTACLE_ACCENTS[obstacle.kind];
      const { x, y, radius } = obstacle;

      if (obstacle.kind === 'drone') {
        // Hovering hazard read as a circular bubble rather than a box.
        d.fillStyle(0x141821, 1);
        d.fillCircle(x, y, radius);
        d.lineStyle(2, accent, 0.9);
        d.strokeCircle(x, y, radius);
        d.fillStyle(accent, 1);
        d.fillCircle(x, y, 3);
        continue;
      }

      d.fillStyle(0x141821, 1);
      d.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      d.lineStyle(2, accent, 0.9);
      d.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
      d.lineStyle(2, accent, 0.45);
      d.lineBetween(x - radius, y + radius, x + radius, y - radius);
      d.fillStyle(accent, 1);
      d.fillRect(x - 2, y - 2, 4, 4);
    }
  }

  /**
   * Invisible static bodies that mirror the drawn geometry.
   * `CityMap` already guarantees obstacles leave a clear corridor, so a simple
   * axis-aligned box per obstacle is enough — no need for anything fancier.
   */
  private createCollisionBodies(): void {
    for (const building of this.map.buildings) {
      this.addStaticBox(building.id, building.x, building.y, building.width, building.height);
    }
    for (const obstacle of this.map.obstacles) {
      this.addStaticBox(
        obstacle.id,
        obstacle.x,
        obstacle.y,
        obstacle.radius * 2,
        obstacle.radius * 2
      );
    }
  }

  private addStaticBox(name: string, x: number, y: number, width: number, height: number): void {
    const rect = this.scene.add.rectangle(x, y, width, height, 0xffffff, 0);
    rect.setName(name);
    rect.setVisible(false);

    // Static bodies never move, so the physics step does not integrate them.
    // Adding them to one group lets a single collider cover the whole city.
    this.scene.physics.add.existing(rect, true);
    this.collisionBodies.add(rect);
  }
}
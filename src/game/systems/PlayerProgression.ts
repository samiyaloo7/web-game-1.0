import { UPGRADE_CATALOG } from '../data/upgradeData';
import { DEFAULT_BASE_STATS, STARTING_MONEY } from '../types/progression';
import {
  computeEffectiveStats,
  getLevelProgress,
  getUpgradeCost,
  levelFromXp,
  sanitizeUpgradeLevel,
  validateUpgrade,
} from './ProgressionMath';

import type {
  BaseStats,
  EffectiveStats,
  LevelProgress,
  LevelUpResult,
  ProgressionSnapshot,
  ProgressionState,
  UpgradeDefinition,
  UpgradePurchaseResult,
} from '../types/progression';

/**
 * The courier's career progression state: money, XP, derived rank, and owned upgrades.
 *
 * ## Game state vs UI state
 * This class is *game state*: it is the single authority for what the courier owns, it
 * lives with the simulation (Phaser owns its lifetime, not React), and it is mutated
 * only through validated commands (`grantXp`, `purchaseUpgrade`…). React never touches
 * it — the optional `onChange` callback hands an immutable {@link ProgressionSnapshot}
 * across the seam, and the Zustand store merely *mirrors* that snapshot as UI state for
 * rendering. Keeping the seam a callback (instead of importing the EventBus) is what
 * keeps every rule here executable in a plain Node unit test.
 */
export interface PlayerProgressionOptions {
  /** Upgrade tracks the profile may own. Defaults to the shipped garage catalogue. */
  catalog?: readonly UpgradeDefinition[];
  /** Stock frame the upgrade effects stack on top of. */
  baseStats?: BaseStats;
  /** Hydration payload (a future Supabase load). Missing fields fall back to defaults. */
  initialState?: Partial<ProgressionState>;
  /** Fired after every successful mutation with a fresh snapshot — the game → UI seam. */
  onChange?: (snapshot: ProgressionSnapshot) => void;
}

function cloneState(state: ProgressionState): ProgressionState {
  return { money: state.money, xp: state.xp, upgrades: { ...state.upgrades } };
}

function sanitizeMoney(raw: number | undefined, fallback: number): number {
  return raw !== undefined && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : fallback;
}

function sanitizeTotalXp(raw: number | undefined): number {
  return raw !== undefined && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** Keeps only known upgrade ids, clamped into their track's legal level range. */
function sanitizeUpgrades(
  raw: Record<string, number> | undefined,
  catalog: readonly UpgradeDefinition[]
): Record<string, number> {
  const upgrades: Record<string, number> = {};
  if (!raw) return upgrades;

  for (const definition of catalog) {
    const level = sanitizeUpgradeLevel(raw[definition.id], definition.maxLevel);
    if (level > 0) upgrades[definition.id] = level;
  }
  return upgrades;
}

export class PlayerProgression {
  private readonly catalog: readonly UpgradeDefinition[];
  private readonly baseStats: BaseStats;
  private readonly onChange?: (snapshot: ProgressionSnapshot) => void;
  /** Profile the instance was constructed with, so `reset()` restores *that* baseline. */
  private readonly baseline: ProgressionState;
  private state: ProgressionState;

  constructor(options: PlayerProgressionOptions = {}) {
    this.catalog = options.catalog ?? UPGRADE_CATALOG;
    this.baseStats = options.baseStats ?? DEFAULT_BASE_STATS;
    this.onChange = options.onChange;

    this.state = {
      money: sanitizeMoney(options.initialState?.money, STARTING_MONEY),
      xp: sanitizeTotalXp(options.initialState?.xp),
      upgrades: sanitizeUpgrades(options.initialState?.upgrades, this.catalog),
    };
    this.baseline = cloneState(this.state);
  }

  /** Career wallet. Distinct from the throwaway session score kept by `DeliveryManager`. */
  public get money(): number {
    return this.state.money;
  }

  /** Lifetime XP. */
  public get xp(): number {
    return this.state.xp;
  }

  /** Current rank, derived from XP so the two can never drift apart. */
  public get level(): number {
    return levelFromXp(this.state.xp);
  }

  /** Owned level of one track (0 when unknown or not owned). */
  public getUpgradeLevel(upgradeId: string): number {
    const definition = this.catalog.find((d) => d.id === upgradeId);
    if (!definition) return 0;
    return sanitizeUpgradeLevel(this.state.upgrades[upgradeId], definition.maxLevel);
  }

  /** Cost of the next level of `upgradeId`, or `null` when it cannot be bought. */
  public getNextUpgradeCost(upgradeId: string): number | null {
    const definition = this.catalog.find((d) => d.id === upgradeId);
    if (!definition) return null;
    return getUpgradeCost(definition, this.getUpgradeLevel(upgradeId));
  }

  /** Base stats + owned upgrades, ready for the simulation to consume. */
  public getEffectiveStats(): EffectiveStats {
    return computeEffectiveStats(this.state, {
      base: this.baseStats,
      catalog: this.catalog,
    });
  }

  public getLevelProgress(): LevelProgress {
    return getLevelProgress(this.state.xp);
  }

  /** Defensive copy — callers can read the profile, never mutate it in place. */
  public getState(): ProgressionState {
    return cloneState(this.state);
  }

  /** Full plain-data mirror handed to the UI layer. */
  public getSnapshot(): ProgressionSnapshot {
    const progress = this.getLevelProgress();
    const stats = this.getEffectiveStats();

    return {
      money: this.state.money,
      xp: this.state.xp,
      level: progress.level,
      xpIntoLevel: progress.xpIntoLevel,
      xpToNextLevel: progress.xpToNextLevel,
      levelProgress: progress.progress,
      maxHealth: stats.maxHealth,
      speed: stats.speed,
      rewardMultiplier: stats.rewardMultiplier,
      timerBonusSeconds: stats.timerBonusSeconds,
      upgrades: { ...this.state.upgrades },
    };
  }

  /**
   * Adds credits to the career wallet. Returns the amount actually credited —
   * non-positive or non-finite amounts are refused without notifying the UI.
   */
  public grantMoney(amount: number): number {
    const added = this.addMoney(amount);
    if (added > 0) this.notify();
    return added;
  }

  /** Grants lifetime XP and reports any rank-ups it triggered. */
  public grantXp(amount: number): LevelUpResult {
    const result = this.addXp(amount);
    if (result.xpGained > 0) this.notify();
    return result;
  }

  /**
   * Pays out one completed delivery: credits into the wallet, XP into the rank.
   * Both land in a single transaction so the UI hears exactly one update per delivery.
   */
  public recordDelivery(credits: number, xp: number): LevelUpResult {
    const moneyAdded = this.addMoney(credits);
    const xpResult = this.addXp(xp);
    if (moneyAdded > 0 || xpResult.xpGained > 0) this.notify();
    return xpResult;
  }

  /**
   * Validates, then applies, one upgrade purchase.
   * Validation runs against a pure gate first, so a rejection (`unknown-upgrade`,
   * `max-level`, `insufficient-funds`) leaves the wallet and the tracks untouched.
   */
  public purchaseUpgrade(upgradeId: string): UpgradePurchaseResult {
    const definition = this.catalog.find((d) => d.id === upgradeId);
    if (!definition) return { ok: false, reason: 'unknown-upgrade', cost: 0 };

    const validation = validateUpgrade(this.state, definition);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason, cost: validation.cost };
    }

    const newLevel = this.getUpgradeLevel(definition.id) + 1;
    this.state = {
      money: this.state.money - validation.cost,
      xp: this.state.xp,
      upgrades: { ...this.state.upgrades, [definition.id]: newLevel },
    };
    this.notify();

    return { ok: true, upgradeId: definition.id, cost: validation.cost, newLevel };
  }

  /**
   * Replaces the career with a persisted profile (e.g. loaded from Supabase).
   *
   * Sanitises the payload exactly as the constructor does, because the input
   * arrives over the network and is therefore untrusted: non-finite or negative
   * money/XP fall back to the construction baseline, and unknown upgrade ids or
   * out-of-range levels are dropped/clamped against the catalogue. Rank is
   * re-derived from the sanitised XP rather than read from the row — the same
   * rule the database enforces with its generated column.
   *
   * Notifies, so the HUD republishes the loaded wallet/rank immediately.
   */
  public hydrate(state: Partial<ProgressionState>): void {
    this.state = {
      money: sanitizeMoney(state.money, this.baseline.money),
      xp: sanitizeTotalXp(state.xp),
      upgrades: sanitizeUpgrades(state.upgrades, this.catalog),
    };
    this.notify();
  }

  /**
   * Restores the profile to the state it was constructed with (factory defaults, or the
   * hydration payload). Notifies, because the UI must drop any wallet/rank it was showing.
   */
  public reset(): void {
    this.state = cloneState(this.baseline);
    this.notify();
  }

  private addMoney(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const credited = Math.floor(amount);
    if (credited === 0) return 0;
    this.state = { ...this.state, money: this.state.money + credited };
    return credited;
  }

  private addXp(amount: number): LevelUpResult {
    const previousLevel = levelFromXp(this.state.xp);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { xpGained: 0, previousLevel, newLevel: previousLevel, levelsGained: 0 };
    }

    const gained = Math.floor(amount);
    if (gained === 0) {
      return { xpGained: 0, previousLevel, newLevel: previousLevel, levelsGained: 0 };
    }

    const newXp = this.state.xp + gained;
    const newLevel = levelFromXp(newXp);
    this.state = { ...this.state, xp: newXp };

    return { xpGained: gained, previousLevel, newLevel, levelsGained: newLevel - previousLevel };
  }

  private notify(): void {
    this.onChange?.(this.getSnapshot());
  }
}


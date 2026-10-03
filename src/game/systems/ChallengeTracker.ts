import { EMPTY_CHALLENGE_SNAPSHOT } from '../types/challenge';
import type {
  ChallengeMetric,
  ChallengeProgressSnapshot,
  DailyChallenge,
} from '../types/challenge';

/**
 * DAILY CHALLENGE TRACKER — the live attempt state machine.
 *
 * ## Semantics
 *
 * A challenge is `{ metric, target, windowSeconds }`. The window is *armed by the
 * first qualifying delivery*, so "deliver 5 packages in under 3 minutes" means
 * "five deliveries within three minutes of the first one" — idle time before the
 * courier starts working does not burn the clock, and a retry is a fresh attempt
 * rather than a permanent loss.
 *
 *   attempt:  armed by first delivery → progress climbs → completes at target
 *             OR the window expires → attempt lapses, progress resets to 0,
 *             `bestProgress` is kept, and the next delivery arms a new attempt.
 *
 * Completion freezes the tracker for the day: further deliveries are ignored and
 * the reward is paid exactly once.
 *
 * ## Game state vs UI state, again
 *
 * Like `PlayerProgression` and `DeliveryManager`, this is *game state*: it lives
 * with the simulation and reports outward through an `onChange` callback rather
 * than importing the EventBus. That keeps every rule here executable in a plain
 * Node unit test with no canvas and no React. See `ARCHITECTURE.md` §3.
 *
 * ## No clock inside
 *
 * `update()` receives elapsed seconds from Phaser's delta, and nothing here calls
 * `Date.now()`. Whether a completion happened "today" is the server's decision —
 * this file only knows about the window.
 */

/** One finished delivery, as the tracker needs to see it. */
export interface ChallengeDeliveryEvent {
  /** Credits paid for the delivery (payout, bonus included). */
  credits: number;
  /** XP awarded for the delivery. */
  xp: number;
  /** Fraction of the delivery timer that was left, 0..1. Informational. */
  timeRatio: number;
}

export interface ChallengeTrackerOptions {
  /** The day's challenge, or `null` until the server has supplied it. */
  challenge?: DailyChallenge | null;
  /** Fired on every state change worth rendering. */
  onChange?: (snapshot: ChallengeProgressSnapshot) => void;
}

/**
 * Tracks one day's challenge against the live simulation.
 *
 * Deliberately tolerant of a missing challenge: the city and deliveries must run
 * before the network has answered, so every method is a no-op until one arrives.
 */
export class ChallengeTracker {
  private challenge: DailyChallenge | null;
  private readonly onChange?: (snapshot: ChallengeProgressSnapshot) => void;

  private progress = 0;
  private bestProgress = 0;
  private windowActive = false;
  private windowElapsedSeconds = 0;
  private completed = false;
  private lapsed = false;
  private rewardGranted = false;

  /**
   * Last whole second pushed to the UI.
   *
   * The window countdown runs at 60 FPS, so emitting per frame would re-render
   * the HUD sixty times a second — the exact mistake `ARCHITECTURE.md` §11 warns
   * about. Notifications are quantized to the visible second instead.
   */
  private lastEmittedSecond = -1;

  constructor(options: ChallengeTrackerOptions = {}) {
    this.challenge = options.challenge ?? null;
    this.onChange = options.onChange;
  }

  /**
   * Installs the day's challenge.
   *
   * A *different* challenge resets the tracker (a new day, or a first load); the
   * same id is ignored so a refetch mid-day cannot wipe live progress.
   */
  public setChallenge(challenge: DailyChallenge | null): void {
    const nextId = challenge?.id ?? null;
    if (nextId === (this.challenge?.id ?? null)) {
      this.challenge = challenge;
      return;
    }

    this.challenge = challenge;
    this.progress = 0;
    this.bestProgress = 0;
    this.windowActive = false;
    this.windowElapsedSeconds = 0;
    this.completed = false;
    this.lapsed = false;
    this.rewardGranted = false;
    this.lastEmittedSecond = -1;
    this.notify();
  }

  /**
   * Restores the server's view of the day: how far the courier already got, and
   * whether the reward has already been paid.
   *
   * Called after a page reload or a sign-in, so a resumed session does not start
   * from zero and — crucially — does not pay the reward a second time.
   */
  public hydrate(state: { progress: number; completed: boolean; rewardGranted: boolean }): void {
    if (!this.challenge) return;

    const target = this.challenge.objective.target;
    const progress = clampInteger(state.progress, 0, target);

    this.progress = state.completed ? target : progress;
    this.bestProgress = this.progress;
    this.completed = state.completed;
    this.rewardGranted = state.rewardGranted && state.completed;
    this.windowActive = false;
    this.windowElapsedSeconds = 0;
    this.lapsed = false;
    this.lastEmittedSecond = -1;
    this.notify();
  }

  /**
   * Starts a fresh timed attempt (a new run, a reboot after a wreck, a new
   * district). Completion is untouched: a finished challenge stays finished.
   */
  public beginAttempt(): void {
    if (this.completed) return;
    if (this.progress === 0 && !this.windowActive && !this.lapsed) return;

    this.progress = 0;
    this.windowElapsedSeconds = 0;
    this.windowActive = false;
    this.lapsed = false;
    this.lastEmittedSecond = -1;
    this.notify();
  }

  /** Advances the attempt clock. Called once per frame from the scene. */
  public update(deltaSeconds: number): void {
    if (!this.challenge || this.completed || !this.windowActive) return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;

    this.windowElapsedSeconds += deltaSeconds;

    if (this.windowElapsedSeconds >= this.challenge.objective.windowSeconds) {
      // Out of time. The attempt is discarded; `bestProgress` keeps the memory of
      // how close the courier got, and the next delivery arms a fresh attempt.
      this.windowActive = false;
      this.windowElapsedSeconds = 0;
      this.progress = 0;
      this.lapsed = true;
      this.lastEmittedSecond = -1;
      this.notify();
      return;
    }

    const remainingSecond = Math.ceil(this.windowSecondsLeft());
    if (remainingSecond !== this.lastEmittedSecond) {
      this.lastEmittedSecond = remainingSecond;
      this.notify();
    }
  }

  /**
   * Feeds one finished delivery into the objective.
   *
   * The first qualifying delivery arms the window; a delivery that does not move
   * the metric (e.g. a zero-credit run against a `credits` challenge) does not.
   */
  public recordDelivery(event: ChallengeDeliveryEvent): void {
    if (!this.challenge || this.completed) return;

    const increment = this.incrementFor(event);
    if (increment <= 0) return;

    if (!this.windowActive) {
      this.windowActive = true;
      this.windowElapsedSeconds = 0;
      this.lapsed = false;
      // The snapshot just pushed already reports a full window, so seed the
      // quantizer with that second to avoid an immediate duplicate emission.
      this.lastEmittedSecond = Math.ceil(this.windowSecondsLeft());
    }

    this.progress += increment;

    if (this.progress >= this.challenge.objective.target) {
      this.progress = this.challenge.objective.target;
      this.bestProgress = this.progress;
      this.completed = true;
      this.windowActive = false;
    } else if (this.progress > this.bestProgress) {
      this.bestProgress = this.progress;
    }

    this.notify();
  }

  /**
   * Marks the reward as paid into the local career. Idempotent, and it survives a
   * later `hydrate` so a reload cannot double-pay.
   */
  public markRewardGranted(): void {
    if (this.rewardGranted) return;
    this.rewardGranted = true;
    this.notify();
  }

  public isRewardGranted(): boolean {
    return this.rewardGranted;
  }

  public getChallenge(): DailyChallenge | null {
    return this.challenge;
  }

  /** Plain-data mirror for the HUD. Safe to store verbatim in React. */
  public getSnapshot(): ChallengeProgressSnapshot {
    if (!this.challenge) return EMPTY_CHALLENGE_SNAPSHOT;

    return {
      challengeId: this.challenge.id,
      dayIndex: this.challenge.dayIndex,
      metric: this.challenge.objective.metric,
      title: this.challenge.title,
      description: this.challenge.description,
      tier: this.challenge.tier,
      target: this.challenge.objective.target,
      progress: this.progress,
      bestProgress: this.bestProgress,
      windowSeconds: this.challenge.objective.windowSeconds,
      windowRemainingSeconds: Math.ceil(this.windowSecondsLeft()),
      windowActive: this.windowActive,
      completed: this.completed,
      lapsed: this.lapsed,
      rewardCredits: this.challenge.reward.credits,
      rewardXp: this.challenge.reward.xp,
      rewardGranted: this.rewardGranted,
    };
  }

  private windowSecondsLeft(): number {
    if (!this.challenge) return 0;
    return Math.max(0, this.challenge.objective.windowSeconds - this.windowElapsedSeconds);
  }

  private incrementFor(event: ChallengeDeliveryEvent): number {
    if (!this.challenge) return 0;
    const metric: ChallengeMetric = this.challenge.objective.metric;

    switch (metric) {
      case 'deliveries':
        return 1;
      case 'credits':
        return toNonNegativeInteger(event.credits);
      case 'xp':
        return toNonNegativeInteger(event.xp);
    }
  }

  private notify(): void {
    this.onChange?.(this.getSnapshot());
  }
}

function toNonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

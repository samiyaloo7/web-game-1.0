import { validateDeliverySubmission, type DeliverySubmission } from '@/lib/validation';
import type { TodayChallengePayload } from '@/lib/challenges/client';
import type { ProgressionState } from '@/game/types/progression';

/**
 * OFFLINE STATE
 * =============
 *
 * Everything the browser persists so a courier can play without a connection and
 * reconcile afterwards. Three independent records, all in `localStorage`, all
 * written through *sanitising* parsers — a corrupt or hand-edited row degrades to
 * empty rather than reaching the network malformed:
 *
 *   1. **Outbox** — score rows and daily-challenge progress waiting to be
 *      replayed. Every operation is bound to the `userId` it was created under,
 *      so a different courier signing into the same browser can never have
 *      someone else's records attributed to them (they are dropped on replay).
 *   2. **Challenge cache** — the last payload the server sent, so the panel can
 *      render offline. Display only: the server re-derives the day, the target
 *      and the payout from its own clock on every write, so nothing here can
 *      influence what a replay is worth.
 *   3. **Pending grant** — a reward the server has confirmed but the game scene
 *      has not yet been able to apply (the tab was on another route when the
 *      replay landed). Durable so a crash between "server said yes" and "career
 *      banked it" cannot silently eat the reward.
 *
 * This module is deliberately pure: no `fetch`, no React, no Supabase. The hooks
 * in `src/hooks/useOffline*.ts` own the network side and call in here.
 */

/** The slice of `Storage` these helpers need, declared structurally for tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const OUTBOX_KEY = 'neon-courier.outbox.v1';
export const CHALLENGE_CACHE_KEY = 'neon-courier.challenge-cache.v1';
export const PENDING_GRANT_KEY = 'neon-courier.pending-grant.v1';
export const PENDING_PROGRESSION_KEY = 'neon-courier.pending-progression.v1';

/**
 * Hard cap on queued operations. A long offline trip must not grow storage
 * without bound; when the cap is hit the *oldest* score is dropped first —
 * the most recent runs are the ones the courier still remembers making.
 */
export const MAX_OUTBOX_ITEMS = 50;

/**
 * Attempts before a network-level failure gives up on an operation.
 *
 * Only *server unreachable / 5xx* burn an attempt. Rate limits (429) and auth
 * gaps (401) hold the queue without counting, because both are expected to
 * resolve on their own and retrying them cheaply is exactly right.
 */
export const MAX_OPERATION_ATTEMPTS = 5;

interface QueuedOperationBase {
  /** Client-generated id — the record's identity, not a server token. */
  id: string;
  /** Courier the record belongs to; replayed under any other session → dropped. */
  userId: string;
  /** When it was queued. Ordering and display only; the server keeps its own clock. */
  enqueuedAt: number;
  attempts: number;
}

export interface ScoreOperation extends QueuedOperationBase {
  kind: 'score';
  body: DeliverySubmission;
}

export interface ChallengeOperation extends QueuedOperationBase {
  kind: 'challenge';
  /**
   * The challenge id is carried *locally only* — the report body stays
   * `{ dayIndex, progress }` so the server never trusts a client-supplied id.
   * It exists so a confirmed reward can be handed to the game scene later,
   * possibly after this tab reloaded.
   */
  body: { dayIndex: number; progress: number; challengeId: string };
}

export type QueuedOperation = ScoreOperation | ChallengeOperation;

export interface OutboxState {
  version: 1;
  operations: QueuedOperation[];
}

export function emptyOutbox(): OutboxState {
  return { version: 1, operations: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Validates one stored operation. Anything unrecognised is discarded. */
function parseOperation(value: unknown): QueuedOperation | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : null;
  const userId = typeof value.userId === 'string' && value.userId.length > 0 ? value.userId : null;
  const enqueuedAt = finiteNonNegative(value.enqueuedAt) ? value.enqueuedAt : null;
  const attempts = finiteNonNegative(value.attempts) ? Math.floor(value.attempts) : null;
  if (!id || !userId || enqueuedAt === null || attempts === null) return null;

  if (value.kind === 'score') {
    // The real validator, so nothing that the server would reject (or that a
    // tampered row invented) can even be *queued* for replay.
    const validated = validateDeliverySubmission(value.body);
    if (!validated.ok) return null;
    return { kind: 'score', id, userId, enqueuedAt, attempts, body: validated.value };
  }

  if (value.kind === 'challenge') {
    const body = value.body;
    if (!isRecord(body)) return null;
    if (typeof body.dayIndex !== 'number' || !Number.isInteger(body.dayIndex) || body.dayIndex < 0) {
      return null;
    }
    if (!finiteNonNegative(body.progress)) return null;
    if (typeof body.challengeId !== 'string' || body.challengeId.length === 0) return null;
    return {
      kind: 'challenge',
      id,
      userId,
      enqueuedAt,
      attempts,
      body: {
        dayIndex: body.dayIndex,
        progress: Math.floor(body.progress),
        challengeId: body.challengeId,
      },
    };
  }

  return null;
}

/** Parses a stored outbox blob. Unreadable input yields an empty outbox. */
export function parseOutbox(raw: string | null | undefined): OutboxState {
  if (typeof raw !== 'string' || raw.length === 0) return emptyOutbox();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.operations)) return emptyOutbox();

    const operations = parsed.operations
      .map(parseOperation)
      .filter((operation): operation is QueuedOperation => operation !== null)
      .slice(0, MAX_OUTBOX_ITEMS);

    return { version: 1, operations };
  } catch {
    return emptyOutbox();
  }
}

export function serializeOutbox(state: OutboxState): string {
  return JSON.stringify({ version: 1, operations: state.operations.slice(0, MAX_OUTBOX_ITEMS) });
}

/**
 * Adds an operation, applying the two reconciliation rules that make replay
 * safe to run repeatedly:
 *
 *  - **Scores are unique by id** — re-enqueueing the same record replaces it
 *    rather than duplicating it.
 *  - **Challenge progress coalesces per day** — one row per courier per day,
 *    holding the *highest* progress seen. Progress only ever moves forward, so
 *    merging is lossless and a replayed push can never walk the counter back.
 *
 * Then the cap is applied: the queue stays bounded by dropping the oldest entry.
 */
export function enqueueOperation(state: OutboxState, operation: QueuedOperation): OutboxState {
  let kept = state.operations.filter((existing) => {
    if (operation.kind === 'score' && existing.kind === 'score') {
      return existing.id !== operation.id;
    }
    if (operation.kind === 'challenge' && existing.kind === 'challenge') {
      return !(
        existing.userId === operation.userId && existing.body.dayIndex === operation.body.dayIndex
      );
    }
    return true;
  });

  let incoming: QueuedOperation = operation;
  if (operation.kind === 'challenge') {
    const superseded = state.operations.filter(
      (existing) =>
        existing.kind === 'challenge' &&
        existing.userId === operation.userId &&
        existing.body.dayIndex === operation.body.dayIndex
    );
    const bestProgress = superseded.reduce(
      (best, existing) => (existing.kind === 'challenge' ? Math.max(best, existing.body.progress) : best),
      operation.body.progress
    );
    incoming = { ...operation, body: { ...operation.body, progress: bestProgress } };
  }

  kept = [...kept, incoming];
  while (kept.length > MAX_OUTBOX_ITEMS) kept.shift();

  return { version: 1, operations: kept };
}

export function removeOperation(state: OutboxState, id: string): OutboxState {
  return { version: 1, operations: state.operations.filter((op) => op.id !== id) };
}

/** Records a failed attempt. The caller decides when `attempts` has run out. */
export function setAttempts(state: OutboxState, id: string, attempts: number): OutboxState {
  return {
    version: 1,
    operations: state.operations.map((op) => (op.id === id ? { ...op, attempts } : op)),
  };
}

/**
 * Operations belonging to a specific courier. Filtering happens at replay time
 * (not at read time) so a signed-out session simply waits, and a *different*
 * signed-in courier causes the foreign records to be dropped rather than sent.
 */
export function operationsForUser(state: OutboxState, userId: string): QueuedOperation[] {
  return state.operations.filter((op) => op.userId === userId);
}

export function countOperations(state: OutboxState): number {
  return state.operations.length;
}

/* -------------------------------------------------------------------------- */
/* Storage adapters — guarded, because localStorage throws in privacy modes     */
/* -------------------------------------------------------------------------- */

function getLocalStore(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readOutbox(storage: StorageLike | null = getLocalStore()): OutboxState {
  if (!storage) return emptyOutbox();
  try {
    return parseOutbox(storage.getItem(OUTBOX_KEY));
  } catch {
    return emptyOutbox();
  }
}

export function writeOutbox(state: OutboxState, storage: StorageLike | null = getLocalStore()): void {
  if (!storage) return;
  try {
    storage.setItem(OUTBOX_KEY, serializeOutbox(state));
  } catch {
    // Quota or privacy failure: the session keeps playing, unsynced.
  }
}

/* -------------------------------------------------------------------------- */
/* Challenge cache — last server payload, for rendering offline                */
/* -------------------------------------------------------------------------- */

export interface CachedChallenge {
  v: 1;
  cachedAt: number;
  payload: TodayChallengePayload;
}

/**
 * Light shape check. The cached payload is *display* state — the server
 * re-derives the day, target, metric and payout from its own clock on every
 * write — so the bar here is "cannot crash the panel", not "cannot forge a
 * reward" (which it could not do anyway).
 */
function parseCachedChallenge(raw: string | null | undefined): CachedChallenge | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.v !== 1 || !finiteNonNegative(parsed.cachedAt)) return null;

    const payload = parsed.payload;
    if (!isRecord(payload)) return null;
    if (typeof payload.dayIndex !== 'number' || !Number.isInteger(payload.dayIndex)) return null;
    if (!isRecord(payload.challenge) || typeof payload.challenge.id !== 'string') return null;
    if (payload.progress !== null && !isRecord(payload.progress)) return null;

    return { v: 1, cachedAt: parsed.cachedAt, payload: payload as unknown as TodayChallengePayload };
  } catch {
    return null;
  }
}

export function readChallengeCache(
  storage: StorageLike | null = getLocalStore()
): CachedChallenge | null {
  if (!storage) return null;
  try {
    return parseCachedChallenge(storage.getItem(CHALLENGE_CACHE_KEY));
  } catch {
    return null;
  }
}

export function writeChallengeCache(
  payload: TodayChallengePayload,
  storage: StorageLike | null = getLocalStore()
): void {
  if (!storage) return;
  try {
    const entry: CachedChallenge = { v: 1, cachedAt: Date.now(), payload };
    storage.setItem(CHALLENGE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Best effort: without it, offline shows "no challenge" instead of a stale one.
  }
}

/**
 * Records the locally achieved progress in the cached challenge payload.
 *
 * Called when an operation enters the outbox, so an offline *reload* rehydrates
 * the panel at the progress the courier actually achieved rather than the last
 * value the server happened to see. The target comes from the cached challenge
 * itself — the local one is only ever display state.
 */
export function writeCachedChallengeProgress(
  dayIndex: number,
  progress: number,
  storage: StorageLike | null = getLocalStore()
): void {
  const cached = readChallengeCache(storage);
  if (!cached || cached.payload.dayIndex !== dayIndex) return;

  const target = cached.payload.challenge.objective?.target ?? 0;
  const payload: TodayChallengePayload = {
    ...cached.payload,
    progress: {
      challengeId: cached.payload.challenge.id,
      dayIndex,
      progress,
      target,
      completed: target > 0 && progress >= target,
      claimed: cached.payload.progress?.claimed ?? false,
      completedAt: cached.payload.progress?.completedAt ?? null,
      claimedAt: cached.payload.progress?.claimedAt ?? null,
      rewardCredits: cached.payload.challenge.reward?.credits ?? 0,
      rewardXp: cached.payload.challenge.reward?.xp ?? 0,
    },
  };

  writeChallengeCache(payload, storage);
}

/* -------------------------------------------------------------------------- */
/* Pending grant — a confirmed reward waiting for the game scene               */
/* -------------------------------------------------------------------------- */

export interface PendingGrant {
  challengeId: string;
  credits: number;
  xp: number;
  /** Courier the reward belongs to; a foreign grant is dropped, never applied. */
  userId: string;
  createdAt: number;
}

function parsePendingGrant(raw: string | null | undefined): PendingGrant | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.challengeId !== 'string' || parsed.challengeId.length === 0) return null;
    // A grant written before ownership was stamped has no `userId` — it cannot
    // be attributed safely, so it is dropped rather than paid to whoever is
    // signed in now.
    if (typeof parsed.userId !== 'string' || parsed.userId.length === 0) return null;
    if (!finiteNonNegative(parsed.credits) || !finiteNonNegative(parsed.xp)) return null;
    if (!finiteNonNegative(parsed.createdAt)) return null;

    return {
      challengeId: parsed.challengeId,
      credits: Math.floor(parsed.credits),
      xp: Math.floor(parsed.xp),
      userId: parsed.userId,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export function readPendingGrant(
  storage: StorageLike | null = getLocalStore()
): PendingGrant | null {
  if (!storage) return null;
  try {
    return parsePendingGrant(storage.getItem(PENDING_GRANT_KEY));
  } catch {
    return null;
  }
}

export function writePendingGrant(grant: PendingGrant, storage: StorageLike | null = getLocalStore()): void {
  if (!storage) return;
  try {
    storage.setItem(PENDING_GRANT_KEY, JSON.stringify(grant));
  } catch {
    // Unwritable storage means the reward may be lost on a crash — the server
    // still records the claim, so at worst the local mirror lags.
  }
}

export function clearPendingGrant(storage: StorageLike | null = getLocalStore()): void {
  if (!storage) return;
  try {
    storage.removeItem(PENDING_GRANT_KEY);
  } catch {
    // Nothing to do — the entry simply lingers until it is overwritten.
  }
}

/* -------------------------------------------------------------------------- */
/* Pending career snapshot — durability for the one write that has no queue    */
/* -------------------------------------------------------------------------- */

/**
 * How long an unsaved career snapshot stays relevant.
 *
 * Without a bound, a browser that has been offline for a month would flush a
 * stale wallet over whatever another device has since earned. Seven days is far
 * longer than any real outage and short enough that a stale record can never
 * quietly undo a long streak.
 */
export const MAX_PENDING_PROGRESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingProgression {
  state: ProgressionState;
  queuedAt: number;
}

/**
 * Career progression is deliberately *not* queued with the scores.
 *
 * `save_player_progress` is an absolute write, not a delta (`lib/progression/
 * server.ts`), so replaying an older snapshot would be a downgrade rather than a
 * retry. Exactly one "dirty" snapshot is therefore kept — and it is persisted, so
 * closing the tab during an outage does not silently delete the run's earnings.
 *
 * The conflict rule lives at the call site: a pending snapshot is flushed only
 * when this device actually changed something, never simply because the page
 * loaded (a clean session writing back what it just read is how two devices
 * clobber each other on every visit).
 */
export function readPendingProgression(
  storage: StorageLike | null = getLocalStore()
): PendingProgression | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(PENDING_PROGRESSION_KEY);
    if (typeof raw !== 'string' || raw.length === 0) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.state)) return null;
    if (!finiteNonNegative(parsed.queuedAt)) return null;

    const { state } = parsed;
    if (!Number.isInteger(state.money) || (state.money as number) < 0) return null;
    if (!Number.isInteger(state.xp) || (state.xp as number) < 0) return null;
    if (!isRecord(state.upgrades)) return null;

    const upgrades: Record<string, number> = {};
    for (const [key, value] of Object.entries(state.upgrades)) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
      upgrades[key] = value;
    }

    return {
      state: {
        money: state.money as number,
        xp: state.xp as number,
        upgrades,
      },
      queuedAt: parsed.queuedAt,
    };
  } catch {
    return null;
  }
}

export function writePendingProgression(
  entry: ProgressionState | null,
  storage: StorageLike | null = getLocalStore()
): void {
  if (!storage) return;

  try {
    if (entry === null) {
      storage.removeItem(PENDING_PROGRESSION_KEY);
      return;
    }
    const payload = { v: 1, queuedAt: Date.now(), state: entry };
    storage.setItem(PENDING_PROGRESSION_KEY, JSON.stringify(payload));
  } catch {
    // Best effort: without storage the snapshot still lives in memory for this
    // session, it just cannot outlive the tab.
  }
}

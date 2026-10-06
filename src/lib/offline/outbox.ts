import { useGameStore } from '@/stores/useGameStore';
import {
  countOperations,
  enqueueOperation,
  readOutbox,
  writeCachedChallengeProgress,
  writeOutbox,
  type QueuedOperation,
} from '@/lib/offline/queue';
import type { DeliverySubmission } from '@/lib/validation';
import type { ChallengeOperation, ScoreOperation } from '@/lib/offline/queue';

/**
 * OUTBOX — the thin client layer over `lib/offline/queue.ts`.
 *
 * Queue arithmetic stays pure and testable in `queue.ts`; this module owns the
 * two impure facts: it writes `localStorage`, and it notifies the sync loop that
 * something changed. The notification is a plain `window` CustomEvent rather than
 * an EventBus command, because it is a *browser* concern, not a message to the
 * game engine — and because the outbox must work on pages that never boot Phaser
 * (the leaderboard can be offline-aware too).
 */
export const OUTBOX_CHANGED_EVENT = 'neon-courier:outbox-changed';

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Only reached on ancient browsers; the id just needs to be unique locally.
  return `op-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Republishes the outbox depth for the HUD badge. */
export function publishOutboxDepth(): void {
  useGameStore.getState().setPendingSyncCount(countOperations(readOutbox()));
}

function commit(operation: QueuedOperation): void {
  writeOutbox(enqueueOperation(readOutbox(), operation));
  publishOutboxDepth();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT));
  }
}

/**
 * Queues one delivery for the leaderboard.
 *
 * Only called after a *send* that could plausibly succeed later — a network
 * error, a rate limit, or a server fault. A rejected record (4xx) is dropped
 * immediately instead of being stored.
 */
export function enqueueScoreSubmission(userId: string, body: DeliverySubmission): void {
  const operation: ScoreOperation = {
    kind: 'score',
    id: newOperationId(),
    userId,
    enqueuedAt: Date.now(),
    attempts: 0,
    body,
  };
  commit(operation);
}

/**
 * Queues daily-challenge progress — including a *completion*, which is why the
 * record carries the challenge id: a completion that the server later confirms
 * has to be able to hand its reward to the game scene, possibly after a reload.
 */
export function enqueueChallengeProgress(
  userId: string,
  body: ChallengeOperation['body']
): void {
  const operation: ChallengeOperation = {
    kind: 'challenge',
    id: newOperationId(),
    userId,
    enqueuedAt: Date.now(),
    attempts: 0,
    body,
  };
  commit(operation);
  // Keep the cached payload in step so an offline *reload* rehydrates the panel
  // at the progress actually achieved rather than the last value the server saw.
  writeCachedChallengeProgress(body.dayIndex, body.progress);
}
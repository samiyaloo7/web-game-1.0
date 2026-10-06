# Progressive Web App & Offline Play

Neon Courier installs like a native app, boots its game shell with no
connection, and reconciles everything it earned offline when the uplink
returns. This document explains the five moving parts — service workers, Cache
Storage, the offline-first architecture, synchronization, and conflict handling
— and the security rule that constrains all of them: **offline must never widen
what the client is trusted to decide.**

```text
install ──► shell cached ──► play offline ──► reconnect ──► outbox replays ──► server re-prices
```

---

## 1. Service workers

A service worker is a script the browser runs on a background thread, in its
own global scope, that can intercept the page's network requests. Ours lives at
`public/sw.js` (served from `/sw.js`) and is registered once, production-only,
by `ServiceWorkerRegistration` — dev builds skip registration so the worker
never sits in front of Turbopack and serves stale bundles.

Three lifecycle facts shape the whole design:

- **Install builds the shell.** The worker fetches the precache list
  (`/`, `/game`, `/offline`, the manifest, the icons) before it is allowed to
  control a page. One missing file never fails the install.
- **Activate prunes.** Each worker version names its caches
  (`neon-courier-shell-v1`, `…-nav-v1`); `activate` deletes every cache with
  our prefix that the current version did not create. Bump `VERSION` only when
  the precache list or the strategy itself changes — hashed chunk URLs need no
  bump, because HTML is network-first and chunks are fetched on demand.
- **Updates wait.** There is deliberately no `skipWaiting`: swapping the caches
  underneath a running game would leave it holding a document whose chunks were
  just deleted. A new worker waits in the browser's "waiting" slot and takes
  over on the next cold start.

The worker's own scope is pinned by a `Content-Security-Policy` of
`default-src 'self'` (see `next.config.ts`), so a stolen or confused worker
cannot exfiltrate to a third party — and it must itself never be cached
(`no-cache, no-store, must-revalidate`), or an old worker would outlive its own
update.

## 2. Cache Storage

Cache Storage is the origin-private key/value store the worker reads and
writes. Two caches, two strategies:

| Cache | Contents | Strategy | Why |
|---|---|---|---|
| `-shell-v1` | Precache: the three shell documents, manifest, icons, plus discovered `/_next/static/*` chunks | **cache-first** for static assets | Chunk URLs are content-addressed — the bytes can never change under the name |
| `-nav-v1` | Runtime: documents and App Router (`RSC: 1`) payloads for shell routes only | **network-first**, stored copy as fallback, `/offline` behind that | A deploy is picked up immediately; the stored copy exists only for outages |

What is deliberately *not* stored is the security policy, not an omission:

- **Non-GET requests are never intercepted.** Mutations belong to the page's
  outbox, which owns retries and re-authentication; a worker must not replay
  POSTs.
- **Cross-origin requests are never intercepted.** Supabase and the auth server
  are invisible to the worker — no token or session-scoped response can be
  cached by accident.
- **`/api/*` is never intercepted** (and carries `no-store` at the HTTP layer
  too). Those responses are a function of the session and the server clock.
- **Only public shell routes are stored** (`/`, `/game`, `/offline`).
  Personalised pages such as `/profile` or `/leaderboard` are fetched but never
  written, so one courier's data can never be served to another from a cache.

## 3. Offline-first architecture

Offline-first means the game never needs the network to *play* — it needs it
only to *persist*. The shell (HTML, JS, CSS, Phaser chunks) boots from Cache
Storage; everything the session earns is then staged in `localStorage` through
the pure queue module (`src/lib/offline/queue.ts`), which the network-owning
hooks call into:

| Record | Key | What it holds | Why it is safe offline |
|---|---|---|---|
| **Outbox** | `neon-courier.outbox.v1` | Score rows and challenge progress waiting for replay (max 50, oldest score dropped first) | Operations carry only *references* (`packageId`, `timeRatio`, `dayIndex`, `progress`). The server re-prices, re-validates and re-dates every replay |
| **Challenge cache** | `neon-courier.challenge-cache.v1` | Last server payload, so the panel renders offline | Display only: the server re-derives the day, target and payout from its own clock on every write |
| **Pending grant** | `neon-courier.pending-grant.v1` | A server-confirmed reward the scene has not applied yet | Durable exactly-once handoff: the server's `newlyClaimed` flag means a replayed completion pays nothing twice |
| **Pending career** | `neon-courier.pending-progression.v1` | The latest unsaved career snapshot | Absolute state (not a delta), freshness-bounded, and never written except on our own change |

Which data works offline, and which does not:

- **Playable offline:** the full game loop (deliveries, drones, upgrades as
  applied locally), career earnings (held in memory *and* the pending
  snapshot), score submissions (outbox), and challenge progress including
  completions (outbox).
- **Unavailable offline:** sign-in/sign-out (Supabase Auth needs the network),
  the leaderboard and challenge history (personalised server renders, never
  cached), and career *loading* on a fresh device (there is no local snapshot
  to restore yet). Guests keep playing on an in-memory profile either way.

## 4. Synchronization

Reconnection drains in `useOfflineSync`, triggered by mount, the `online`
event, tab visibility, and every fresh enqueue. The pass is FIFO with a failure
taxonomy:

- **`done`** — accepted; dropped from the outbox. A confirmed challenge reward
  is handed to the scene (or parked as a pending grant if the scene is not
  ready).
- **`drop`** — refused for good (any other 4xx, or a challenge day that rolled
  over). Retrying would produce the same answer forever.
- **`hold`** — 401 or 429. Kept without burning an attempt; retried after
  30 s. Both resolve on their own.
- **`fail`** — unreachable or 5xx. Counts an attempt and stops the pass (if the
  uplink is down for the first record it is down for the rest); retried after
  10 s, dropped after 5 attempts so one poisoned entry cannot wedge the queue.

Career snapshots flush on their own debounce through `useProgressionSync`, not
through the outbox (see §5 for why). The HUD's `ConnectivityBadge` reports the
live state: `OFFLINE` with a queued count, `SYNCING` while the outbox is
non-empty online, and the career `syncStatus` (`saving`/`saved`/`error`).

## 5. Conflict handling

Three independent records, three rules — each matched to what the server treats
as authoritative:

- **Scores are independent records.** Every delivery is its own row; there is
  nothing to merge and nothing to conflict. Replaying them in FIFO order is
  sufficient, and the server stamps its own `created_at`.
- **Challenge progress is monotonic.** The RPC clamps and only ever raises the
  stored counter toward the target; a stale or duplicate replay is absorbed.
  The midnight-rollover guard (`409` when the client's `dayIndex` disagrees
  with the server's clock) means progress can never be applied to a challenge
  the courier did not play, and `newlyClaimed` makes the reward exactly-once
  across retries, tabs, and reloads.
- **Career progression is last-writer-wins with a freshness bound.**
  `save_player_progress` is an *absolute* write, not a delta, so replaying an
  older snapshot would be a downgrade — which is why the career is deliberately
  *not* queued with the scores. Exactly one dirty snapshot is kept, and it is
  flushed only when this device changed something (never merely because the
  page loaded, which is how two devices clobber each other on every visit). On
  load, a fresh pending snapshot (≤ 7 days) wins over the server row because it
  is the newer truth; a stale one is discarded so a month-old wallet can never
  flush over what another device has since earned. Account switches clear the
  snapshot entirely, so one courier's wallet can never be saved under another's
  session.

## 6. Security: what offline does NOT change

- The worker stores no tokens and replays no mutations; authentication stays in
  httpOnly cookies on the same endpoints, with the same server-side
  validation.
- Every replay is re-priced and re-dated by the server from its own catalog,
  clock, and the caller's stored upgrades. A forged or hand-edited outbox can
  only ever land inside the range a legitimate run would have earned.
- Every outbox record and every pending grant is bound to the `userId` it was
  created under. Records from a different session in the same browser are
  dropped on replay, never attributed to whoever is signed in now.
- All persisted records are written through sanitising parsers: a corrupt or
  hand-edited row degrades to empty rather than reaching the network
  malformed, and storage failures (quota, private mode) degrade to an unsynced
  session rather than a crash.

# Daily Challenges

One objective per UTC calendar day, shared by every courier on the planet, derived
entirely from the date. Nothing about *which* challenge is today is stored,
transmitted, or negotiated — it is recomputed, identically, by the server that
answers and by the client that renders. What is stored is only a courier's
*result*.

```text
date  ──►  dayIndex  ──►  seed label  ──►  FNV-1a  ──►  SeededRandom  ──►  challenge
                       "neon-courier:daily-challenge:2026-09-29"
```

---

## 1. The date → seed derivation

Implemented in `src/game/systems/DailyChallenge.ts` (pure, no clock, no I/O) and
`src/game/systems/SeededRandom.ts` (the hash and the PRNG).

### Step 1 — the day index

```ts
const CHALLENGE_EPOCH_MS = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z

function utcDayIndex(epochMs: number): number {
  return Math.floor((epochMs - CHALLENGE_EPOCH_MS) / 86_400_000);
}
```

A single integer, counted in **whole UTC days** from a fixed epoch. The epoch is a
constant rather than a moving "today" so the same date always maps to the same
integer — including for days before the epoch, which simply produce negative
indices instead of wrapping.

Using UTC days (`Date.UTC` / `toISOString`) rather than local calendar arithmetic
is what makes the challenge *citywide*: a courier in Tokyo and a courier in
Los Angeles are on the same day index for the same instant, because the boundary
is 00:00 **UTC**, not their own midnight.

### Step 2 — the seed label

```ts
`${CHALLENGE_SEED_NAMESPACE}:${dayIndexToIsoDate(dayIndex)}`
// "neon-courier:daily-challenge:2026-09-29"
```

The **ISO date string**, not the raw integer, is what gets hashed. This is a
deliberate debugging choice: `2026-09-29` is self-describing in a log line, a bug
report or a support ticket, whereas `271` is not. The namespace prefix means a
daily-challenge seed can never collide with the district seed, the drone spawner's
seed or any future stream, even if the same date and the same hash were used.

`dayIndexToIsoDate` is the inverse of step 1 (`new Date(dayIndex * 86_400_000 +
epoch).toISOString().slice(0, 10)`), so the label and the index can never disagree
about which day they describe.

### Step 3 — the hash

FNV-1a, 32-bit, in `SeededRandom.ts`:

```ts
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
```

Chosen over `Math.random`, a UUID, or the date's millisecond value because it is:

- **deterministic** — same string in, same integer out, on every engine;
- **pure integer arithmetic** — `Math.imul` and xor only, so there is no
  floating-point drift between a Node server and a browser;
- **stable across releases** — unlike a hash that might be "improved" later, FNV-1a
  is finished. Changing it would silently rewrite every future day's challenge, so
  it must never be swapped for a "nicer" one.

### Step 4 — the seeded PRNG

`SeededRandom` (mulberry32-style, normalised from the hash) provides `pick()`,
`int()` and `float()`. The generator performs **exactly three draws, in a fixed
order**:

```ts
const rng = new SeededRandom(seedLabel);
const template      = rng.pick(CHALLENGE_TEMPLATES);   // 1. which objective family
const target        = rng.pick(template.targets);      // 2. how much
const windowSeconds = rng.pick(template.windowsSeconds); // 3. in how long
```

The order is part of the contract, not an implementation detail: drawing the
window before the target would produce a different challenge for the same day and
silently invalidate everyone's in-flight attempt. `DailyChallenge.test.ts` pins
both the fixed order and a hand-computed expected challenge for a known date.

Reward is **not** a draw. It is computed from the objective
(`rewardPerUnit × target × timePressure`, rounded to `CHALLENGE_REWARD_STEP`,
floored at `CHALLENGE_MIN_REWARD`), with `timePressure` clamping the
`CHALLENGE_WINDOW_REFERENCE_SECONDS / windowSeconds` ratio between
`CHALLENGE_TIME_PRESSURE_MIN` and `CHALLENGE_TIME_PRESSURE_MAX`. So a shorter
window pays more, and no day is an outlier. `tier` is likewise derived — a band
lookup on the reward — so difficulty and payout cannot disagree.

`describeChallenge()` renders the human sentence ("Deliver 5 packages in under 3
minutes.") from those numbers rather than storing it per template, and
deliberately avoids `Intl`/`toLocaleString`: locale-dependent formatting would
make the *same* day render differently on different machines, which is exactly the
property the whole design is protecting.

---

## 2. Clock authority: the server decides which day it is

The derivation above is a pure function of *one timestamp*. The entire design
hinges on **where that timestamp comes from**, and the answer is: never the
browser.

```text
GET  /api/challenges   ← the only source of "today"
  loadTodayChallenge()            src/lib/challenges/server.ts
    Date.now()                    ← the Node process's clock
    buildDailyChallengeContext(…) ← the same pure functions the client uses
  └─► { dayIndex, date, serverTimeMs, secondsUntilReset, challenge, progress }
```

The browser is *told* the day; it never computes it. `POST /api/challenges` then
uses the client's `dayIndex` for exactly one thing — an **equality check**:

```ts
const context = buildDailyChallengeContext(Date.now());
if (submission.dayIndex !== context.dayIndex) {
  return NextResponse.json({ error: '…' }, { status: 409 });
}
```

The `409` is the midnight-rollover guard. Without it a stateless API has one
genuine hole: an attempt that starts at 23:59:58 UTC and reports at 00:00:01 would
apply its progress to *tomorrow's* objective — completing a challenge the courier
never attempted, and paying a reward for it. The check makes the server's own day
the arbiter and turns the race into a refetch.

Note what the comparison is **not** doing. It is not trusting the client to select
a challenge, and it is not deriving anything from a client value. A client that
lies about the date is rejected, never believed; a client whose system clock is
wrong by three years still plays today's challenge, because it is handed today's
`dayIndex` and echoes it back unchanged.

`secondsUntilReset` exists for the same reason: the client schedules its refetch
at the UTC boundary from *that* number rather than from its own clock, so a
machine with a skewed clock does not refresh at the wrong moment or, worse, at
the right moment three days early.

The hard-coded 2026 epoch is why the index is a small, human-scale integer
(`271` for 2026-09-29) rather than ~20,000 from the Unix epoch: it keeps the value
readable in a query, and it keeps `dayIndex` ordering equal to date ordering for
every day in the game's lifetime.

## 3. The runtime seam

The rules are written once and consumed on four sides. Nothing is duplicated.

```text
                    ┌──────────────────────────────┐
                    │ game/types/challenge.ts      │  domain types, no React/Phaser
                    │ game/systems/DailyChallenge  │  date → challenge (pure)
                    │ game/data/challengeData.ts   │  templates + tuning
                    └──────────────┬───────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
  app/api/challenges/route   lib/challenges/server     game/systems/ChallengeTracker
  (server clock authority)   (SSR reads, RLS)         (attempt state machine)
```

Inside the browser the two halves of the app talk over the EventBus, not over
imports — React never touches the Phaser scene object and Phaser never imports
Supabase or `fetch` (`ARCHITECTURE.md` §11):

| Direction | Message | Who sends / receives |
| --- | --- | --- |
| UI → game | `cmd:load-daily-challenge` | `useDailyChallenge` → `GameScene` → `ChallengeTracker.load()` |
| UI → game | `cmd:grant-challenge-reward` | `useDailyChallenge` → `GameScene` → `ChallengeTracker.grantReward()` |
| game → UI | `challenge:progress` | tracker snapshot → store → `GameHudChallenge` |

The tracker is the authority on *gameplay* state (is the window armed, how far did
this attempt get, has it completed); the store is a mirror for rendering. The
render-shielding rule from `ARCHITECTURE.md` §11 is respected by the tracker
quantising to whole seconds and only emitting on a real change of state or of the
quantised second — so the HUD re-renders at most once per second, never per frame.

Attempt semantics, all of which the tracker owns:

- the window is **armed by the first qualifying event**, not by spawning in, so
  "5 deliveries in 3:00" means three minutes from *delivery #1*;
- `bestProgress` survives a lapse, so a failed attempt still shows how close the
  courier got and invites a retry;
- `lapsed` distinguishes "ran out of time" from "never started";
- completion is announced **once**, and the reward is paid locally only after the
  server says `newlyClaimed`, so a reload cannot pay twice.

---

## 4. Persistence

`supabase/migrations/20260929100000_daily_challenges.sql`.

**The challenge definition is not stored.** Only the result is:

```text
daily_challenge_progress
  primary key (profile_id, challenge_id)
  challenge_id  ~ '^dc_[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  day_index, metric, target, window_seconds,
  title, description, reward_credits, reward_xp,   ← snapshots of the day's run
  progress, completed_at, claimed_at, created_at, updated_at
```

Four decisions worth stating:

1. **The composite primary key makes the write path idempotent.** A retried `POST`
   cannot create a second row for the day, and "one result per courier per day" is
   a schema fact rather than an application convention.
2. **`title`/`description`/`window_seconds`/`reward_*` are snapshots.** History is
   read back from the row, never regenerated, so editing the generator's templates
   later cannot rewrite what a courier already played — the same reason a receipt
   keeps the price it charged.
3. **`CHECK (progress <= target)` and `CHECK (claimed_at is null or completed_at is
   not null)`** make an out-of-range counter and a reward-for-nothing row
   unrepresentable, as the backstop behind the RPC's clamp.
4. **RLS is read-only for clients.** There is a SELECT policy
   (`profile_id = (select auth.uid())`) and deliberately **no** INSERT/UPDATE policy
   and no write grant, so `record_challenge_progress` is the single write path.

`record_challenge_progress` is `SECURITY DEFINER` with `set search_path = ''` and
takes **no owner argument** — it writes `auth.uid()`'s own row, so it cannot be
aimed at somebody else. Its `EXECUTE` grant is revoked from `public` and `anon`
and granted only to `authenticated`.

The trust model is the same as `submit_delivery` (`ARCHITECTURE.md` §12):

| Value | Supplied by | Why that is safe |
| --- | --- | --- |
| `p_progress` | the browser | clamped `greatest(0, least(p_progress, p_target))`; a lie can reach the target and no further |
| `p_target`, `p_window_seconds`, `p_title`, `p_description`, `p_reward_*` | the **route**, from the generator | the payout is the server's number, never a request's |
| `p_challenge_id`, `p_day_index` | the **route**, from its own clock | the client's day was already equality-checked (`409`) |
| `completed_at`, `claimed_at` | `now()` in Postgres | the timestamp is the database's, not any client's |

`newly_claimed` is computed inside the RPC from a pre-call read of `claimed_at`,
and the upsert uses `coalesce(dcp.claimed_at, excluded.claimed_at)` to keep the
**first** claim. Together those make "pay exactly once" a property of the
database, not of a client remembering what it has already done: a retry, a second
tab, or a reload all see `newlyClaimed: false` and pay nothing.

## 5. Failure modes

Every one of these is a designed path, not an unhandled case.

| Situation | What happens |
| --- | --- |
| Supabase not configured | `challengeSyncStatus = 'offline'`. The challenge is still *derived*, so it plays and pays locally; only the history is absent. |
| Not signed in | Same as above — an honest guest session. The API's `POST` answers `401` and the HUD says the run was not recorded. |
| Uplink unreachable | `'error'`. The run is played and paid locally; the HUD shows a retry badge rather than a broken panel. |
| Midnight passes mid-attempt | The `POST` gets `409`; the hook discards the report, refetches, and reloads the tracker with the new day instead of retrying the stale write. |
| Completion reported twice | The second response carries `newlyClaimed: false`, so the local career is credited once. |
| Tampered `progress` | Clamped in the validator, clamped again in SQL, and capped by `CHECK (progress <= target)`. The reward never came from the request. |
| Clock skew on the client | Irrelevant. The day and the reset countdown both come from the server's answer. |
| Generator templates edited later | Today's challenge changes for days not yet played; history rows keep the fields they were written with. Changing the **hash** or the **draw order** is the only way to rewrite a past challenge, and both are documented above as frozen. |

## 6. File map

| Path | Role |
| --- | --- |
| `src/game/types/challenge.ts` | domain types + `EMPTY_CHALLENGE_SNAPSHOT`; no React, no Phaser |
| `src/game/data/challengeData.ts` | templates, reward tuning, bounds |
| `src/game/systems/SeededRandom.ts` | `hashSeed` (FNV-1a) + seeded PRNG |
| `src/game/systems/DailyChallenge.ts` | date → challenge; the pure generator |
| `src/game/systems/ChallengeTracker.ts` | attempt state machine, snapshot emission |
| `src/game/scenes/GameScene.ts` | wires the tracker to deliveries and the EventBus |
| `src/game/EventBus.ts` | `challenge:progress`, `challenge:completed`, `cmd:load-daily-challenge`, `cmd:grant-challenge-reward` |
| `src/hooks/useDailyChallenge.ts` | fetch today, load the tracker, report, refetch at the reset |
| `src/stores/useGameStore.ts` | `challenge` + `challengeSyncStatus` mirror |
| `src/components/game/GameHudChallenge.tsx` | the in-game panel |
| `src/app/api/challenges/route.ts` | `GET` today's challenge, `POST` an attempt's progress |
| `src/lib/challenges/server.ts` | SSR reads (`loadTodayChallenge`, `loadChallengeHistory`) |
| `src/lib/challenges/client.ts` | browser `fetch` wrappers, failures returned not thrown |
| `src/lib/challenges/mapping.ts` | pure row → domain translation |
| `src/lib/validation.ts` | `validateChallengeProgressSubmission` |
| `src/app/challenges/page.tsx` | today + history board |
| `supabase/migrations/20260929100000_daily_challenges.sql` | table, RLS, RPC |

## 7. Verifying

```bash
npx vitest run tests/unit/DailyChallenge.test.ts tests/unit/ChallengeTracker.test.ts \
               tests/unit/challengeValidation.test.ts tests/unit/migrations.test.ts
```

- `DailyChallenge.test.ts` — determinism, the fixed draw order, the inverse
  `dayIndex ↔ date` round trip, and the UTC day boundary (23:59:59 vs 00:00:00).
- `ChallengeTracker.test.ts` — window arming, lapse, `bestProgress`, completion,
  the once-only reward grant, and the tier mirror.
- `challengeValidation.test.ts` — what the browser may send, and what it may not.
- `migrations.test.ts` — that the migration parses, and that it encodes the policy
  above (RLS, no write grant, the clamps, the once-only claim).

To eyeball a specific day without waiting for it, call the generator directly:

```ts
import { generateDailyChallenge, utcDayIndex } from '@/game/systems/DailyChallenge';
generateDailyChallenge(utcDayIndex(Date.UTC(2026, 8, 29)));
// → { id: 'dc_2026-09-29', seedLabel: 'neon-courier:daily-challenge:2026-09-29', … }
```

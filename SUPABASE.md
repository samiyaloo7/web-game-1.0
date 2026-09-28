# Supabase — Neon Courier

Backend for **authentication**, **persistent progression**, and the **leaderboard**.

---

## 1. Concepts

### Project ref and the two keys

A Supabase project has one URL and two API keys. The difference between them is
the entire security model of this app.

| | **anon key** | **service-role key** |
|---|---|---|
| Variable | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| Reaches the browser? | Yes — **by design** | **Never** |
| Honours RLS? | Yes | **No — bypasses it entirely** |
| Can read/write every row? | No | Yes |
| Used in this app for | All client reads, auth | Only `POST /api/scores` |

The anon key is public on purpose. Knowing it identifies you as *the role
"anon"*, not as a person. Every query it makes is filtered by Row Level
Security, so it can only ever return rows the policies allow. Publishing it is
safe **because RLS is enabled** — the key and the policies are a matched pair.

The service-role key is the opposite: it authenticates as `postgres` and skips
every policy. **A leaked service key means anyone can read, rewrite or delete
the entire database.** Three defences keep it server-side:

1. No `NEXT_PUBLIC_` prefix, so Next.js never inlines it into the client bundle.
2. `src/lib/supabase/service.ts` is the only file that reads it, and it throws if
   constructed in a browser.
3. `tests/unit/security.test.ts` scans the tree and fails the build if any other
   module references it.

### Roles: anon and authenticated

Supabase maps a request to a Postgres role based on the JWT it carries:

- No valid session → role `anon`.
- Valid session → role `authenticated`, with `auth.uid()` returning the user's UUID.

Policies are written per role. That is why `profiles` is readable by `anon` (the
leaderboard is public) while `player_progress` is `authenticated`-only.

### Row Level Security (RLS)

RLS is a **per-row** permission system inside Postgres. When enabled, *every*
query is checked against a policy for the current role, and non-matching rows are
invisible — as though they were not in the table.

This is the key idea behind the whole design: **security lives in the database,
not in application code.** Even a compromised browser running arbitrary
JavaScript cannot read another courier's career, because the row filter is
applied server-side by Postgres after the request arrives.

```sql
alter table public.player_progress enable row level security;

create policy player_progress_select_own on public.player_progress
  for select to authenticated
  using (profile_id = (select auth.uid()));
```

`auth.uid()` extracts the UUID from the request's JWT. The `select` wrapper is a
planner hint: it evaluates the claim once per statement instead of once per row.

### Grants vs. policies (two different gates)

- **GRANT** — "may this role perform this operation on this table at all?" A
  table-level gate.
- **POLICY** — "which *rows* may this role touch?" A row-level gate.

Both must pass. A role with no `INSERT` grant cannot insert even if a policy
would allow it, and a role with a grant still sees only the rows its policy
permits. The migration states both explicitly per table rather than relying on
### SECURITY DEFINER and RPCs

An **RPC** (Remote Procedure Call) is a stored function invoked over PostgREST:
`supabase.rpc('save_player_progress', { ... })`. By default a function runs with
the *caller's* privileges. `security definer` instead runs it with its **owner's**
(i.e. `postgres`) privileges.

`save_player_progress` is `security definer`, which is what lets it write rows
that clients have **no grant and no write policy for**. This is deliberate:
rather than granting `INSERT` to `authenticated` and hoping every future policy
stays correct, writes are funnelled through a single function where all
validation lives, and the table stays locked. One auditable choke point.

Two safety details: `set search_path = ''` prevents a hijacked search path from
redirecting the function's table references, and the function reads `auth.uid()`
itself — it accepts no id argument, so it cannot be pointed at another courier's
row.

### Generated columns

```sql
level integer generated always as (public.level_from_xp(xp)) stored
```

Postgres **computes and stores** this value, recomputing it whenever `xp` changes,
and refusing any `INSERT`/`UPDATE` that names it. This makes "stored rank"
structurally impossible to desync from "earned XP" — a client cannot persist a
level it did not earn, even by crafting the request. The function is
`immutable`, which is what allows Postgres to use it in a generated column.

### The signup trigger

```sql
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

Supabase Auth inserts into `auth.users`; this `AFTER INSERT` trigger then creates
the matching `profiles` and `player_progress` rows in the *same transaction*. A
"user without a profile" state is impossible by construction rather than
something the application must remember to clean up. The function is
`security definer` (it needs to write to tables clients cannot) and reads
`raw_user_meta_data ->> 'username'` to pick up the call-sign chosen at signup.

### The `security_invoker` view

Postgres views normally run with their **owner's** privileges — meaning a view
over a protected table silently bypasses RLS. Postgres 15 added:

```sql
create view public.leaderboard with (security_invoker = on) as ...
```

which makes the view obey the *querying* role's policies. Without it the
leaderboard becomes a privilege-escalation hole the moment anyone tightens the
`scores` policies.

### Sessions and cookies (@supabase/ssr)

Supabase tokens are JWTs (~1 hour) plus a longer refresh token. `@supabase/ssr`
stores them in **httpOnly cookies** and manages rotation, so client-side
JavaScript cannot read them — an XSS payload cannot exfiltrate the session.

`src/proxy.ts` (Next.js 16's renamed `middleware.ts`) touches the session on
every request so an expired access token is refreshed *before* the page renders.
`getSession()` only refreshes when the token is actually expired, so the steady
state costs no network round-trip.

---

## 2. Database design

Three tables, one view, two functions, one trigger.

### `profiles` — public identity (1:1 with `auth.users`)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | **PK** and FK → `auth.users(id)` `ON DELETE CASCADE` |
| `username` | `text` | `CHECK (~ '^[A-Za-z0-9_]{3,20}$')` |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` kept current by trigger |

The primary key *is* the foreign key, which both guarantees one row per account
and enforces the relationship. Deleting the auth account cascades to the profile
and, through it, to progression and scores — no orphan rows.

Email and password live **only** in `auth.users` and are never duplicated here,
so the public read policy cannot leak an address.

**Case-insensitive uniqueness:** a plain `UNIQUE` would allow `Neo` and `neo` to
coexist, so uniqueness is a functional index on `lower(username)`. The column
keeps its original casing for display.

### `player_progress` — persistent progression (1:1 with `profiles`)

| Column | Type | Notes |
|---|---|---|
| `profile_id` | `uuid` | **PK** and FK → `profiles(id)` `ON DELETE CASCADE` |
| `money` | `integer` | `CHECK (0..100000000)` |
| `xp` | `integer` | `CHECK (0..1000000000)` |
| `level` | `integer` | **GENERATED** from `xp` — never written directly |
| `upgrades` | `jsonb` | `CHECK (jsonb_typeof = 'object')` |
| `created_at` / `updated_at` | `timestamptz` | |

### `package_defs` — the server-owned reward catalog

| Column | Type | Notes |
|---|---|---|
| `id` | `text` | **PK** — the only package reference a client may supply |
| `name` | `text` | display only |
| `base_reward_credits` | `integer` | `CHECK (> 0 and <= 100000)` |
| `base_reward_xp` | `integer` | `CHECK (>= 0 and <= 100000)` |

Mirrors `src/game/data/deliveryData.ts`. The `> 0` CHECK matters: a zero or
negative payout row would let a courier farm XP on deliveries that pay nothing.
Public SELECT, but **no insert/update/delete policy for any client role** — the
catalog is server-owned, because if couriers could price their own deliveries
the whole recomputation collapses.

### `scores` — one row per delivery attempt

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` | **PK**, surrogate identity — rows are immutable events |
| `profile_id` | `uuid` | FK → `profiles(id)` `ON DELETE CASCADE` |
| `status` | `text` | `CHECK (in ('completed','failed'))` |
| `credits` / `xp` | `integer` | `CHECK (0..1000000)` — **written by the server only** |
| `score` | `integer` | **GENERATED** `credits + xp * 2` — never written directly |
| `time_seconds` | `numeric(10,3)` | `CHECK (0..86400)` |
| `package_id` | `text` | FK → `package_defs(id)` `ON DELETE SET NULL` |
| `claimed_credits` | `integer` | What the browser *asked* for. Audit only, never ranked |
| `created_at` | `timestamptz` | |

Plus a cross-column rule: `CHECK (status = 'failed' or credits > 0 or xp > 0)` —
a successful delivery always pays something; a failure never does.

A surrogate key is right here because rows are events with no natural key, and
clients never choose their own id.

### The write-path functions

| Function | Purpose | Security |
|---|---|---|
| `submit_delivery` | Price + record a completion | `security definer`, reads `auth.uid()`, accepts no id |
| `record_failure` | Record a failure | `security definer`, awards nothing |
| `recent_delivery_count` | Self-scoped count for rate limiting | `security definer`, pinned to `auth.uid()` |
| `leaderboard_page` | Offset pagination | `security invoker`, `limit` clamped to 50 |
| `username_available` | Pre-signup probe | `security invoker` (anon-safe by design) |

### Indexes

| Index | Serves |
|---|---|
| `profiles_username_lower_key` (unique, on `lower(username)`) | Case-insensitive uniqueness + availability probe |
| `scores_profile_id_idx` | **FK support** — Postgres does *not* index foreign keys automatically, so cascades would otherwise seq-scan |
| `scores_profile_created_idx` (`profile_id, created_at desc`) | "My recent deliveries" query |
| `scores_completed_score_idx` (partial, `score desc` where completed) | Backs the `max(score)` behind "Best Run" |
| PKs of all tables | Backing lookups and the `ON CONFLICT` upsert |

The partial index on `scores` is worth a note: because the leaderboard only ever
aggregates `status = 'completed'` rows, the index is restricted to those. Rows
for failures stay out of it entirely, which keeps the index small and stops the
board's `max()` from touching rows it will discard.

### `leaderboard` view

Aggregates every courier's completed deliveries into career totals **inside
Postgres**, so the client fetches a small page instead of downloading the whole
score history. Exposes only `username` and totals — never ids or emails.

| Column | Meaning |
|---|---|
| `rank` | `dense_rank()` by total score — ties genuinely share a rank |
| `total_score` | Career sum of the generated `score` column |
| `best_score` | The courier's single highest delivery |
| `deliveries` | Completed-delivery count |
| `last_delivery_at` | The "date" column on the board |

Ordering adds `username` as a tiebreaker, which is what makes offset pagination
*stable*: without a deterministic tiebreak a tied pair can appear on page 1 and
page 2 simultaneously. Couriers with no completed delivery are excluded, so the
board is never padded with empty ranks.

### RLS summary

| Table | anon | authenticated |
|---|---|---|
| `profiles` | SELECT | SELECT, UPDATE **own** (column-limited to `username`) |
| `player_progress` | — | SELECT **own** |
| `scores` | SELECT | SELECT |

No client INSERT/UPDATE/DELETE policy exists on `player_progress` or `scores`.
Both are reachable only through the validated paths: the `security definer` RPC
and the API route respectively.

Note `profiles` has **no INSERT policy** — rows come from the signup trigger
alone — and **no DELETE policy**, since accounts are removed through auth and
cascade via the foreign keys.

---

## 3. Setup

### 3.1 Create the project

1. <https://supabase.com/dashboard> → **New project**
2. Pick a region near your users (it cannot be changed later).
3. Save the database password — it is not recoverable via the UI.

### 3.2 Verify the environment

```bash
npm run supabase:check
```

Reads `.env.local` (**never printing a key value**) and confirms the public keys
are real rather than the example placeholders. Do this before the next step.

### 3.3 Apply the schema

Dashboard → **SQL Editor** → paste
`supabase/migrations/20260928090000_initial_schema.sql` → **Run**.

It is idempotent (`IF NOT EXISTS`, `OR REPLACE`, `DROP ... IF EXISTS` before
`CREATE POLICY`), so re-running is safe. Or via the CLI:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Re-run `npm run supabase:check` afterwards — it also probes every table, the view
and the RPC, and lists anything still missing. This step matters: valid keys
with no schema look exactly like a connected app right up until the first query
fails with `PGRST205`.
---


### 3.4 Environment variables

```bash
cp .env.local.example .env.local
```

Dashboard → **Project Settings → API**, then fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server only — never commit
```

Note: newer projects label this `sb_publishable_…`; either name works, and the
check script accepts both. `.env.local` is gitignored — restart `npm run dev`
after editing.

### 3.5 Auth settings

Dashboard → **Authentication → Sign In / Providers → Email**:

- **Enable Email provider** — on.
- **Confirm email** — recommended on. Signup then shows a "check your inbox"
  state; the profile row is still created immediately by the trigger.
- Minimum password length — must match `MIN_PASSWORD_LENGTH` in
  `src/lib/validation.ts` (default 6).

### 3.6 Generate types

The hand-written `src/lib/supabase/database.ts` works before the project exists.
Replace it with the canonical version once yours is live:

```bash
npx supabase gen types typescript --project-id <project-ref> > src/lib/supabase/database.ts
```

Then re-apply the two documented refinements (the `status` literal union and
`Record<string, number>` for `upgrades`) — they are marked in the file header.

---

## 4. What talks to what

| Read/Write | Path | Key | Gate |
|---|---|---|---|
| Career load | `player_progress` select | anon (server) | RLS: own row only |
| Career save | `save_player_progress` RPC | anon (browser) | `security definer` + `auth.uid()` |
| Board read | `leaderboard_page` RPC | anon (server) | `security invoker`, limit capped at 50 |
| Price lookup | `package_defs` select | anon (server) | public read, **no client write** |
| Delivery write | `submit_delivery` RPC | anon (server) | `security definer`, payout recomputed |
| Failure write | `record_failure` RPC | anon (server) | `security definer`, awards nothing |
| Sign in/up/out | Server Actions | anon (server) | Supabase Auth + httpOnly cookies |

**No client-side write touches a table directly.** Career saves, deliveries and
failures all go through validated RPCs. The service-role key is no longer used
anywhere in the request path — `/api/scores` writes through the caller's own
JWT, so the privileged credential has *zero* runtime callers. It exists only for
admin/one-off scripts, which is the smallest possible blast radius.

### Why saves are absolute, not deltas

Each save overwrites the whole career row (an upsert). The alternative —
"+50 credits" deltas — is a classic lost-update bug: two tabs open at once would
each apply their delta to a stale base and one payout would vanish. Absolute
writes are idempotent and converge on whatever the client most recently saw.
This is also why `useProgressionSync` can safely debounce: a superseded snapshot
is simply replaced by a newer complete one.

---

## 5. Why client-side score validation alone is insecure

This is the most important section of this document, so it is worth being
precise about *why* — not just "don't trust the client".

### The trap: a bound is not a proof

The obvious way to submit a score is to send the numbers and check them:

```ts
if (body.credits < 0 || body.credits > 1_000_000) return badRequest();
```

Every one of those requests passes. The check constrains the *range* of a claim;
it says nothing about whether the claim is **true**. A player with the browser
devtools open can send `credits: 1000000` a thousand times, and the server would
happily record a million-credit delivery every time — a perfectly valid payload
by the rules the server itself defined.

The flaw is structural, not a missing check. **The client is the attacker.** It
runs on hardware the player controls, and every line of validation that executes
there can be deleted, patched, or bypassed by not running it at all. Client-side
validation is not a weaker version of server-side validation; it is not a
version of it. It is a user-experience feature that happens to be free.

### The fix: make the claim unnecessary

The design principle is: **if the server can compute the answer, the server must
compute the answer.** Then the client's contribution stops being a claim and
becomes a *reference* — and references can be verified.

For a delivery, the server already owns everything needed to price it:

| Input | Who owns the truth |
|---|---|
| which package was delivered | `package_defs` — a server-side table |
| how fast it was completed | `timeRatio`, a 0..1 fraction |
| the courier's payout multiplier | their own `player_progress.upgrades` |

So the exact award is deterministic:

```sql
base     := package_defs.base_reward_credits
bonus    := round(base * 0.5 * time_ratio)
credits  := round((base + bonus) * multiplier_from_own_upgrades)
xp       := package_defs.base_reward_xp     -- never multiplied
score    := credits + xp * 2               -- GENERATED column
```

A forged request can now forge only `packageId` and `timeRatio`, and both are
bounded by construction: the id must exist in a closed set, and the ratio is
clamped to `0..1` and used in a *monotonic* formula. The worst case of a
maximally dishonest client is the score a **perfect run** would have earned — not
an arbitrary number.

### Defence in depth

Each layer alone would be insufficient; together they cover different attacks:

1. **`scores` has no client INSERT grant and no write policy.** Even a perfect
   forgery cannot reach the table directly. It must go through the RPC.
2. **`submit_delivery` is `SECURITY DEFINER` and reads `auth.uid()`.** It accepts
   no id argument, so one courier can only ever write their own row.
3. **Payouts are recomputed, not accepted.** The core fix above.
4. **`score` is a GENERATED column.** The board ranks a number Postgres derived
   from the credits and XP the server itself wrote. A client cannot name a score.
5. **Rate limiting via `recent_delivery_count`.** Recomputation stops inflating
   one delivery but not calling the function in a loop; a legitimate high-value
   package submitted thousands of times is a separate threat with its own guard.
6. **`claimed_credits` audit column.** Records what the browser asked for. A gap
   between the claim and the award is a strong cheat signal, which makes
   cheating *detectable* even though it is not fully preventable.
7. **Column-level grants.** `profiles` grants `UPDATE (username)` only, so even
   an owner cannot rewrite their `id` or `created_at`.

### What is still not proven

Honesty about the limits, because a security section that oversells itself is
worse than none:

- **The client still reports the outcome.** The server verifies *pricing*, not
  *play*. A modified client could call `submit_delivery` with `timeRatio: 1`
  without ever driving a bike, and be paid for a perfect run. Proving the run
  really happened needs an authoritative server simulation or input attestation
  — expensive, and out of scope for an arcade game.
- **The rate limit is a simple rolling count**, not a distributed limiter. It
  is per-courier and adequate against a casual flooder, not a determined one
  running many accounts.
- **The free tier has no edge rate limiting**, so these are the only brakes.

The bar this design clears: *a player cannot manufacture a score from nothing.*
What remains is "a player could lie about how well they played", which is a
much smaller and more tractable problem.

### The client-side mirror

`src/lib/scoring/delivery.ts` computes the same numbers so the HUD can show the
award instantly. It is a **predictor**; the server is the **judge**. When they
disagree the server wins, and the discrepancy shows up as a gap between
`claimed_credits` and `credits`. Nothing downstream trusts this module, so a
mismatch is a consistency bug, never a security hole — and the shared constants
are pinned by unit tests to keep it that way.

---

## 6. Free-tier limits

| Resource | Free limit | How this app stays inside it |
|---|---|---|
| Database size | 500 MB | 3 tables + 1 view; `scores` is the only unbounded one |
| Rows read / egress | 5 GB/month | Board is an aggregated **view**; each page is one capped query (max 50 rows), not the whole table |
| API requests | 50k MAU | Progression saves are **debounced 1.5 s**; deliveries post once per run, and the rate limiter caps it at 20/min |
| Auth MAU | 50,000 | — |
| Storage | 1 GB | Unused |
| Realtime | 2 concurrent + 200 MB | **Not used** — see below |
| Pause after inactivity | 1 week | Expected; Supabase asks for a card on upgrade |

**Realtime is deliberately omitted.** Subscribing the board to live updates is
the natural next step, but a passive page holding an open connection consumes
the concurrent-connection quota (free: 2) for every visitor. The board is read
per request instead, which is correct for a low-traffic game.

**Pagination is offset-based, on purpose.** Offset paging has the known weakness
that a new high score shifts every later row by one, so a row can be duplicated
or skipped if you page while the board changes. That is acceptable here: the
board is a browsing surface, not a ledger, and a keyset cursor would need a
stable tiebreak across `total_score` **plus** `username` (ties share a rank via
`dense_rank`). The SQL clamps `limit` to 50 so a caller cannot pull the whole
table and burn the egress quota in one request.

**`countLeaderboardEntries()` uses `head: true` with an exact count.** That is a
`COUNT(*)` over the view on every page load. Cheap while the board is small, but
it is the first thing to revisit if the board grows to thousands of couriers —
at that point an approximate count or a cached total would be better.

**The free tier is a demo tier, not an anti-cheat.** There is no per-endpoint
rate limiter. Score forging is bounded but not prevented: the
`scores_credits_range` CHECK caps a single row and the API route requires a
session, but a user with a valid account can still submit plausible-looking
values. Real anti-cheat needs server-side attestation or rate limiting, both of
which cost money. Acceptable while the game is single-player-with-a-leaderboard;
worth revisiting before any prize is on the line.

`scores` is the one table that grows without bound. If a title ever approaches
the 500 MB ceiling, archive old rows or move raw history to Cold Storage, keeping
only the aggregate in `leaderboard`.

---

## 7. Verifying the install

```bash
npm run supabase:check   # env + schema, prints exactly what is missing
npm run typecheck        # tsc --noEmit
npm test                 # 213 unit tests
npm run lint
npm run build
```

Then, in the app:

1. `/login` → register a call-sign.
2. Confirm the email if required, then sign in.
3. Play a delivery → `scores` gains a row, `player_progress` gains credits/XP.
4. `/leaderboard` shows your call-sign, score, best run, runs and last-active date.
5. Page through with `?page=2`; the rank shown is the true global rank, not the page offset.
6. Sign out, sign back in → rank, wallet and garage are all still there.

### Verifying the anti-cheat behaviour

Worth doing once, because it is the claim the design rests on:

```sql
-- As the courier: a forged maximum looks like a PERFECT RUN, not a windfall.
select credits, xp, score, claimed_credits
from public.scores
order by id desc limit 5;
```

`score` should equal `credits + xp * 2` every time, and `claimed_credits` should
sit near `credits`. A large gap between the two is the audit signal that a client
is claiming more than the server would award.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Database is not set up yet…` | Migration not applied | §3.3 — run the SQL |
| `permission denied for table …` in the check | **Expected** — the object exists but anon is denied | Nothing; read the line as a pass |
| `could not find the table/function` in the check | Object genuinely missing | §3.3 — run the migration |
| `UPLINK NOT CONFIGURED` on `/login` | Public keys missing/placeholder | §3.2, then restart dev |
| `/api/scores` returns 503 | Service key missing/placeholder | §3.4 — server-only key |
| Signup succeeds, no rows appear | Email confirmation still pending | Confirm, then sign in |
| Leaderboard stays empty | No completed deliveries yet | Play a delivery first |

### Reading `npm run supabase:check` output

The check runs unauthenticated, so it distinguishes two failures that look
similar but mean opposite things:

| Output | Meaning |
|---|---|
| `✓ … (public read, as expected)` | Object exists and `anon` may read it, per the migration |
| `✓ … exists and is locked to signed-in users` | Object exists and correctly **denies** `anon` |
| `✗ … missing — migration not applied` | The object genuinely does not exist |
| `✗ … is readable by ANON` | A security regression — a private table is public |

`player_progress` will always report the *locked* line, because the migration
grants `SELECT` to `authenticated` only and revokes it from `anon`. That denial
is the RLS policy working. It also means the check script cannot verify that
table's contents — do that by loading `/profile` while signed in.


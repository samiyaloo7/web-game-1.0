-- ============================================================================
-- Neon Courier — leaderboard, authoritative scoring, and pagination
-- ----------------------------------------------------------------------------
-- Why this migration exists
-- ------------------------
-- Step 9's `scores` table let the client POST `credits`/`xp` directly. The route
-- bounded them, but a bound is not a proof: a courier could post
-- `credits: 1000000` repeatedly and sit at the top of the board. Bounding a
-- lie still permits the lie.
--
-- The fix is to make the *server* recompute the payout from facts it already
-- holds, so the client's contribution stops being a claim and becomes a
-- reference:
--
--   * which package was delivered  -> `package_defs` (server-owned catalog)
--   * how fast                     -> `time_ratio` (a 0..1 fraction, bounded)
--   * which payout multiplier     -> the courier's OWN `player_progress.upgrades`
--
-- Given those three, the exact credit award is a deterministic function. The
-- client cannot inflate it, because the two inputs it *can* forge (a package id
-- and a time ratio) are drawn from a closed set and a 0..1 range, and the
-- multiplier is read from the database rather than the request.
--
-- Concretely this migration:
--   1. adds `package_defs` — the server's own copy of the reward catalog,
--   2. adds a GENERATED `score` column so ranking is not a client number,
--   3. adds `submit_delivery()`, the single validated write path,
--   4. adds `leaderboard_page()` for keyset-free offset pagination with ranks.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. package_defs — the server-owned reward catalog
--
-- Mirrors `src/game/data/deliveryData.ts`. Keeping a copy in the database is
-- what lets the server price a delivery without trusting the browser: the
-- client's `packageId` is only ever a *lookup key* into this table, never a
-- source of a number.
--
-- The `check (base_reward_credits > 0)` matters: a zero or negative payout row
-- would let a courier farm XP on deliveries that pay nothing.
-- ---------------------------------------------------------------------------
create table if not exists public.package_defs (
  id text primary key,
  name text not null,
  base_reward_credits integer not null
    constraint package_defs_credits_positive check (base_reward_credits > 0 and base_reward_credits <= 100000),
  base_reward_xp integer not null
    constraint package_defs_xp_nonnegative check (base_reward_xp >= 0 and base_reward_xp <= 100000)
);

insert into public.package_defs (id, name, base_reward_credits, base_reward_xp)
values
  ('pkg_neural_chip',  'Neural Coprocessor V4',     120, 45),
  ('pkg_cryo_serum',   'Cryogenic Regen Serum',     160, 60),
  ('pkg_power_core',   'Hyper-Capacitor Core',      210, 80),
  ('pkg_data_drive',   'Encrypted Syndicate Drive',  95, 35)
on conflict (id) do update
  set name = excluded.name,
      base_reward_credits = excluded.base_reward_credits,
      base_reward_xp = excluded.base_reward_xp;

alter table public.package_defs enable row level security;

-- Public read: a client may see what a package is worth (it already shows the
-- reward in the HUD), but there is deliberately NO insert/update/delete policy
-- for any role below `service_role`. The catalog is server-owned: if couriers
-- could price their own deliveries, the whole recomputation collapses.
drop policy if exists package_defs_public_read on public.package_defs;
create policy package_defs_public_read
  on public.package_defs for select
  to anon, authenticated
  using (true);

grant select on public.package_defs to anon, authenticated;
revoke insert, update, delete on public.package_defs from anon, authenticated;
grant all on public.package_defs to service_role;

-- ---------------------------------------------------------------------------
-- 2. scores: generated `score` + an audit trail of what the client claimed
--
-- `score` is GENERATED, so it is computed by Postgres from the credits/xp the
-- server wrote. A client cannot set it, which means the leaderboard ranks a
-- number the database derived rather than one the browser supplied.
--
-- The formula is `credits + xp * 2`, matching the session score the HUD shows.
-- It lives in exactly one place (this column) so the board and the HUD can never
-- quietly disagree.
--
-- `claimed_credits` records what the browser *asked* for. It is kept for
-- fraud analysis (a large gap between claim and award is a strong cheat signal)
-- and is intentionally NOT what the board ranks.
-- ---------------------------------------------------------------------------
alter table public.scores
  add column if not exists score integer
    generated always as (credits + xp * 2) stored;

alter table public.scores
  add column if not exists package_id text
    references public.package_defs (id) on delete set null;

alter table public.scores
  add column if not exists claimed_credits integer
    constraint scores_claimed_nonnegative check (claimed_credits is null or claimed_credits >= 0);

-- Backing index for the "best single delivery" max() in the leaderboard view.
-- Without it Postgres would scan every score row of every courier on each page.
create index if not exists scores_completed_score_idx
  on public.scores (score desc)
  where status = 'completed';

-- ---------------------------------------------------------------------------
-- 3. leaderboard — the public ranking view, extended
--
-- Replaces the Step 9 aggregate with the columns the board needs:
--   rank            — dense_rank by total score, ties share a rank
--   best_score      — the courier's single highest delivery
--   last_delivery_at— "date" for the row
--   best_delivery_at— when that best run happened
--
-- `dense_rank` rather than `row_number` so two couriers with equal totals
-- genuinely tie (both #1) instead of one being arbitrarily ranked below the
-- other. Ordering is then made deterministic with username as a tiebreaker,
-- which matters for stable pagination — otherwise a tie can appear on page 1
-- and page 2 at once.
--
-- security_invoker (as in Step 9) keeps the caller's RLS in force.
-- ---------------------------------------------------------------------------
create or replace view public.leaderboard
with (security_invoker = on)
as
with per_player as (
  select
    p.id                                   as profile_id,
    p.username                             as username,
    count(*) filter (where s.status = 'completed')::integer as deliveries,
    coalesce(
      sum(s.score) filter (where s.status = 'completed'),
      0
    )::bigint                             as total_score,
    coalesce(
      sum(s.credits) filter (where s.status = 'completed'),
      0
    )::bigint                             as total_credits,
    coalesce(
      max(s.score) filter (where s.status = 'completed'),
      0
    )::integer                            as best_score,
    max(s.created_at)                      as last_delivery_at,
    (max(s.score) filter (where s.status = 'completed')
      is not null)                        as has_deliveries
  from public.profiles p
  left join public.scores s on s.profile_id = p.id
  group by p.id, p.username
)
select
  dense_rank() over (order by total_score desc, username asc)::integer as rank,
  profile_id,
  username,
  deliveries,
  total_score,
  total_credits,
  best_score,
  last_delivery_at
from per_player
-- A courier with no completed delivery has nothing to rank. `has_deliveries`
-- is false for them (max() over zero rows is NULL) and they are excluded so the
-- board is not padded with empty ranks; `profile_id` is still exposed so the
-- page can tell a signed-in courier "you have not scored yet".
where has_deliveries;

-- ---------------------------------------------------------------------------
-- 4. submit_delivery — THE only write path for scores
--
-- This is where the trust boundary lives. The client supplies three things, and
-- every one of them is a *reference* rather than an assertion:
--
--   p_package_id  — a key into `package_defs`. Unknown ids are rejected, and
--                   the payout is read from the table, never from the request.
--   p_time_ratio  — how much of the timer was left, a 0..1 fraction. The credit
--                   formula is monotonic in it, so the worst case of a forged
--                   1.0 is a full speed bonus on an already-priced package —
--                   not an arbitrary number.
--   p_duration    — wall-clock seconds, bounded to one hour.
--
-- Everything else is derived:
--   base credits  <- package_defs
--   time bonus    <- base * 0.5 * p_time_ratio
--   multiplier    <- the caller's OWN player_progress.upgrades, re-derived with
--                    the same caps the game enforces
--   credits       <- (base + bonus) * multiplier
--   xp            <- package_defs (never multiplied, matching the game)
--   score         <- the GENERATED column
--
-- The function reads `auth.uid()` and never accepts an id, so a courier can only
-- ever write their own row. It is SECURITY DEFINER so it can write despite the
-- caller holding no INSERT grant on `scores`.
--
-- `p_claimed_credits` is recorded purely for fraud analytics.
-- ---------------------------------------------------------------------------
create or replace function public.submit_delivery(
  p_package_id text,
  p_time_ratio numeric,
  p_duration_seconds numeric,
  p_claimed_credits integer default null
)
returns table (
  score_id bigint,
  credits integer,
  xp integer,
  score integer,
  is_new_best boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_def public.package_defs%rowtype;
  v_multiplier numeric := 1;
  v_time_ratio numeric;
  v_base integer;
  v_bonus integer;
  v_credits integer;
  v_xp integer;
  v_awarded_score integer;
  v_new_id bigint;
  v_previous_best integer;
  v_multiplier_levels integer := 0;
begin
  -- 1. Authentication. Supabase verifies the JWT before Postgres sees the call,
  --    so a null uid here means "no valid session".
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- 2. Unknown package: the single most important rejection. Accepting it would
  --    let a caller invent a payout by guessing ids.
  select * into v_def from public.package_defs where id = p_package_id;
  if not found then
    raise exception 'unknown package: %', p_package_id;
  end if;

  -- 3. Clamp the ratio into 0..1 rather than rejecting out-of-range values.
  --    Clamping means a buggy or tampered client degrades to a legitimate score
  --    instead of losing a legitimate run, and it cannot exceed the cap because
  --    anything above 1 becomes exactly 1.
  v_time_ratio := least(1, greatest(0, coalesce(p_time_ratio, 0)));

  -- 4. Duration is informational, so bound it and never let it distort the
  --    payout (it is not part of the award formula).
  if p_duration_seconds is not null
     and (p_duration_seconds < 0 or p_duration_seconds > 3600) then
    raise exception 'duration out of range';
  end if;

  -- 5. Read the caller's OWN payout multiplier from their stored upgrades.
  --    Level 5 of the broker licence is +0.2 each => 2.0, capped at 3x, matching
  --    `computeEffectiveStats` on the client. The client cannot declare a higher
  --    one because it is not an input here at all.
  select coalesce(sum(c.upgrade_level), 0) into v_multiplier_levels
  from jsonb_each_text(
    (select upgrades from public.player_progress where profile_id = v_uid)
  ) as t(upgrade_id, upgrade_level_text)
  cross join lateral (
    select case
      when t.upgrade_id = 'upgrade_broker_license'
       and t.upgrade_level_text ~ '^[0-9]{1,2}$'
      then least(5, t.upgrade_level_text::integer)
      else 0
    end as upgrade_level
  ) c;

  -- `greatest(1, ...)` guards a corrupt jsonb value of -1, which would otherwise
  -- *reduce* the payout below the package's base price.
  v_multiplier := least(3, greatest(1, 1 + 0.2 * v_multiplier_levels));

  -- 6. Price the delivery. Same shape as the client's `applyRewardMultiplier`,
  --    deliberately: the server is the authority and the client is a mirror.
  v_base := v_def.base_reward_credits;
  v_bonus := round(v_base * 0.5 * v_time_ratio);
  v_credits := round((v_base + v_bonus) * v_multiplier);
  v_xp := v_def.base_reward_xp;

  -- Guard the arithmetic itself. For the shipped catalog the maximum is
  -- 210 * 1.5 * 3 = 945, so a breach means the catalog was edited — refusing is
  -- safer than storing it.
  if v_credits > 1000000 or v_xp > 1000000 then
    raise exception 'computed award out of range';
  end if;

  -- 7. Capture the previous best BEFORE inserting, so the new-best flag compares
  --    against the real prior record rather than the row just written.
  --
  --    `prev.` is load-bearing, not decoration: `score` is also the name of an
  --    output column of this function (see RETURNS TABLE above), and plpgsql
  --    treats an output column name as a variable. A bare `max(score)` here would
  --    be ambiguous between that variable and `scores.score`, and plpgsql's
  --    default `variable_conflict = error` would refuse to run the function.
  select coalesce(max(prev.score), 0)::integer into v_previous_best
  from public.scores prev
  where prev.profile_id = v_uid and prev.status = 'completed';

  -- 8. Insert. `profile_id` comes from the session; the request cannot choose it.
  --
  --    The target is aliased `s` so the RETURNING list can be qualified. `credits`,
  --    `xp` and `score` are output column names of this function, which makes them
  --    plpgsql variables: a bare `returning credits, xp, score` would be ambiguous
  --    against the same-named columns of `scores` and refused. The column list and
  --    the VALUES clause need no qualification, because a name in the target column
  --    list is resolved as a column and is never substituted for.
  insert into public.scores as s (
    profile_id, status, credits, xp, time_seconds, package_id, claimed_credits
  )
  values (
    v_uid, 'completed', v_credits, v_xp,
    least(3600, greatest(0, coalesce(p_duration_seconds, 0))),
    p_package_id,
    greatest(0, p_claimed_credits)
  )
  returning s.id, s.credits, s.xp, s.score
    into v_new_id, v_credits, v_xp, v_awarded_score;

  return query
    select v_new_id, v_credits, v_xp, v_awarded_score, (v_awarded_score > v_previous_best);
end;
$$;

-- SECURITY DEFINER functions run as their owner, which makes them executable by
-- PUBLIC the moment they are created — revoke that, then grant only to
-- signed-in callers.
revoke execute on function public.submit_delivery(text, numeric, numeric, integer)
  from public, anon;
grant execute on function public.submit_delivery(text, numeric, numeric, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. record_failure — failed deliveries
--
-- Kept separate from `submit_delivery` because a failure awards nothing, so
-- there is nothing to price and therefore nothing to trust. The only inputs are
-- a package id (for the record) and a duration.
-- ---------------------------------------------------------------------------
create or replace function public.record_failure(
  p_package_id text default null,
  p_duration_seconds numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_new_id bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_duration_seconds is not null
     and (p_duration_seconds < 0 or p_duration_seconds > 3600) then
    raise exception 'duration out of range';
  end if;

  -- credits/xp stay 0, which satisfies `scores_paid_when_completed`.
  insert into public.scores (profile_id, status, credits, xp, time_seconds, package_id)
  values (
    v_uid, 'failed', 0, 0,
    least(3600, greatest(0, coalesce(p_duration_seconds, 0))),
    nullif(p_package_id, '')
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke execute on function public.record_failure(text, numeric) from public, anon;
grant execute on function public.record_failure(text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. leaderboard_page — offset pagination carrying true global ranks
--
-- Returns one page of the board, and nothing else. It deliberately does NOT also
-- return a total row count: the ranking view is a GROUP BY over every score row,
-- so counting it here would aggregate the whole population on every page
-- request just to render "Page x of y". The page does that separately and
-- cheaply, with a HEAD count against the view
-- (`countLeaderboardEntries` in src/lib/leaderboard/server.ts).
--
-- SECURITY INVOKER (the default) so the caller's RLS on `scores`/`profiles`
-- still applies — the board shows exactly what an anonymous read of the view
-- would show. That is deliberate: the leaderboard is public by design.
--
-- The bounds are clamped rather than trusted, because a caller asking for
-- `limit: 1000000` would otherwise be a cheap way to pull the whole table and
-- burn the project's free-tier egress quota. Max 50 keeps one page small.
--
-- The `rank` in the result is the TRUE global rank (from the view), not the
-- page offset — so page 3 correctly shows "#23" rather than restarting at 1.
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard_page(
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  rank integer,
  profile_id uuid,
  username text,
  deliveries integer,
  total_score bigint,
  total_credits bigint,
  best_score integer,
  last_delivery_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- `lb.` keeps the ORDER BY independent of the function's own output column
  -- names, which are in scope for a SQL function just as they are for plpgsql.
  with page as (
    select *
    from public.leaderboard lb
    order by lb.total_score desc, lb.username asc
    limit least(50, greatest(1, coalesce(p_limit, 25)))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    page.rank,
    page.profile_id,
    page.username,
    page.deliveries,
    page.total_score,
    page.total_credits,
    page.best_score,
    page.last_delivery_at
  from page;
$$;

revoke execute on function public.leaderboard_page(integer, integer) from public;
grant execute on function public.leaderboard_page(integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. recent_delivery_count — the anti-spam primitive
--
-- Recomputing payouts stops a courier from inflating ONE delivery. It does not
-- stop them calling the function in a loop: a legitimate 1,000-credit package
-- submitted 10,000 times is still 10,000,000 credits. Cheap to prevent, so the
-- route checks this before writing.
--
-- SECURITY DEFINER because the caller must not be able to read other couriers'
-- rows; the WHERE clause pins it to `auth.uid()` so it is a self-count.
--
-- `stable` not `volatile`: it is a read, and letting the planner cache it within
-- a statement is correct.
-- ---------------------------------------------------------------------------
create or replace function public.recent_delivery_count(
  p_within_seconds integer default 60,
  p_limit integer default 20
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.scores
  where profile_id = auth.uid()
    and created_at > now() - make_interval(secs => greatest(1, least(600, p_within_seconds)));
$$;

revoke execute on function public.recent_delivery_count(integer, integer) from public, anon;
grant execute on function public.recent_delivery_count(integer, integer) to authenticated;


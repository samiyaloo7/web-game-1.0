-- ============================================================================
-- Neon Courier — daily challenges
-- ----------------------------------------------------------------------------
-- Why this migration exists
-- ------------------------
-- A daily challenge is a rotating objective shared by every courier for one UTC
-- calendar day ("Deliver 5 packages in under 3 minutes"). The challenge itself is
-- NOT stored: it is *derived* from the day index by the same deterministic
-- generator on both sides of the wire (`src/game/systems/DailyChallenge.ts`).
-- Deriving it means the server never has to publish a row, and "what was
-- Tuesday's challenge?" is answerable forever without keeping a history table of
-- definitions.
--
-- What must be stored is the courier's *result*: how far they got, when they
-- finished, and whether the reward has been paid. That is this table.
--
-- Two clocks matter here, and both are the server's:
--   * which day a challenge belongs to — decided by the route from ITS clock and
--     passed in as `p_day_index`; the browser never supplies a date.
--   * when a row was completed/claimed — `now()` inside the database.
--
-- The one client-supplied number is `p_progress`, and it is clamped to the
-- objective's own range before storage. A forged counter can reach the target and
-- no further, and the reward is the generator's, not the request's — the same
-- "optimistic gameplay, bounded exposure" model as `submit_delivery` (see
-- `ARCHITECTURE.md` §12).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. daily_challenge_progress — one row per courier per challenge
--
-- The primary key is (profile_id, challenge_id) rather than an id column: a
-- courier can only ever have one result for a given day, and that is a fact the
-- schema can state rather than something the application must remember. It also
-- makes the write path idempotent — a retried POST cannot create a duplicate.
--
-- `challenge_id` carries the UTC date so a row is self-describing in a query
-- window, and the CHECK pins the format the generator produces. `day_index` is
-- kept alongside it because ordering history by an integer is cheaper than
-- parsing dates, and because it is the value the client's route compared against.
--
-- `title`/`description`/`window_seconds`/`reward_*` are SNAPSHOTS of the day's
-- challenge as it was generated. History therefore stays faithful even if the
-- generator's templates are edited later — the same reason a receipt records the
-- price paid rather than re-pricing on read.
-- ---------------------------------------------------------------------------
create table if not exists public.daily_challenge_progress (
  profile_id uuid not null
    references public.profiles (id) on delete cascade,
  challenge_id text not null
    constraint daily_challenge_progress_challenge_id_format
    check (challenge_id ~ '^dc_[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  day_index integer not null
    constraint daily_challenge_progress_day_index_range check (day_index >= 0),
  metric text not null
    constraint daily_challenge_progress_metric_known
    check (metric in ('deliveries', 'credits', 'xp')),
  target integer not null
    constraint daily_challenge_progress_target_positive check (target > 0),
  window_seconds integer not null default 0
    constraint daily_challenge_progress_window_nonnegative check (window_seconds >= 0),
  title text not null default '',
  description text not null default '',
  reward_credits integer not null default 0
    constraint daily_challenge_progress_reward_credits_nonnegative
    check (reward_credits >= 0),
  reward_xp integer not null default 0
    constraint daily_challenge_progress_reward_xp_nonnegative
    check (reward_xp >= 0),
  progress integer not null default 0
    constraint daily_challenge_progress_progress_nonnegative check (progress >= 0),
  completed_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, challenge_id),
  -- A progress counter past its target is meaningless; the RPC clamps, and this
  -- CHECK is the backstop if the RPC is ever bypassed.
  constraint daily_challenge_progress_progress_within_target check (progress <= target),
  -- Paying a reward for an incomplete objective must be impossible by shape.
  constraint daily_challenge_progress_claimed_implies_completed
    check (claimed_at is null or completed_at is not null)
);

-- History and "today's row" are both `profile_id + recent day` lookups.
create index if not exists daily_challenge_progress_profile_day_idx
  on public.daily_challenge_progress (profile_id, day_index desc);

-- ---------------------------------------------------------------------------
-- 2. updated_at maintenance — reuse the shared trigger function
-- ---------------------------------------------------------------------------
drop trigger if exists daily_challenge_progress_set_updated_at
  on public.daily_challenge_progress;
create trigger daily_challenge_progress_set_updated_at
  before update on public.daily_challenge_progress
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS + GRANTS — own-row reads, no client writes at all
--
-- As with `player_progress`, there is deliberately no INSERT/UPDATE policy and no
-- write grant: `record_challenge_progress()` below is the single write path, and
-- it derives the owner from `auth.uid()` rather than accepting an id.
-- ---------------------------------------------------------------------------
alter table public.daily_challenge_progress enable row level security;

drop policy if exists daily_challenge_progress_select_own
  on public.daily_challenge_progress;
create policy daily_challenge_progress_select_own
  on public.daily_challenge_progress for select
  to authenticated
  using (profile_id = (select auth.uid()));

revoke all on public.daily_challenge_progress from anon, authenticated;
grant select on public.daily_challenge_progress to authenticated;
grant all on public.daily_challenge_progress to service_role;

-- ---------------------------------------------------------------------------
-- 4. record_challenge_progress — THE only write path
--
-- Called by POST /api/challenges, which has already:
--   * derived the current day from the SERVER clock,
--   * regenerated the day's challenge deterministically, and
--   * rejected a request whose `dayIndex` no longer matches (a midnight rollover).
--
-- The route therefore supplies the generator's own numbers for `p_target`,
-- `p_reward_*`, `p_title` and `p_description`; the only value that comes from the
-- browser is `p_progress`, and it is clamped to `0..p_target` here.
--
-- Reaching the target completes AND claims in the same write: a daily reward is
-- not a shopping decision, so there is nothing for a second click to add. The
-- claim is stamped with `now()` — the database's clock, never the client's — and
-- `coalesce` makes the transition happen exactly once, however many times the
-- route retries.
--
-- `return query` reports the stored row plus `newly_claimed`, so the client knows
-- whether THIS call is the one that should pay the reward into the local career.
-- A reload re-reads the row, sees `newly_claimed = false`, and does not pay twice.
--
-- SECURITY DEFINER (it writes a table clients cannot) and `set search_path = ''`
-- (a hijacked search path must not be able to redirect the table references).
-- The function reads `auth.uid()` and takes no owner argument, so it can only
-- ever write the caller's own row.
-- ---------------------------------------------------------------------------
create or replace function public.record_challenge_progress(
  p_challenge_id text,
  p_day_index integer,
  p_metric text,
  p_target integer,
  p_window_seconds integer,
  p_title text,
  p_description text,
  p_reward_credits integer,
  p_reward_xp integer,
  p_progress integer
)
returns table (
  challenge_id text,
  day_index integer,
  progress integer,
  target integer,
  completed boolean,
  claimed boolean,
  newly_claimed boolean,
  reward_credits integer,
  reward_xp integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_progress integer;
  v_previous_claimed timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_target is null or p_target <= 0 then
    raise exception 'invalid challenge target' using errcode = '22023';
  end if;

  if p_metric is null or p_metric not in ('deliveries', 'credits', 'xp') then
    raise exception 'unknown challenge metric' using errcode = '22023';
  end if;

  -- Whether a reward was already paid BEFORE this call. Read first because the
  -- upsert below can only tell us the resulting state, not the transition.
  select dcp.claimed_at
    into v_previous_claimed
    from public.daily_challenge_progress dcp
   where dcp.profile_id = v_uid
     and dcp.challenge_id = p_challenge_id;

  -- The counter is client-reported, so clamp it into the objective's own range.
  v_progress := greatest(0, least(coalesce(p_progress, 0), p_target));

  insert into public.daily_challenge_progress as dcp (
    profile_id,
    challenge_id,
    day_index,
    metric,
    target,
    window_seconds,
    title,
    description,
    reward_credits,
    reward_xp,
    progress,
    completed_at,
    claimed_at
  )
  values (
    v_uid,
    p_challenge_id,
    greatest(0, coalesce(p_day_index, 0)),
    p_metric,
    p_target,
    greatest(0, coalesce(p_window_seconds, 0)),
    coalesce(p_title, ''),
    coalesce(p_description, ''),
    greatest(0, coalesce(p_reward_credits, 0)),
    greatest(0, coalesce(p_reward_xp, 0)),
    v_progress,
    case when v_progress >= p_target then now() else null end,
    case when v_progress >= p_target then now() else null end
  )
  on conflict (profile_id, challenge_id) do update
    set progress = greatest(dcp.progress, excluded.progress),
        -- `coalesce` keeps the FIRST completion/claim timestamp: an old timestamp
        -- is the truth, and re-writing it on every progress report would be a lie.
        completed_at = coalesce(dcp.completed_at, excluded.completed_at),
        claimed_at = coalesce(dcp.claimed_at, excluded.claimed_at);

  return query
  select
    dcp.challenge_id,
    dcp.day_index,
    dcp.progress,
    dcp.target,
    dcp.completed_at is not null,
    dcp.claimed_at is not null,
    (dcp.claimed_at is not null and v_previous_claimed is null),
    dcp.reward_credits,
    dcp.reward_xp
  from public.daily_challenge_progress dcp
  where dcp.profile_id = v_uid
    and dcp.challenge_id = p_challenge_id;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on creation — claw it back. Only a
-- signed-in courier can reach the definer function.
revoke execute on function public.record_challenge_progress(
  text, integer, text, integer, integer, text, text, integer, integer, integer
) from public, anon;
grant execute on function public.record_challenge_progress(
  text, integer, text, integer, integer, text, text, integer, integer, integer
) to authenticated;

-- ============================================================================
-- Neon Courier — initial Supabase schema
-- ----------------------------------------------------------------------------
-- Design notes:
--  * Idempotent: safe to re-run from the Supabase SQL editor (tables use
--    IF NOT EXISTS, functions/views use OR REPLACE, triggers/policies are
--    dropped before creation). Also applies cleanly via `supabase db push`.
--  * Three tables, one view, as specified:
--      profiles        — 1:1 with auth.users (identity: username)
--      player_progress — 1:1 with profiles  (persistent progression)
--      scores          — 1:N delivery score rows (leaderboard source)
--  * Every table: primary key, foreign keys, timestamps, CHECK constraints,
--    explicit indexes where the engine cannot make them itself, and Row Level
--    Security enabled with least-privilege policies.
--  * Trust model:
--      anon / authenticated  → read what they need, write only through
--                               validated paths (triggers, RPC, API+service role)
--      service_role          → full bypass (server only, never in the browser)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. updated_at maintenance trigger
--
-- A TRIGGER is a function the database runs automatically when a table event
-- (INSERT/UPDATE) happens. Keeping `updated_at` honest in the database means no
-- client can forget to set it — and no client needs UPDATE rights on it.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. level_from_xp — an IMMUTABLE mirror of ProgressionMath.levelFromXp
--
-- xpToAdvance(level) = 100*level + 25*level*(level-1); rank is *derived* from
-- lifetime XP on both sides of the wire, so a client can never persist a level
-- it did not earn. IMMUTABLE lets this function feed a generated column (the
-- database then recomputes `level` whenever `xp` changes).
-- ---------------------------------------------------------------------------
create or replace function public.level_from_xp(p_xp bigint)
returns integer
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_level integer := 1;
  v_threshold bigint := 0;
  v_need bigint;
begin
  if p_xp is null or p_xp <= 0 then
    return 1;
  end if;

  while v_level < 100 loop
    v_need := 100::bigint * v_level + 25::bigint * v_level * (v_level - 1);
    if p_xp < v_threshold + v_need then
      exit;              -- same rule as the TS side: xp < next threshold → stop
    end if;
    v_threshold := v_threshold + v_need;
    v_level := v_level + 1;
  end loop;

  return v_level;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. profiles — public identity, 1:1 with auth.users
--
-- PRIMARY KEY: id doubles as the FOREIGN KEY to auth.users with ON DELETE
-- CASCADE, so deleting the auth account deletes the profile (and, through the
-- chain, progression and scores) — no orphan rows.
-- The email/password live only in auth.users; never duplicated here, so the
-- public read policy below can never leak an email address.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);

-- Case-insensitive uniqueness: a plain UNIQUE constraint would allow 'Neo' and
-- 'neo' to coexist, so a functional INDEX on LOWER(username) closes that hole
-- while the column keeps the original casing for display.
create unique index if not exists profiles_username_lower_key
  on public.profiles using btree (lower(username));

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. player_progress — persistent progression, 1:1 with profiles
--
-- PRIMARY KEY is the foreign key itself (profile_id): the constraint both
-- guarantees "one row per courier" and enforces the relationship to profiles.
-- `level` is a GENERATED column — stored and always recomputed by the database
-- from `xp`; it cannot be inserted into or updated directly.
-- ---------------------------------------------------------------------------
create table if not exists public.player_progress (
  profile_id uuid primary key
    references public.profiles (id) on delete cascade,
  money integer not null default 100
    constraint player_progress_money_range check (money >= 0 and money <= 100000000),
  xp integer not null default 0
    constraint player_progress_xp_range check (xp >= 0 and xp <= 1000000000),
  level integer generated always as (public.level_from_xp(xp)) stored,
  upgrades jsonb not null default '{}'::jsonb
    constraint player_progress_upgrades_object check (jsonb_typeof(upgrades) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists player_progress_set_updated_at on public.player_progress;
create trigger player_progress_set_updated_at
  before update on public.player_progress
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. scores — one row per delivery attempt (leaderboard + service record)
--
-- Surrogate BIGINT identity primary key: rows are immutable events with no
-- natural key, and clients never choose their own id.
-- ON DELETE CASCADE along the profile_id FK keeps referential integrity when
-- an account is removed — and that FK needs its own index, because Postgres
-- does NOT index foreign keys automatically: scores_profile_id_idx serves both
-- the join and the cascade scan.
-- ---------------------------------------------------------------------------
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  profile_id uuid not null
    references public.profiles (id) on delete cascade,
  status text not null default 'completed'
    constraint scores_status_value check (status in ('completed', 'failed')),
  credits integer not null default 0
    constraint scores_credits_range check (credits >= 0 and credits <= 1000000),
  xp integer not null default 0
    constraint scores_xp_range check (xp >= 0 and xp <= 1000000),
  time_seconds numeric(10, 3) not null default 0
    constraint scores_time_range check (time_seconds >= 0 and time_seconds <= 86400),
  created_at timestamptz not null default now(),
  -- A successful delivery always pays something; failures never do.
  constraint scores_paid_when_completed
    check (status = 'failed' or credits > 0 or xp > 0)
);

create index if not exists scores_profile_id_idx
  on public.scores (profile_id);
create index if not exists scores_profile_created_idx
  on public.scores (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. leaderboard — aggregated public view
--
-- A VIEW is a saved query: the leaderboard aggregation (group every courier's
-- completed deliveries into career totals) runs inside Postgres, so the client
-- fetches ONE small result set instead of downloading every score row.
-- SECURITY_INVOKER = ON makes the view run under the *caller's* RLS policies
-- (Supabase's historical default was the opposite — definer rights — which
-- silently bypassed RLS; always set this explicitly on PG15+).
-- Only non-sensitive columns are exposed: username + totals, never ids/emails.
-- ---------------------------------------------------------------------------
create or replace view public.leaderboard
with (security_invoker = on)
as
select
  p.username,
  count(*) filter (where s.status = 'completed')        as deliveries,
  coalesce(
    sum(s.credits) filter (where s.status = 'completed'),
    0
  )::bigint                                             as total_credits,
  max(s.created_at)                                      as last_delivery_at
from public.scores s
join public.profiles p on p.id = s.profile_id
group by p.id, p.username;

-- ---------------------------------------------------------------------------
-- 7. handle_new_user — provisioning trigger on auth.users
--
-- SECURITY DEFINER: the function runs with its OWNER's privileges (postgres),
-- which is what lets it insert into public tables during signup — while the
-- empty search_path + schema-qualified names stop hijacking via search_path.
-- Supabase Auth inserts into auth.users for us; this AFTER INSERT trigger
-- guarantees every account gets a profile + progression row atomically, so
-- "user without profile" states are impossible by construction.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');
begin
  -- Ignore malformed signup metadata rather than failing the whole signup;
  -- the fallback keeps the CHECK constraint and uniqueness rule intact.
  if v_username is not null and v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    v_username := null;
  end if;

  insert into public.profiles (id, username)
  values (new.id, coalesce(v_username, 'courier_' || left(new.id::text, 8)))
  on conflict (id) do nothing;

  insert into public.player_progress (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 8. username_available — pre-signup availability probe
--
-- SECURITY INVOKER (the default): it runs as the caller, so the anon key can
-- only learn what the public SELECT policy already exposes (existence of a
-- username — never emails or ids).
-- ---------------------------------------------------------------------------
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    p_username ~ '^[A-Za-z0-9_]{3,20}$'
    and not exists (
      select 1 from public.profiles where lower(username) = lower(p_username)
    );
$$;

-- ---------------------------------------------------------------------------
-- 9. save_player_progress — THE only write path for progression
--
-- An RPC (Remote Procedure Call) runs a database function over PostgREST:
-- .rpc('save_player_progress', {...}) from supabase-js.
-- SECURITY DEFINER + owner postgres ⇒ the function upserts even though clients
-- hold NO insert/update grants on the table and RLS has no write policy — the
-- security is concentrated in *this* validated function instead of scattered
-- across permissive policies.
--
-- Validation performed here (server-side, authoritative):
--   * authenticated (auth.uid() is not null — the JWT is verified by Supabase
--     before the request ever reaches Postgres),
--   * money/xp inside the same ranges as the CHECK constraints,
--   * upgrades is an object whose keys exist in UPGRADE_CATALOG and whose
--     levels are integers 0..5 (mirrors the client's maxLevel),
--   * `level` is NEVER accepted from the client — the generated column
--     recomputes it from xp (see level_from_xp).
-- ---------------------------------------------------------------------------
create or replace function public.save_player_progress(
  p_money integer,
  p_xp integer,
  p_upgrades jsonb
)
returns public.player_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_progress;
  v_key text;
  v_value text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_money is null or p_money < 0 or p_money > 100000000 then
    raise exception 'money out of range';
  end if;

  if p_xp is null or p_xp < 0 or p_xp > 1000000000 then
    raise exception 'xp out of range';
  end if;

  if p_upgrades is null or jsonb_typeof(p_upgrades) <> 'object' then
    raise exception 'upgrades must be an object';
  end if;

  for v_key, v_value in
    select key, value #>> '{}' from jsonb_each(p_upgrades)
  loop
    if v_key not in (
      'upgrade_thrusters', 'upgrade_reactive_plating',
      'upgrade_broker_license', 'upgrade_chrono_manifest'
    ) then
      raise exception 'unknown upgrade: %', v_key;
    end if;
    -- Split checks so the cast can never run before the regex guard.
    if v_value !~ '^[0-9]+$' then
      raise exception 'invalid level for upgrade %: %', v_key, v_value;
    end if;
    if v_value::integer < 0 or v_value::integer > 5 then
      raise exception 'invalid level for upgrade %: %', v_key, v_value;
    end if;
  end loop;

  -- Backfill safety net: accounts created before this migration existed get
  -- their profile row on first save (FK requires it to exist first).
  insert into public.profiles (id, username)
  values (v_uid, 'courier_' || left(v_uid::text, 8))
  on conflict (id) do nothing;

  insert into public.player_progress (profile_id, money, xp, upgrades)
  values (v_uid, p_money, p_xp, p_upgrades)
  on conflict (profile_id) do update
    set money = excluded.money,
        xp = excluded.xp,
        upgrades = excluded.upgrades,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ===========================================================================
-- 10. ROW LEVEL SECURITY
--
-- Two independent gates guard every query:
--   1) GRANTs  — table-level (and column-level) SQL privileges: what operations
--                the anon/authenticated roles may even attempt.
--   2) RLS     — `ENABLE ROW LEVEL SECURITY` makes policies the *second* gate:
--                even with SELECT granted, a query returns only rows whose
--                policy expression is true for this request's JWT identity.
-- Enabling RLS changes nothing by itself — with zero policies, EVERY row is
-- hidden. The owner (postgres) and service_role bypass RLS entirely by design,
-- which is exactly why the service key must never reach the browser.
-- ===========================================================================
alter table public.profiles enable row level security;
alter table public.player_progress enable row level security;
alter table public.scores enable row level security;

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read
  on public.profiles for select
  to anon, authenticated
  using (true);  -- usernames power the public leaderboard; the row has no email/id secrets beyond the uuid

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No INSERT policy: rows are created by the signup trigger only.
-- No DELETE policy: accounts are removed through auth, cascading via FKs.
-- The `(select auth.uid())` scalar subquery is a planner hint: it evaluates the
-- JWT claim once per statement instead of once per row.

drop policy if exists player_progress_select_own on public.player_progress;
create policy player_progress_select_own
  on public.player_progress for select
  to authenticated
  using (profile_id = (select auth.uid()));
-- No write policies: save_player_progress() (definer) is the only writer.

drop policy if exists scores_public_read on public.scores;
create policy scores_public_read
  on public.scores for select
  to anon, authenticated
  using (true);  -- leaderboard + own history are public by design
-- No INSERT/UPDATE/DELETE policy: scores are written exclusively by the
-- server-side API route (/api/scores) using the service-role key, after the
-- caller's session has been verified — clients cannot forge rows directly.

-- ===========================================================================
-- 11. GRANTS — least privilege, stated explicitly
--
-- Explicit grants/revokes make the migration deterministic across projects
-- whose `ALTER DEFAULT PRIVILEGES` history differs. Default: nothing.
-- ===========================================================================
grant usage on schema public to anon, authenticated, service_role;

-- profiles: read for everyone (leaderboard), column-limited update for owner.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (username) on public.profiles to authenticated;
-- ^ Column-level GRANT: even the owner policy only ever lets a client touch
--   `username` — id, created_at and updated_at are unreachable from a PATCH.

-- player_progress: own-row read; all writes go through the definer RPC.
revoke all on public.player_progress from anon, authenticated;
grant select on public.player_progress to authenticated;

-- scores: public read; no client-side writes at all.
revoke all on public.scores from anon, authenticated;
grant select on public.scores to anon, authenticated;
grant usage on sequence public.scores_id_seq to service_role;

-- service_role: full table access (used server-side only; bypasses RLS).
grant all on public.profiles to service_role;
grant all on public.player_progress to service_role;
grant all on public.scores to service_role;

-- Functions: Postgres grants EXECUTE to PUBLIC on creation — claw it back.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.level_from_xp(bigint) from public, anon, authenticated;
revoke execute on function public.save_player_progress(integer, integer, jsonb) from public, anon;
grant execute on function public.save_player_progress(integer, integer, jsonb) to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;





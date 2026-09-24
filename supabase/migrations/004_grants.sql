-- ============================================================================
-- DayPay Employer Version — migration 004: explicit table privileges
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- WHY THIS EXISTS
--   Migration 001 granted EXECUTE on the helper functions but never granted
--   anything on the tables themselves. It relied on Supabase's default
--   privileges to cover that, which is not guaranteed across projects.
--
--   The RLS harness did grant table privileges — but inside a transaction that
--   ends in ROLLBACK, so those grants were undone the moment the harness
--   finished. That means the harness proved the POLICIES are correct while
--   leaving the GRANTS exactly as they were.
--
--   The symptom of a missing grant is:
--
--     permission denied for table employees        (SQLSTATE 42501)
--
--   which looks like an authorisation failure but is really a missing grant.
--   RLS and GRANTs are separate layers: a policy decides WHICH ROWS you may
--   touch, a grant decides whether you may touch the TABLE at all. Both are
--   needed, and this file supplies the second.
--
-- WHY GRANTS HERE ARE SAFE
--   Granting table access does not expose any data. Every one of these tables
--   has Row Level Security enabled with a policy scoping it to the signed-in
--   user. The harness already demonstrated this: with grants in place, an
--   employee still saw only their own row, and a signed-out visitor saw zero.
--
--   Note the deliberate asymmetry below: `authenticated` gets write access,
--   `anon` gets NOTHING. An unauthenticated visitor has no business reading
--   this schema, and no policy is written for them.
-- ============================================================================

begin;

grant usage on schema public to anon, authenticated;

-- ── Tables: the signed-in role may read and write; RLS narrows it per row ──
grant select, insert, update, delete on
  public.employers,
  public.employees,
  public.employee_rate_periods,
  public.day_records,
  public.day_record_events
  to authenticated;

-- The legacy single-user table gets the same treatment.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'user_data'
  ) then
    execute 'grant select, insert, update, delete on public.user_data to authenticated';
  end if;
end $$;

-- ── Sequences ─────────────────────────────────────────────────────────────
-- day_record_events.id is a bigserial, so inserts need USAGE on its sequence.
-- The audit insert runs inside a SECURITY DEFINER trigger and therefore as the
-- table owner, but granting this makes the table usable directly too.
do $$
declare
  seq record;
begin
  for seq in
    select sequence_name from information_schema.sequences
    where sequence_schema = 'public'
  loop
    execute format('grant usage, select on sequence public.%I to authenticated', seq.sequence_name);
  end loop;
end $$;

-- ── Make the intent explicit for anything added later ─────────────────────
-- Default privileges only apply to objects created by the role that sets them.
-- The SQL Editor runs as `postgres`, which is the role that owns these tables,
-- so this covers future migrations too.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;

commit;

-- ============================================================================
-- Verify — run this afterwards. It should list a row per table with all four
-- privileges for `authenticated`:
--
--   select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privs
--   from information_schema.role_table_grants
--   where grantee = 'authenticated' and table_schema = 'public'
--   group by table_name
--   order by table_name;
-- ============================================================================

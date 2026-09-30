-- ============================================================================
-- 016 — WHICH SESSION THE WORKER IS TOLD ABOUT
-- ============================================================================
-- This is the HALF OF MIGRATION 010 THAT YOUR DATABASE IS MISSING, and it is
-- deliberately not all of 010.
--
-- WHAT 010 DID, AND WHAT IS ALREADY DONE
--
-- 010 fixed one ordering bug in two functions:
--
--   1. check_in_with_code()      — match the code against EVERY live session
--                                  that covers the worker, in a defined order.
--   2. my_attendance_status()    — the same defined order, so the worker is
--                                  told about the right session.
--
-- Part 1 is ALREADY INSTALLED. Migration 011 replaced that function with a
-- body that is byte-for-byte what 010 installs — 6812 bytes, same md5 — and
-- 015 has since changed only its two refusal sentences. So the check-in half of
-- 010 has nothing left to do, and re-running 010 to get it would take the
-- refusal sentences back to the wording you asked me to change. Do not run 010.
--
-- Part 2 is NOT installed. my_attendance_status() is defined in migration 008
-- and touched by 010 and nothing since, and 010 was never applied. So this
-- function is still the 008 version.
--
-- WHAT THE BUG COSTS
--
-- attendance_sessions allows two live sessions on one day — a site-wide one and
-- one per contractor — and a worker in that contractor is covered by both. The
-- 008 lookup was
--
--     contractor_id is null or contractor_id = <the worker's>
--     order by work_date desc limit 1
--
-- Both rows share the same work_date, so that ORDER BY was a tie with no
-- tiebreaker and PostgreSQL returned whichever row its plan produced. The
-- employer's own screen is deterministic, so the worker could be told
-- "attendance is closed" or handed the wrong contractor's name while their
-- code was in fact live and valid. Neither answer leaks another contractor's
-- code — the function has never returned a code — but both are wrong.
--
-- The order is now: the contractor-specific session before the site-wide one,
-- then the later work_date, then the id as a final tiebreak. Nothing is left to
-- the planner.
--
-- This body is copied verbatim from migration 010; nothing about it is new.
-- Safe to re-run.
-- ============================================================================


-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'my_attendance_status'
  ) then
    raise exception 'Run migration 008 first: my_attendance_status is missing.';
  end if;
end $$;


-- ── The change ──────────────────────────────────────────────────────────────
create or replace function public.my_attendance_status()
returns table (
  is_open         boolean,
  work_date       date,
  contractor_name text,
  last_ended      boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid      uuid := auth.uid();
  v_emp    public.employees%rowtype;
  v_date   date;
  v_cname  text;
begin
  if uid is null then
    return;
  end if;

  select * into v_emp
    from public.employees e
   where e.employee_user_id = uid and e.status = 'active'
   order by e.created_at, e.id
   limit 1;

  if not found then
    return;
  end if;

  select s.work_date, c.name
    into v_date, v_cname
    from public.attendance_sessions s
    left join public.contractors c on c.id = s.contractor_id
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
   order by (s.contractor_id is null), s.work_date desc, s.id
   limit 1;

  if found then
    return query select true, v_date, v_cname, false;
    return;
  end if;

  select s.work_date, c.name
    into v_date, v_cname
    from public.attendance_sessions s
    left join public.contractors c on c.id = s.contractor_id
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and (s.status = 'closed' or now() >= s.expires_at)
     and s.work_date >= current_date - 1
   order by s.work_date desc, s.id
   limit 1;

  if found then
    return query select false, v_date, v_cname, true;
  end if;
end $$;

-- Grants unchanged from 008, restated so this file is self-contained.
revoke all on function public.check_in_with_code(text) from public;
revoke all on function public.check_in_with_code(text) from anon;
revoke all on function public.my_attendance_status() from public;
revoke all on function public.my_attendance_status() from anon;
grant execute on function public.check_in_with_code(text) to authenticated;
grant execute on function public.my_attendance_status() to authenticated;


-- ── Proof ───────────────────────────────────────────────────────────────────
do $$
declare
  def text;
  a   boolean;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_attendance_status';

  -- The whole point: no ordering decision left to the planner. Both branches
  -- of the coverage rule must be broken by a deterministic key.
  if position('order by (s.contractor_id is null)' in def) = 0 then
    raise exception 'my_attendance_status still orders without a tiebreaker. Do not stop here - tell me.';
  end if;

  -- It must never hand back a code. The worker is told attendance is open; the
  -- four digits stay with the employer, which is the entire basis of
  -- verification.
  if position('s.code' in def) > 0 or position('code,' in def) > 0 then
    raise exception 'my_attendance_status mentions a code. Tell me - do not continue.';
  end if;

  select has_function_privilege('anon', 'public.my_attendance_status()', 'execute') into a;
  if a then
    raise exception 'anon can execute my_attendance_status. Tell me - do not continue.';
  end if;

  if not has_function_privilege('authenticated', 'public.my_attendance_status()', 'execute') then
    raise exception 'authenticated lost execute on my_attendance_status. Tell me.';
  end if;

  raise notice '016 applied: which session a worker is told about is now deterministic.';
end $$;


-- ── Verify afterwards ───────────────────────────────────────────────────────
--   select position('order by (s.contractor_id is null)'
--                   in pg_get_functiondef(p.oid)) > 0 as deterministic
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'my_attendance_status';
--
-- Expect: deterministic = true

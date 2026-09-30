-- DayPay — a worker may use ANY live code that covers them.
--
-- THE BUG
--
-- attendance_sessions has two SEPARATE partial unique indexes:
--
--   (employer_id, contractor_id, work_date) where contractor_id is not null
--   (employer_id, work_date)                 where contractor_id is null
--
-- So the database deliberately allows two sessions on the same day: one for
-- the whole site, and one per contractor. A worker in that contractor is
-- covered by BOTH — the lookup is
--
--     contractor_id is null or contractor_id = <the worker's>
--
-- which is the right coverage rule, but it was followed by
--
--     order by s.work_date desc limit 1
--
-- Both rows share the same work_date, so the ORDER BY was a tie with no
-- tiebreaker. PostgreSQL then returns whichever row its plan produces, which
-- is not defined and can change as the table grows or the plan changes.
--
-- Meanwhile the employer's screen is deterministic: todaysSession() asks for
-- exactly the site-wide session, or exactly the contractor's. So the employer
-- read out the code in front of them and the worker's check-in compared it
-- against the OTHER session — reporting "that code is not correct" for a code
-- that was live, valid, and open for that very worker.
--
-- WHAT CHANGES
--
-- The code is now matched against EVERY live session that covers the worker,
-- and any match is accepted. That is the honest rule: if the employer has
-- opened attendance for the site and for this contractor, both codes are
-- legitimately open to that worker, and either should let them in.
--
-- Where a choice still has to be made, it is now deterministic:
-- the contractor-specific session wins over the site-wide one, then the later
-- work_date, then the id. No undefined ordering remains in either function.
--
-- The refusal itself is unchanged — still one opaque message for every wrong
-- code, so nothing about another contractor leaks.
--
-- SAFE TO APPLY: replaces two functions, tightens nothing, removes no data.

begin;

-- ── Preflight ───────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'attendance_sessions'
  ) then
    raise exception
      'attendance_sessions does not exist. Run supabase/migrations/008_attendance_sessions.sql first.';
  end if;
end $$;

-- ── check_in_with_code ──────────────────────────────────────────────────────

create or replace function public.check_in_with_code(p_code text)
returns table (
  employee_id     uuid,
  full_name       text,
  work_date       date,
  kind            text,
  amount          numeric,
  contractor_name text,
  already         boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid        uuid := auth.uid();
  v_code     text;
  v_emp      public.employees%rowtype;
  v_primary  public.attendance_sessions%rowtype;   -- for the attempt cap
  v_session  public.attendance_sessions%rowtype;   -- the one whose code matched
  v_open     int;
  v_ended    int;
  v_fails    int;
  v_kind     text;
  v_row      public.day_records%rowtype;
  v_cname    text;
  v_already  boolean := false;
begin
  if uid is null then
    raise exception 'Sign in to record your attendance.' using errcode = 'insufficient_privilege';
  end if;

  v_code := trim(coalesce(p_code, ''));

  if v_code !~ '^[0-9]{4}$' then
    raise exception 'Enter the four-digit code from your workplace.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_emp
    from public.employees e
   where e.employee_user_id = uid
     and e.status = 'active'
   order by e.created_at, e.id
   limit 1;

  if not found then
    raise exception 'Your account is not linked to a workplace. Ask your employer for an invite code.'
      using errcode = 'no_data_found';
  end if;

  /* Every live session that covers this worker — a site-wide one, their
     contractor's one, or both. Ordered so that the choice is DEFINED rather
     than left to the planner: contractor-specific before site-wide, then the
     later date, then the id as a final tiebreak. The lead row is the
     "primary" session, used only for counting failed attempts. */
  select count(*) into v_open
    from public.attendance_sessions s
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at;

  if v_open = 0 then
    -- Distinguish "finished" from "not started", because one means wait and
    -- the other means go and ask. Both are facts about the worker's own
    -- workplace, so neither discloses anything about another contractor.
    select count(*) into v_ended
      from public.attendance_sessions s
     where s.employer_id = v_emp.employer_id
       and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
       and (s.status = 'closed' or now() >= s.expires_at)
       and s.work_date >= current_date - 1;

    if v_ended > 0 then
      raise exception 'Today''s attendance has been closed.' using errcode = 'check_violation';
    end if;

    raise exception 'Attendance is not open yet. Ask your employer to open it.'
      using errcode = 'no_data_found';
  end if;

  select * into v_primary
    from public.attendance_sessions s
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
   order by (s.contractor_id is null), s.work_date desc, s.id
   limit 1;

  /* The attempt cap. Counted per worker per session, so one person guessing
     cannot lock out the rest of the crew — a shared counter would turn a
     nuisance into a denial of service for everybody. */
  select count(*) into v_fails
    from public.check_in_attempts a
   where a.session_id = v_primary.id
     and a.user_id = uid
     and a.attempted_at > now() - interval '15 minutes';

  if v_fails >= 5 then
    raise exception 'Too many wrong codes. Check the code with your contractor, then try again in a few minutes.'
      using errcode = '53400';
  end if;

  /* THE FIX. Match the code against ANY covering session, not the first one
     the planner happened to return. Same deterministic order, so if two
     sessions somehow carry the same code the more specific one wins. */
  select * into v_session
    from public.attendance_sessions s
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
     and s.code = v_code
   order by (s.contractor_id is null), s.work_date desc, s.id
   limit 1;

  if not found then
    insert into public.check_in_attempts (session_id, user_id)
    values (v_primary.id, uid);

    /* ONE message for every wrong code, with no lookup to work out what the
       code might have been. A code belonging to nobody, a code from
       yesterday, and a code belonging to the contractor next door are
       indistinguishable from here — which is the point. */
    raise exception 'That code is not correct. Check with your contractor for today''s code.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Weekend days earn the multiplier, so the kind follows the DATE, not the
  -- fact that someone tapped a button.
  v_kind := case
              when extract(isodow from v_session.work_date) >= 6 then 'weekend'
              else 'work'
            end;

  insert into public.day_records
    (employee_id, work_date, kind, status, source, session_id, checked_in_at)
  values
    (v_emp.id, v_session.work_date, v_kind, 'claimed', 'check_in', v_session.id, now())
  /* NOT `on conflict (employee_id, work_date)`.
     This function returns table (employee_id ... work_date ...) — those names
     are the JSON keys the worker's screen reads, so they cannot be renamed.
     PL/pgSQL parses the inference clause as an expression, so a bare column
     name there is a name that could be either a variable or a column, and the
     statement is refused outright:
         column reference "employee_id" is ambiguous   (SQLSTATE 42702)
     Every check-in that matched a code died on this line, before writing
     anything. Naming the constraint removes the ambiguity at its source
     instead of depending on which side the parser happens to prefer.
     Fixed in migration 011. */
  on conflict on constraint day_records_employee_id_work_date_key do nothing
  returning * into v_row;

  if v_row.id is null then
    /* Already recorded — the employer may have marked them present before
       they got their phone out. Succeed quietly rather than refusing: the
       worker did come to work, and an error here would send them to report a
       problem that does not exist. */
    select * into v_row
      from public.day_records d
     where d.employee_id = v_emp.id and d.work_date = v_session.work_date;
    v_already := true;
  end if;

  select c.name into v_cname
    from public.contractors c where c.id = v_emp.contractor_id;

  return query
    select v_emp.id, v_emp.full_name, v_row.work_date, v_row.kind,
           v_row.amount, v_cname, v_already;
end $$;

-- ── my_attendance_status ────────────────────────────────────────────────────
-- Same tie, same fix. This orders by work_date with no tiebreaker either, so
-- with a site-wide and a contractor session open on the same day it could
-- report `contractor_name = null` on one run and the contractor's name on the
-- next. Preferring the contractor-specific row makes the worker's screen
-- stable, and naming their own contractor is the more useful answer.

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
-- Assert the undefined ordering is gone from both functions.
--
-- The invariant is "every ORDER BY on s.work_date ends in a tiebreaker", and
-- it takes two checks, because one alone is not enough:
--
--   (a) `s.work_date desc, s.id` must be present — the tiebreaker is there.
--   (b) `work_date desc` must never be followed by anything but a comma —
--       nothing is left open-ended.
--
-- An earlier version of this block tested only for the literal
-- 'order by s.work_date desc, s.id', which the fixed check_in_with_code does
-- NOT contain: it orders by '(s.contractor_id is null), s.work_date desc, s.id'
-- so the parenthesised key sits between `order by` and the column name. The
-- assertion therefore failed against the very fix it was checking, raised, and
-- rolled the whole file back — the migration could never apply. Found by
-- running this file against a real PostgreSQL 18.3 before handing it over,
-- which is the step that should have happened the first time.

do $$
declare
  r   record;
  bad int := 0;
begin
  for r in
    select p.proname, pg_get_functiondef(p.oid) as src
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('check_in_with_code', 'my_attendance_status')
  loop
    if position('s.work_date desc, s.id' in r.src) = 0 then
      raise warning '% has no work_date tiebreaker at all', r.proname;
      bad := bad + 1;
    elsif r.src ~ 'work_date desc[^,]' then
      raise warning '% still has an open-ended work_date ordering', r.proname;
      bad := bad + 1;
    end if;
  end loop;

  if bad > 0 then
    raise exception '% function(s) still order by work_date with no tiebreaker.', bad;
  end if;

  raise notice 'Both functions order deterministically now, and a worker may use any live code that covers them.';
end $$;

commit;

-- Verify afterwards:
--   select proname from pg_proc
--    where proname in ('check_in_with_code','my_attendance_status');
--     -> 2 rows
--
-- And to see the state that caused the problem:
--   select s.work_date, coalesce(c.name, 'WHOLE SITE') as scope, s.code, s.status
--     from public.attendance_sessions s
--     left join public.contractors c on c.id = s.contractor_id
--    where s.work_date >= current_date - 3
--    order by s.work_date desc, scope;

-- DayPay — the check-in refusal must not identify whose code it was.
--
-- THE LEAK
--
-- check_in_with_code had a courtesy branch: when a worker typed a code that was
-- live for a DIFFERENT contractor, it said so —
--
--     That code is for Alpha Services, not your contractor.
--
-- That read as helpful and is actually a disclosure. It confirmed the number
-- was a real, currently-valid code, which turns the check-in endpoint into a
-- validation oracle: anyone with an account can test a number and learn
-- whether it is live for somebody else. It also told every worker on the site
-- which other contractors exist and what they are called — names the employer
-- may not want circulated.
--
-- A credential check that reports "right code, wrong person" is a bug in every
-- system that has ever had one. The refusal must be the same for every wrong
-- code, whether it belongs to nobody, to yesterday, or to the crew next door.
--
-- WHAT CHANGES
--
-- Exactly one branch. Every wrong code now raises the identical message, with
-- the identical sequence of statements, so there is no name in the text and no
-- difference in timing either. The attempt is recorded first, in both cases,
-- exactly as before.
--
-- WHAT DOES NOT CHANGE
--
--   * "Attendance is not open yet" vs "Today's attendance has been closed"
--     stay distinct. Those are derived from the worker's OWN contractor's
--     sessions, they tell the worker whether to wait or go and ask somebody,
--     and they reveal nothing about anyone else's code or anyone else's
--     contractor. my_attendance_status() already tells the worker this much.
--
--   * The success payload still names the worker's own contractor, which is
--     how they confirm they checked in at the right place.

begin;

-- ── Preflight ───────────────────────────────────────────────────────────────
-- This replaces a function that only exists after 008. Without it the error
-- would be about an unresolvable %rowtype, which explains nothing.

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

-- ── The replaced function ───────────────────────────────────────────────────

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
  v_session  public.attendance_sessions%rowtype;
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
   order by e.created_at
   limit 1;

  if not found then
    raise exception 'Your account is not linked to a workplace. Ask your employer for an invite code.'
      using errcode = 'no_data_found';
  end if;

  select * into v_session
    from public.attendance_sessions s
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
   order by s.work_date desc
   limit 1;

  if not found then
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

  /* The attempt cap. Counted per worker per session, so one person guessing
     cannot lock out the rest of the crew — a shared counter would turn a
     nuisance into a denial of service for everybody. */
  select count(*) into v_fails
    from public.check_in_attempts a
   where a.session_id = v_session.id
     and a.user_id = uid
     and a.attempted_at > now() - interval '15 minutes';

  if v_fails >= 5 then
    raise exception 'Too many wrong codes. Check the code with your contractor, then try again in a few minutes.'
      using errcode = '53400';
  end if;

  if v_code <> v_session.code then
    insert into public.check_in_attempts (session_id, user_id)
    values (v_session.id, uid);

    /* ONE message for every wrong code, with no lookup to work out what the
       code might have been. A code belonging to nobody, a code from
       yesterday, and a code belonging to the contractor next door are
       indistinguishable from here — which is the point. Saying "that is
       Alpha's code" would confirm the number was real and hand over a name. */
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
  on conflict (employee_id, work_date) do nothing
  returning * into v_row;

  if v_row.id is null then
    /* Already recorded — the employer may have marked them present before they
       got their phone out. Succeed quietly rather than refusing: the worker did
       come to work, and an error here would send them to report a problem that
       does not exist. */
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

-- Grants are unchanged from 008, but re-stated so this file is self-contained
-- and a fresh project ends up in the same state whichever order they ran in.
revoke all on function public.check_in_with_code(text) from public;
revoke all on function public.check_in_with_code(text) from anon;
grant execute on function public.check_in_with_code(text) to authenticated;

-- ── Proof the leak is gone ──────────────────────────────────────────────────
-- Read the function source back and assert it no longer contains the branch.
-- A comment in the body could not satisfy this, because the marker is the
-- contractor name being passed INTO the message.

do $$
declare
  src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'check_in_with_code';

  if src is null then
    raise warning 'Could not read back check_in_with_code to verify it.';
    return;
  end if;

  if position('not your contractor' in src) > 0 then
    raise exception 'The refusal still identifies the code owner. The replacement did not take.';
  end if;

  if position('v_other' in src) > 0 then
    raise warning 'v_other is still referenced. Harmless if unreachable, but check the body.';
  end if;

  raise notice 'check_in_with_code no longer identifies whose code was entered.';
end $$;

commit;

-- Verify afterwards:
--   select pg_get_functiondef(oid) from pg_proc where proname = 'check_in_with_code';
--     -> the refusal must read "That code is not correct. Check with your
--        contractor for today's code." and nothing may look up another
--        contractor's session.

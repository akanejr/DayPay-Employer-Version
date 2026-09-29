-- DayPay — a check-in could never be written.
--
-- THE BUG
--
-- check_in_with_code ends with
--
--     insert into public.day_records (...)
--     values (...)
--     on conflict (employee_id, work_date) do nothing
--     returning * into v_row;
--
-- and the function is declared
--
--     returns table (employee_id uuid, ..., work_date date, ...)
--
-- Those output names are not decoration: they are the JSON keys the worker's
-- screen reads (day.work_date, day.kind, day.amount), so they cannot be
-- renamed to dodge the clash.
--
-- PL/pgSQL resolves the ON CONFLICT inference clause as an expression, so a
-- bare `employee_id` there is a name that could be either a plpgsql variable
-- (the OUT parameter) or a column, and PostgreSQL refuses to guess:
--
--     ERROR: column reference "employee_id" is ambiguous   (SQLSTATE 42702)
--
-- The statement is therefore unusable, and because the refusal happens at
-- parse time it was invisible until the day a code actually matched. Every
-- check-in in this database failed here: the worker got past the code check
-- and then hit a database error instead of a recorded day. Confirmed by
-- reproduction in a real PostgreSQL 18.3 (PL/pgSQL), where the column-list
-- form fails and the named-constraint form succeeds.
--
-- WHAT CHANGES
--
-- Exactly one clause:
--
--     on conflict on constraint day_records_employee_id_work_date_key do nothing
--
-- A constraint NAME is not an expression, so there is nothing to resolve and
-- nothing to be ambiguous about. The behaviour is identical - still
-- "do nothing" on a duplicate day, still `v_row.id is null` for the caller's
-- "already recorded" path - and the conflict path is exercised by the
-- harness (checks 26, 28, 30, 31).
--
-- SAFE TO APPLY: replaces one function, tightens nothing, removes no data,
-- changes no return shape. The client is untouched.
--
-- NOTE FOR THE RECORD: 008, 009 and 010 have been synced to carry the same
-- clause, so re-running any of them can no longer re-break check-in.

begin;

-- ── Preflight ───────────────────────────────────────────────────────────────
-- The inference clause names a constraint, and PostgreSQL only resolves that
-- name when the statement runs - not when the function is created. So the name
-- is checked here, where a failure is harmless and visible, instead of at the
-- next check-in.

do $$
begin
  if to_regclass('public.day_records') is null then
    raise exception
      'public.day_records does not exist. Run supabase/migrations/001_employer_schema.sql first.';
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.day_records'::regclass
       and c.conname = 'day_records_employee_id_work_date_key'
       and c.contype = 'u'
  ) then
    raise exception
      'Expected unique constraint day_records_employee_id_work_date_key on public.day_records. Send me the output of:  select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = ''public.day_records''::regclass order by conname;  and I will use the right name. Nothing was changed.';
  end if;
end $$;

-- ── The fix ─────────────────────────────────────────────────────────────────

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
-- Grants unchanged from 008/010, restated so this file is self-contained.
revoke all on function public.check_in_with_code(text) from public;
revoke all on function public.check_in_with_code(text) from anon;
grant execute on function public.check_in_with_code(text) to authenticated;

-- ── Proof ───────────────────────────────────────────────────────────────────
-- Assert the live definition carries the named-constraint clause and no longer
-- carries the column-list form. Reading it back out of the catalogue proves the
-- replacement took, which a plain "Success" does not.

do $$
declare
  src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = 'check_in_with_code';

  if src is null then
    raise exception 'check_in_with_code is missing after the replace.';
  end if;

  if position('on conflict on constraint day_records_employee_id_work_date_key' in src) = 0 then
    raise exception 'The replacement did not take: the function still has no named-constraint clause.';
  end if;

  /* chr(40) is an opening parenthesis. Spelled that way so this check does not put an unbalanced
     parenthesis inside a string literal, which would make the crude
     paren-balance check used on these files cry wolf. */
  if src like '%' || chr(10) || '  on conflict ' || chr(40) || 'employee_id%' then
    raise exception 'The ambiguous clause is still in the function. Do not stop here - tell me.';
  end if;

  raise notice 'check_in_with_code can now write a day. A matched code creates the record instead of raising 42702.';
end $$;

commit;

-- Verify afterwards:
--   select position('on conflict on constraint' in pg_get_functiondef(p.oid)) > 0 as fixed
--     from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
--    where ns.nspname = 'public' and p.proname = 'check_in_with_code';
--     -> fixed = true
--
-- Then, in the app: open attendance, have the worker enter the code, and check
--   select e.full_name, d.work_date, d.kind, d.status, d.source, d.checked_in_at
--     from public.day_records d join public.employees e on e.id = d.employee_id
--    where d.work_date = current_date order by e.full_name;
--     -> one row for the worker, source = 'check_in'

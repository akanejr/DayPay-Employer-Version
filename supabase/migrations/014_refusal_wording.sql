-- ============================================================================
-- 014 — WHAT A WORKER IS TOLD WHEN THE CODE IS WRONG
-- ============================================================================
-- The message was:
--
--     That code is not correct. Check with your contractor for today's code.
--
-- It is now:
--
--     Code not correct, visit the site.
--
-- WHY THIS IS A DATABASE CHANGE AND NOT A SCREEN CHANGE
--
-- The sentence is not written in the interface. It is raised by
-- check_in_with_code(), travels up through PostgREST as the error message, and
-- src/employer/CheckIn.jsx renders whatever arrives. That is deliberate: there
-- is exactly one refusal, in one place, with no second copy on the client to
-- drift out of step with it. So the wording is a migration — and this is the
-- only statement in the whole product that a worker sees when their code is
-- refused.
--
-- WHAT DID NOT CHANGE, BECAUSE IT MATTERS MORE THAN THE WORDS
--
-- There is still ONE message for every kind of wrong code. A code belonging to
-- nobody, a code from a session that ended yesterday, and a LIVE code belonging
-- to the contractor next door are indistinguishable from the worker's side.
-- The function does no lookup to work out what the code might have been, so it
-- cannot accidentally reveal whose it was. "Visit the site" is also true of all
-- three cases: whichever code they have, the answer is at the workplace.
-- The harness checks this by comparing the three refusals to each other rather
-- than to any fixed text, so it would catch a future change that let them
-- differ — and it is unaffected by this one.
--
-- Safe to re-run: it replaces the function and asserts the result.
-- Run after 013.
-- ============================================================================


-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'check_in_with_code'
  ) then
    raise exception 'Run migration 008 (and 011) first: check_in_with_code is missing.';
  end if;
end $$;


-- ── The change ──────────────────────────────────────────────────────────────
-- Everything else in this function is byte-for-byte what migration 011
-- installed. The named-constraint clause is preserved on purpose: the bare
-- `on conflict (employee_id, work_date)` form is refused by PL/pgSQL as
-- ambiguous (42702) and every check-in that matched a code would die on it.
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
    raise exception 'Code not correct, visit the site.'
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


-- ── Proof ───────────────────────────────────────────────────────────────────
-- The wording IS the deliverable here, so unlike the other migrations this
-- proof asserts words rather than shapes. It also re-asserts the two things
-- that silently broke before: the ambiguous conflict clause, and the grants.
do $$
declare
  def text;
  a   boolean;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_in_with_code';

  if position('Code not correct, visit the site.' in def) = 0 then
    raise exception 'The refusal was not replaced. Do not stop here - tell me.';
  end if;

  if position('Check with your contractor' in def) > 0 then
    raise exception 'The old wording is still in the function. Tell me.';
  end if;

  if position('day_records_employee_id_work_date_key' in def) = 0 then
    raise exception 'The named-constraint clause is gone: check-ins will fail with 42702. Tell me.';
  end if;

  -- Only a signed-in worker may call it. A visitor must not be able to test
  -- codes against the endpoint: that would make it a validation oracle.
  select has_function_privilege('anon', 'public.check_in_with_code(text)', 'execute') into a;
  if a then
    raise exception 'anon can execute check_in_with_code. Tell me - do not continue.';
  end if;

  if not has_function_privilege('authenticated', 'public.check_in_with_code(text)', 'execute') then
    raise exception 'authenticated lost execute on check_in_with_code. Tell me.';
  end if;

  raise notice '014 applied: the refusal now reads "Code not correct, visit the site."';
end $$;


-- ── Verify afterwards ───────────────────────────────────────────────────────
-- Run this in the SQL Editor. The second column should be the new sentence and
-- nothing else.
--
--   select p.proname,
--          (regexp_match(pg_get_functiondef(p.oid),
--                        'raise exception .([^'']*not correct[^'']*).'))[1]
--            as refusal_message
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'check_in_with_code';

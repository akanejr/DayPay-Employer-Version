-- ============================================================================
-- 015 — HOW THIS FUNCTION REFUSES, IN BOTH CASES
-- ============================================================================
-- Two sentences change:
--
--   a wrong code        That code is not correct. Check with your contractor …
--                    -> Code not correct, visit the site.
--
--   too many wrong codes
--                       Too many wrong codes. Check the code with your
--                       contractor, then try again in a few minutes.
--                    -> Too many wrong codes. Try again in a few minutes.
--
-- WHY ONE MIGRATION AND NOT TWO
--
-- Both sentences are raised by the same function, and PostgreSQL has no way to
-- change a line inside one — the whole function is replaced or nothing is. So
-- this file carries both, and it therefore INCLUDES migration 014, which set
-- only the first of them. If you have already run 014, nothing is undone:
-- this sets the same sentence again. If you have not, you do not need to —
-- running this file alone leaves you with both.
--
-- WHY THE SECOND ONE MATTERS
--
-- The wrong-code refusal deliberately sends the worker to the site: it says
-- nothing about WHOSE code they hold, which is the whole point. The lockout is
-- a different situation — it means five attempts in fifteen minutes have
-- already been made — and "check the code with your contractor" had crept into
-- it by imitation. It now says the one useful fact, which is that this is
-- temporary.
--
-- WHY THIS IS SAFE TO RUN AGAINST YOUR DATABASE AS IT STANDS
--
-- Everything else in this function is byte-for-byte what migration 011
-- installed, which is byte-for-byte what migration 010 installs. The
-- named-constraint clause is preserved for a specific reason: the bare
-- `on conflict (employee_id, work_date)` form is refused by PL/pgSQL as
-- ambiguous (42702) because the function's OUT parameters share those names,
-- and every check-in that matched a code died on it. That was migration 011.
--
-- ORDER: run this AFTER 010. 010 also replaces this function and it carries
-- the OLD sentences, so running 010 afterwards would put them back. The guard
-- at the end of this file checks the result either way.
--
-- Safe to re-run.
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
    raise exception 'Too many wrong codes. Try again in a few minutes.'
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


-- ── Proof ───────────────────────────────────────────────────────────────────
-- The sentences ARE the deliverable, so this proof reads the installed
-- function back and checks the words, plus the three properties that broke
-- silently before: the conflict clause, and both grants.
do $$
declare
  def text;
  a   boolean;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_in_with_code';

  if position('Code not correct, visit the site.' in def) = 0 then
    raise exception 'The wrong-code refusal is not the agreed sentence. Do not stop here - tell me.';
  end if;

  if position('Too many wrong codes. Try again in a few minutes.' in def) = 0 then
    raise exception 'The lockout sentence was not replaced. Do not stop here - tell me.';
  end if;

  if position('Check with your contractor' in def) > 0 then
    raise exception 'An old sentence is still in the function - run 010 BEFORE this file. Tell me.';
  end if;

  if position('day_records_employee_id_work_date_key' in def) = 0 then
    raise exception 'The named-constraint clause is gone: check-ins will fail with 42702. Tell me.';
  end if;

  select has_function_privilege('anon', 'public.check_in_with_code(text)', 'execute') into a;
  if a then
    raise exception 'anon can execute check_in_with_code. Tell me - do not continue.';
  end if;

  if not has_function_privilege('authenticated', 'public.check_in_with_code(text)', 'execute') then
    raise exception 'authenticated lost execute on check_in_with_code. Tell me.';
  end if;

  raise notice '015 applied: a wrong code says "Code not correct, visit the site." and the lockout says "Too many wrong codes. Try again in a few minutes."';
end $$;


-- ── Verify afterwards ───────────────────────────────────────────────────────
-- Both sentences at once, straight out of the database:
--
--   select (regexp_matches(pg_get_functiondef(p.oid),
--            'raise exception ''([^'']*)''', 'g'))[1] as refusal
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'check_in_with_code';
--
-- Expect the two sentences above, and no mention of a contractor anywhere.

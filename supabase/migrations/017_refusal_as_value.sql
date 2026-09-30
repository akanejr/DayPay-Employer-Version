-- ============================================================================
-- 017 — A REFUSAL IS AN ANSWER, NOT AN ERROR
-- ============================================================================
-- THE DEFECT THIS FIXES
--
-- The five-attempt cap on check-in has never once fired, on any database this
-- project has run against. Here is why, and it is not a mistake in the
-- counting:
--
--   check_in_with_code() inserted the attempt into check_in_attempts and THEN
--   raised the refusal. In PostgreSQL an exception aborts the transaction it is
--   raised in, and everything that transaction wrote is undone — including the
--   row that had just been written. Every wrong code erased its own evidence.
--
-- Measured, not reasoned: six wrong codes in a row left check_in_attempts
-- EMPTY. The count could never reach five, so the cap was unreachable and the
-- endpoint was brute-forceable — ten thousand codes, no limit, and no record
-- that anybody had tried. scripts/integration/lockout-probe.mjs demonstrates
-- it, and the old half of that demonstration still holds: put five attempts
-- there by hand, committed, and the sixth call IS refused. The counter always
-- worked. The transaction was the problem.
--
-- THE FIX, AND WHY IT IS SHAPED THIS WAY
--
-- A wrong code is an ordinary event — it happens every day on a real site —
-- so it is returned as a result, not raised as a failure:
--
--     (ok, message, employee_id, full_name, work_date, kind, amount,
--      contractor_name, already)
--
--   a refusal  ->  ok = false, message = the sentence, everything else null
--   a check-in ->  ok = true,  message = null,    the day as before
--
-- The attempt INSERT is now not undone, because nothing is aborted. Five wrong
-- codes leave five rows, the sixth is refused for the cap, and the lockout
-- finally exists. Everything the product already promised about wrong codes
-- still holds: ONE sentence for every kind of wrong code, no lookup to work out
-- whose it was, no contractor's name, nothing that turns the endpoint into a
-- way of asking "was that number real?".
--
-- Genuine faults still RAISE. A missing table, a broken privilege, a bug —
-- those should be loud, and they still are. Only the outcomes a worker can
-- cause are returned as values.
--
-- ORDER OF DEPLOYMENT — THE ONE THING TO GET RIGHT
--
-- The client was already written for this shape: employer.js returns
-- { ok, message } and CheckIn.jsx renders it. The version in this repository
-- understands BOTH contracts, so the safe order is:
--
--   1. Deploy the app (this build).
--   2. Then run this migration.
--
-- That way there is no moment when a newly-returned refusal is read by an
-- older build, which would show the worker a success screen for a wrong code.
-- The reverse order is not harmful to the data — nothing is written — but it
-- would misinform the person doing the checking in.
--
-- THIS FILE DROPS THE FUNCTION BEFORE RECREATING IT, AND THAT IS NOT OPTIONAL
--
-- `create or replace function` cannot change a return type — PostgreSQL refuses
-- it outright with
--
--     ERROR: cannot change return type of existing function
--
-- because callers may be relying on the old shape. Adding (ok, message) to the
-- result therefore has to be a DROP and a CREATE. Both are wrapped in one
-- transaction below, so there is no instant in which the function does not
-- exist and a worker tapping Record would find nothing to call. Dropping a
-- function destroys no data; the ledger, the sessions and the attempts are all
-- untouched.
--
-- Safe to re-run.
-- ============================================================================


begin;

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'check_in_with_code'
  ) then
    raise exception 'Run migration 008 (and 011) first: check_in_with_code is missing.';
  end if;

  if to_regclass('public.check_in_attempts') is null then
    raise exception 'public.check_in_attempts is missing. Run migration 008 first.';
  end if;
end $$;


-- ── The change ──────────────────────────────────────────────────────────────
-- The body is migration 015's, with each refusal turned from a raise into a
-- returned row and nothing else altered. The comments explaining why the
-- logic is the way it is are kept, because they are still true.
--
-- The grants go with the drop, so they are restated at the end of this section.
drop function if exists public.check_in_with_code(text);

create function public.check_in_with_code(p_code text)
returns table (
  ok              boolean,
  message         text,
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
    return query select false, 'Sign in to record your attendance.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
  end if;

  v_code := trim(coalesce(p_code, ''));

  if v_code !~ '^[0-9]{4}$' then
    return query select false, 'Enter the four-digit code from your workplace.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
  end if;

  select * into v_emp
    from public.employees e
   where e.employee_user_id = uid
     and e.status = 'active'
   order by e.created_at, e.id
   limit 1;

  if not found then
    return query select false, 'Your account is not linked to a workplace. Ask your employer for an invite code.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
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
      return query select false, 'Today''s attendance has been closed.'::text,
                          null::uuid, null::text, null::date, null::text,
                          null::numeric, null::text, false;
      return;
    end if;

    return query select false, 'Attendance is not open yet. Ask your employer to open it.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
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
    return query select false, 'Too many wrong codes. Try again in a few minutes.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
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
    return query select false, 'Code not correct, visit the site.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
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
    select true, null::text, v_emp.id, v_emp.full_name, v_row.work_date,
           v_row.kind, v_row.amount, v_cname, v_already;
end $$;
-- Grants do not survive a drop, so they are restated here exactly as 008, 010,
-- 011 and 015 had them. Missing this would take check-in offline completely:
-- the function would exist and nobody would be allowed to call it.
revoke all on function public.check_in_with_code(text) from public;
revoke all on function public.check_in_with_code(text) from anon;
grant execute on function public.check_in_with_code(text) to authenticated;


-- ── Proof ───────────────────────────────────────────────────────────────────
-- This proof can assert things the others cannot, because the whole defect was
-- a property of the text: where the attempt is written relative to where the
-- refusal happens. Both are read out of the installed function.
do $$
declare
  def    text;
  result text;
  i_ins  int;
  i_ref  int;
  a      boolean;
begin
  select pg_get_functiondef(p.oid), pg_get_function_result(p.oid)
    into def, result
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_in_with_code';

  -- (1) The contract itself: a refusal has somewhere to go.
  if position('ok boolean' in result) = 0 or position('message text' in result) = 0 then
    raise exception 'The function does not return (ok, message). Do not stop here - tell me.';
  end if;

  -- (2) No user-facing refusal may raise any more. This is the fix: a raise is
  --     what rolled the attempt back, so any remaining one is a live instance
  --     of the bug.
  if position('raise exception' in def) > 0 then
    raise exception 'The function still raises. A refusal that raises erases its own attempt record. Do not stop here - tell me.';
  end if;

  -- (3) The ordering that makes the cap work: the attempt is written BEFORE the
  --     refusal is returned. Reversed, the insert would be dead code.
  i_ins := position('insert into public.check_in_attempts' in def);
  i_ref := position('Code not correct, visit the site.' in def);
  if i_ins = 0 then
    raise exception 'The attempt is not recorded at all. The cap cannot work. Tell me.';
  end if;
  if i_ref = 0 then
    raise exception 'The wrong-code refusal is missing. Tell me.';
  end if;
  if i_ins > i_ref then
    raise exception 'The attempt is written AFTER the refusal is built, so nothing is recorded. Tell me.';
  end if;

  -- (4) The cap still exists, with the agreed wording.
  if position('Too many wrong codes. Try again in a few minutes.' in def) = 0 then
    raise exception 'The lockout sentence is missing. Tell me.';
  end if;

  -- (5) Nothing that names anybody, and no trace of the old wording.
  if position('Check with your contractor' in def) > 0 then
    raise exception 'An old refusal sentence is back in the function. Tell me.';
  end if;

  -- (6) The clause that stops every matching check-in dying with 42702.
  if position('day_records_employee_id_work_date_key' in def) = 0 then
    raise exception 'The named-constraint clause is gone: check-ins will fail with 42702. Tell me.';
  end if;

  -- (7) Only a signed-in worker may call it.
  select has_function_privilege('anon', 'public.check_in_with_code(text)', 'execute') into a;
  if a then
    raise exception 'anon can execute check_in_with_code. Tell me - do not continue.';
  end if;

  if not has_function_privilege('authenticated', 'public.check_in_with_code(text)', 'execute') then
    raise exception 'authenticated lost execute on check_in_with_code. Tell me.';
  end if;

  raise notice '017 applied: refusals are returned, the attempt is recorded, and the five-attempt cap now exists.';
end $$;

commit;


-- ── Verify afterwards ───────────────────────────────────────────────────────
-- The contract, and the two sentences, straight out of the database:
--
--   select pg_get_function_result(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'check_in_with_code';
--     -> TABLE(ok boolean, message text, employee_id uuid, ...)
--
--   select (regexp_matches(pg_get_functiondef(p.oid),
--            'raise exception ''([^'']*)''', 'g'))[1]
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'check_in_with_code';
--     -> no rows: there is no raise left in this function
--
-- And the behaviour, which is the point, in the SQL Editor as an employer:
--
--   select count(*) from public.check_in_attempts;   -- before
--   -- then have a worker enter a wrong code a few times
--   select count(*) from public.check_in_attempts;   -- after: it goes UP now

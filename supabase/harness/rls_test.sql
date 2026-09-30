-- ============================================================================
-- DayPay Employer Version — RLS verification harness (v11)
-- ============================================================================
-- Proves an employee cannot read another employee's wages.
-- Seeds test data, runs the checks, then ROLLS BACK. Safe to re-run.
--
-- NEW IN v11 — A REFUSAL IS READ, NOT CAUGHT.
--
-- Migration 017 turned the wrong-code refusal from a raised exception into a
-- returned row (ok = false, message). The reason was not tidiness: raising it
-- rolled back the attempt record the function had just written, so the
-- five-attempt cap could not count anything and had never fired on any
-- database. This file caught the old shape, so checks 21-28 now read `ok` and
-- `message` off the returned row, and check 58 is new — it asserts that three
-- wrong codes leave three recorded attempts, which is the property that was
-- silently false for three phases.
--
-- NEW IN v10 — THE FILE NOW ACTUALLY RUNS. It had never been executed
-- end-to-end from top to bottom: Phases 6 and 7 verified their sections by
-- slicing them out, and a slice supplies its own fixtures, so it cannot see an
-- ordering mistake at the top of the file. Phase 8 ran the whole thing against
-- a real PostgreSQL with all thirteen migrations, and found four faults, all
-- fixed here. Every one of them stopped the run before a single check could
-- execute, which is why none was ever noticed:
--
--   1. `grant select on _ids` sat eight lines ABOVE the creation of `_ids`.
--      The file died on that statement: relation "_ids" does not exist.
--   2. The "code from yesterday is dead" fixture had `expires_at` in the past
--      against a default `opens_at` of now(), so it violated
--      attendance_session_window (expires_at > opens_at). A session that has
--      ended has to have started before it ended.
--   3. Check 18 (client-sent amount ignored) inherited Phase 2's EMPLOYEE role,
--      which cannot insert a day at all — check 17 proves that two checks
--      earlier. RLS refused the insert and the money trigger the check exists
--      to exercise was never reached. It now runs as the owner.
--   4. Check 27 (two live sessions cover this worker) also counted sessions as
--      the employee, who by design can see none — the very thing check 19
--      asserts. The two checks contradicted each other. It now counts as the
--      owner, because it is a statement about the fixture, not a permission.
--
-- Result: 58 checks, 0 failures, in one run.
--
-- NEW IN v9
--   * billing (checks 48-57). Phase 7 freezes a period into an invoice. The
--     figures must be the ledger's own (48-49), a document must not be
--     double-issued, hand-written or deleted (50-53, 55-56), and a worker must
--     not be able to read one at all (54, 57).
--
--   * corrections (checks 42-47). Phase 5 made a worker's month read-only; the
--     brief still requires them to be able to raise a correction. Both are true
--     only if a worker can ASK and cannot APPLY. These six checks prove the
--     asking works, that it cannot be aimed at a colleague, that the worker
--     cannot approve their own request (which would be a second, forged write
--     path to the ledger), that one day cannot accumulate two open requests,
--     that an approval genuinely rewrites the day and keeps a confirmed day
--     confirmed, and that an answered request does not ban the next one.
--
-- NEW IN v8
--   * what a worker may NOT do to their own record (checks 40-41). Phase 5
--     makes the worker's screens read-only; these two prove the database
--     agrees. A day the employer has CONFIRMED cannot be deleted by the worker
--     it belongs to, and a claim they made themselves — still unresolved — can
--     still be withdrawn, because "I tapped the wrong day" has to stay fixable.
--   * `grant select on _ids to authenticated, anon` (see below). Without it
--     every check in this file failed with "permission denied for table _ids":
--     a temporary table created by the owner is not readable by a role
--     switched with SET ROLE, and the role-switched blocks read _ids to learn
--     which account they are acting as. Found by running the harness against a
--     real PostgreSQL instead of trusting it.
--
-- NEW IN v7
--   * installed-migration state (checks 37-39). Reads the live function bodies
--     out of the catalogue and reports whether 010 (deterministic ordering) and
--     011 (the ON CONFLICT clause a check-in needs to be able to write at all)
--     are actually installed. Without these, a project can pass every RLS check
--     while being unable to record a single check-in. They also catch the
--     reverse mistake: re-running 008 or 009 restores the old bodies and undoes
--     both fixes.
--
-- NEW IN v6
--   * overlapping sessions (Phase 4 bug): the database allows a site-wide
--     session AND a per-contractor session on the same day. A worker in that
--     contractor is covered by both, and check_in_with_code used to pick one
--     with `order by work_date desc limit 1` — a tie with no tiebreaker, so
--     PostgreSQL chose arbitrarily. The employer's screen is deterministic, so
--     the code they read out could be compared against the other session and
--     reported as WRONG despite being live and valid for that worker.
--     v6 seeds both and asserts BOTH codes are accepted. The previous harness
--     could not have caught this: it only ever created one session covering
--     the linked worker.
--
-- NEW IN v5
--   * attendance sessions (Phase 4): the daily code is invisible to the worker
--     it is issued to; yesterday's code and a code belonging to nobody are
--     both refused; a worker cannot insert a day with no session open, nor
--     reclassify their own day to overtime for double pay. Requires 008.
--
-- NEW IN v4
--   * contractor isolation (Phase 3): a worker sees the one contractor that
--     supplies them and no other, and cannot rename or delete anyone's.
--     Requires migration 007, which the harness checks for up front rather
--     than reporting a misleading verdict on an un-migrated project.
--
-- FIXES IN v3
--   * `from picked p` — the CTE had no alias, so p.employer_uid was unresolved
--     (42P01: missing FROM-clause entry for table "p")
--   * results are recorded through a SECURITY DEFINER helper instead of a
--     direct INSERT. A temp table lives in the session's temp schema, and a
--     role switched with SET ROLE does not necessarily have rights on it.
--     Going through the helper removes that whole class of failure.
--   * explicit table grants, so a missing default-privilege shows up as a
--     failing check rather than an opaque "permission denied".
-- ============================================================================

begin;

-- ── Privileges ─────────────────────────────────────────────────────────────
-- Supabase normally grants these via default privileges. Doing it explicitly
-- means the test behaves identically whether or not that is configured, and
-- a permission problem surfaces as a FAIL rather than an error.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.employers, public.employees, public.employee_rate_periods,
  public.day_records, public.day_record_events
  to authenticated;
grant select, insert, update, delete on public.contractors to authenticated;
grant select, insert, update, delete on public.attendance_sessions to authenticated;
grant select on
  public.employers, public.employees, public.employee_rate_periods,
  public.day_records, public.day_record_events
  to anon;
grant select on public.contractors to anon;
grant select on public.attendance_sessions to anon;
grant usage, select on sequence public.day_record_events_id_seq to authenticated;

-- ── Results table + recorder ───────────────────────────────────────────────
create temp table _rls (
  n int, area text, check_name text,
  expected text, actual text, pass boolean
);

create or replace function public._harness_record(
  p_n int, p_area text, p_name text,
  p_expected text, p_actual text, p_pass boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into _rls (n, area, check_name, expected, actual, pass)
  values (p_n, p_area, p_name, p_expected, p_actual, p_pass);
end $$;

grant execute on function public._harness_record(int, text, text, text, text, boolean)
  to authenticated, anon;

-- ── Which two accounts to test ─────────────────────────────────────────────
-- Blank = auto-pick the two most recently created accounts.
create temp table _cfg on commit drop as
select ''::text as employer_email, ''::text as employee_email;

create temp table _ids on commit drop as
with recent as (
  select id, email, created_at,
         row_number() over (order by created_at desc) as rn
  from auth.users
),
picked as (
  select
    coalesce(
      (select u.id from auth.users u
        where u.email = (select employer_email from _cfg)
          and (select employer_email from _cfg) <> ''),
      (select id from recent where rn = 2)
    ) as employer_uid,
    coalesce(
      (select u.id from auth.users u
        where u.email = (select employee_email from _cfg)
          and (select employee_email from _cfg) <> ''),
      (select id from recent where rn = 1)
    ) as employee_uid
)
select
  p.employer_uid,
  p.employee_uid,
  (select email from auth.users where id = p.employer_uid) as employer_email_used,
  (select email from auth.users where id = p.employee_uid) as employee_email_used,
  (select count(*) from auth.users) as total_accounts
from picked p;

/* _ids and _rls live in the TEMP schema, and a temporary table created by the
   owner is NOT readable by a role switched with SET ROLE. Every phase below
   reads _ids to find out which account it is acting as, so without this the
   whole run dies on its first check with "permission denied for table _ids" —
   which is exactly what happened the first time this file was executed against
   a real PostgreSQL.

   THESE GRANTS USED TO SIT 8 LINES TOO HIGH — immediately after the recorder
   function and BEFORE `_ids` was created — so the file could never run at all:
   it stopped on `grant select on _ids` with `relation "_ids" does not exist`,
   before a single check. Slicing sections out to test them (which is how
   Phases 6 and 7 were verified) cannot see that, because a slice supplies its
   own fixtures. Found by running the whole file for Phase 8. Grants always
   come after the thing they grant on. */
grant select on _ids to authenticated, anon;
grant select on _rls to authenticated, anon;

do $$
declare n int; a uuid; b uuid;
begin
  select count(*) into n from auth.users;
  if n < 2 then
    raise exception 'This project has % account(s). The harness needs TWO.', n;
  end if;
  select employer_uid, employee_uid into a, b from _ids;
  if a is null or b is null then
    raise exception 'Could not resolve two accounts.';
  end if;
  if a = b then
    raise exception 'Both roles resolved to the same account.';
  end if;
end $$;

-- ── Migration preflight ────────────────────────────────────────────────────
-- Checked before anything else, because a missing table would otherwise
-- surface as a raw 42P01 halfway down and the report would be unreadable.
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'contractors'
  ) then
    raise exception
      'The contractors table does not exist. Run supabase/migrations/007_contractors.sql, then re-run this harness.';
  end if;

  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'attendance_sessions'
  ) then
    raise exception
      'The attendance_sessions table does not exist. Run supabase/migrations/008_attendance_sessions.sql, then re-run this harness.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'employees' and column_name = 'pin_hash'
  ) then
    raise exception
      'The personal attendance PIN is not installed. Run supabase/migrations/018_attendance_pin.sql, then re-run this harness.';
  end if;

  if to_regclass('public.attendance_devices') is null then
    raise exception
      'The site kiosk is not installed. Run supabase/migrations/019_site_kiosk.sql, then re-run this harness.';
  end if;
end $$;

-- ── Seed ───────────────────────────────────────────────────────────────────
-- Employee 1 is linked to the employee account and earns ₦16,000/day.
-- Employee 2 is a colleague, NOT linked, and earns ₦99,000/day — the bait.
insert into public.employers (user_id, business_name)
select employer_uid, 'Harness Ltd' from _ids;

insert into public.employees (id, employer_id, full_name, email, employee_user_id)
select '11111111-1111-4111-8111-111111111111', employer_uid,
       'Linked Employee', (select employee_email_used from _ids), employee_uid
from _ids;

insert into public.employees (id, employer_id, full_name, email, employee_user_id)
select '22222222-2222-4222-8222-222222222222', employer_uid,
       'Colleague Employee', 'colleague@example.com', null
from _ids;

insert into public.employee_rate_periods
  (employee_id, effective_from, daily_rate, weekend_multiplier, holiday_multiplier)
values
  ('11111111-1111-4111-8111-111111111111', current_date - 30, 16000, 2, 2),
  ('22222222-2222-4222-8222-222222222222', current_date - 30, 99000, 2, 2);

insert into public.day_records (employee_id, work_date, kind)
values
  ('11111111-1111-4111-8111-111111111111', current_date - 2, 'work'),
  ('22222222-2222-4222-8222-222222222222', current_date - 2, 'work');

-- Two contractors. A supplies the linked worker, so the worker is allowed to
-- resolve its name. B supplies nobody, so no worker has any business seeing it.
insert into public.contractors (id, employer_id, name)
select '33333333-3333-4333-8333-333333333333', employer_uid, 'Harness Contractor A'
from _ids;

insert into public.contractors (id, employer_id, name)
select '44444444-4444-4444-8444-444444444444', employer_uid, 'Harness Contractor B'
from _ids;

update public.employees
   set contractor_id = '33333333-3333-4333-8333-333333333333'
 where id = '11111111-1111-4111-8111-111111111111';

-- An open session for contractor A (the linked worker's contractor), and a
-- separate one for contractor B, whose code must be useless to that worker.
insert into public.attendance_sessions
  (id, employer_id, contractor_id, work_date, code, expires_at)
select '55555555-5555-4555-8555-555555555555', employer_uid,
       '33333333-3333-4333-8333-333333333333',
       current_date, '7429', now() + interval '8 hours'
from _ids;

insert into public.attendance_sessions
  (id, employer_id, contractor_id, work_date, code, expires_at)
select '66666666-6666-4666-8666-666666666666', employer_uid,
       '44444444-4444-4444-8444-444444444444',
       current_date, '1357', now() + interval '8 hours'
from _ids;

-- A SITE-WIDE session open at the same time, with a different code. This is
-- the overlap that produced the bug: a worker in contractor A is covered by
-- both this and their contractor's session, so either code must work.
insert into public.attendance_sessions
  (id, employer_id, contractor_id, work_date, code, expires_at)
select '88888888-8888-4888-8888-888888888888', employer_uid,
       null, current_date, '8642', now() + interval '8 hours'
from _ids;

/* A session that ended yesterday. Its code must be dead.

   `opens_at` is given explicitly here, and that is not tidiness: it defaults to
   now(), so an expiry in the PAST makes the window negative and trips
   attendance_session_window (expires_at > opens_at). This fixture failed that
   check every single time the file was run — the second of the two bugs that
   stopped the harness before any check could execute. A session that has ended
   has to have started earlier than it ended. */
insert into public.attendance_sessions
  (id, employer_id, contractor_id, work_date, code, opens_at, expires_at)
select '77777777-7777-4777-8777-777777777777', employer_uid,
       '33333333-3333-4333-8333-333333333333',
       current_date - 1, '0000', now() - interval '2 days', now() - interval '1 hour'
from _ids;


-- ============================================================================
-- PHASE 1 — ACT AS THE EMPLOYER
-- ============================================================================
-- `SET LOCAL x = <expression>` is invalid PostgreSQL; SET accepts only a
-- literal, so dynamic values go through set_config().
set local role authenticated;
do $$
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );
end $$;

-- PREFLIGHT. If the role switch silently did not take effect, every check
-- below would run as the table owner — and the table owner bypasses RLS
-- entirely. Everything would PASS, and the passes would be meaningless.
-- These rows make that failure loud instead of invisible.
select public._harness_record(
  0, 'PREFLIGHT', 'employer role switch applied',
  'authenticated', current_user, current_user = 'authenticated');

select public._harness_record(
  1, 'employer', 'sees both employees on their roster',
  '2', (select count(*)::text from public.employees),
  (select count(*) from public.employees) = 2);

select public._harness_record(
  2, 'employer', 'sees both day records',
  '2', (select count(*)::text from public.day_records),
  (select count(*) from public.day_records) = 2);

select public._harness_record(
  3, 'employer', 'sees both rate periods',
  '2', (select count(*)::text from public.employee_rate_periods),
  (select count(*) from public.employee_rate_periods) = 2);

select public._harness_record(
  4, 'CONTRACTORS', 'employer sees their own contractors',
  '2', (select count(*)::text from public.contractors),
  (select count(*) from public.contractors) = 2);

select public._harness_record(
  5, 'CONTRACTORS', 'employer can assign a worker to a contractor',
  '1', (select count(*)::text from public.employees
          where contractor_id = '33333333-3333-4333-8333-333333333333'),
  (select count(*) from public.employees
     where contractor_id = '33333333-3333-4333-8333-333333333333') = 1);

select public._harness_record(
  6, 'SESSIONS', 'employer sees their own attendance sessions',
  '4', (select count(*)::text from public.attendance_sessions),
  (select count(*) from public.attendance_sessions) = 4);

reset role;


-- ============================================================================
-- PHASE 2 — ACT AS THE EMPLOYEE (the test that matters)
-- ============================================================================
set local role authenticated;
do $$
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );
end $$;

select public._harness_record(
  7, 'PREFLIGHT', 'employee role switch applied',
  'authenticated', current_user, current_user = 'authenticated');

select public._harness_record(
  8, 'EMPLOYEE ISOLATION', 'sees ONLY their own employee row (not the roster)',
  '1', (select count(*)::text from public.employees),
  (select count(*) from public.employees) = 1);

select public._harness_record(
  9, 'EMPLOYEE ISOLATION', 'sees ONLY their own day records',
  '1', (select count(*)::text from public.day_records),
  (select count(*) from public.day_records) = 1);

select public._harness_record(
  10, 'EMPLOYEE ISOLATION', 'sees ONLY their own rate periods',
  '1', (select count(*)::text from public.employee_rate_periods),
  (select count(*) from public.employee_rate_periods) = 1);

-- ── Contractors, from the worker's side ───────────────────────────────────
-- The policy here is SELECT-only and scoped by a SECURITY DEFINER helper. The
-- dangerous direction is the one where a worker can reach a contractor they
-- have nothing to do with, so that is what the bait checks below probe.

select public._harness_record(
  11, 'CONTRACTORS', 'worker sees ONLY the contractor that supplies them',
  '1', (select count(*)::text from public.contractors),
  (select count(*) from public.contractors) = 1);

select public._harness_record(
  12, 'CONTRACTORS', 'CANNOT see the contractor that supplies nobody',
  '0', (select count(*)::text from public.contractors
          where name = 'Harness Contractor B'),
  (select count(*) from public.contractors
     where name = 'Harness Contractor B') = 0);

-- UPDATE and DELETE do not error when the policy blocks them: they silently
-- affect zero rows. So the check has to look at the row afterwards, not at the
-- absence of an exception.
do $$
declare n int;
begin
  begin
    update public.contractors set name = 'Hijacked'
     where id = '44444444-4444-4444-8444-444444444444';
    select count(*) into n from public.contractors where name = 'Hijacked';
    perform public._harness_record(
      13, 'CONTRACTORS', 'CANNOT rename a contractor belonging to someone else',
      '0 rows changed', n::text || ' rows changed', n = 0);
  exception when others then
    -- An exception is also a refusal, so this direction passes too.
    perform public._harness_record(
      13, 'CONTRACTORS', 'CANNOT rename a contractor belonging to someone else',
      '0 rows changed', 'refused: ' || sqlerrm, true);
  end;
end $$;

do $$
declare n int;
begin
  begin
    delete from public.contractors
     where id = '44444444-4444-4444-8444-444444444444';
    select count(*) into n from public.employees where id = '11111111-1111-4111-8111-111111111111';
    perform public._harness_record(
      14, 'CONTRACTORS', 'CANNOT delete a contractor belonging to someone else',
      '0 rows changed', case when n = 1 then '0 rows changed' else 'row removed' end,
      n = 1);
  exception when others then
    perform public._harness_record(
      14, 'CONTRACTORS', 'CANNOT delete a contractor belonging to someone else',
      '0 rows changed', 'refused: ' || sqlerrm, true);
  end;
end $$;

-- The bait: a colleague on ₦99,000/day must be invisible.
select public._harness_record(
  15, 'EMPLOYEE ISOLATION', 'CANNOT read the colleague''s 99000 rate',
  '0', (select count(*)::text from public.employee_rate_periods
          where daily_rate = 99000),
  (select count(*) from public.employee_rate_periods
     where daily_rate = 99000) = 0);

select public._harness_record(
  16, 'EMPLOYEE ISOLATION', 'CANNOT read the colleague''s day record',
  '0', (select count(*)::text from public.day_records
          where employee_id = '22222222-2222-4222-8222-222222222222'),
  (select count(*) from public.day_records
     where employee_id = '22222222-2222-4222-8222-222222222222') = 0);

-- Attempt to self-confirm a day (bypassing the employer entirely).
-- The SQLSTATE is reported, not just "refused": a refusal for the WRONG reason
-- would otherwise look identical to a correct refusal. The expected code is
-- 42501 (insufficient_privilege — the RLS policy doing its job). Anything
-- starting "P0001" or "23514" means a trigger rejected it instead, which is
-- not the guarantee we are trying to demonstrate.
do $$
declare refused boolean; state text; msg text;
begin
  begin
    insert into public.day_records (employee_id, work_date, kind, status)
    values ('11111111-1111-4111-8111-111111111111', current_date - 5, 'work', 'confirmed');
    refused := false; state := '-'; msg := 'insert SUCCEEDED';
  exception when others then
    refused := true; state := sqlstate; msg := sqlerrm;
  end;
  perform public._harness_record(
    17, 'FORGERY', 'employee CANNOT insert a self-confirmed day (expect 42501)',
    'refused', case when refused then 'refused [' || state || '] ' || msg
                    else 'ALLOWED' end,
    refused);
end $$;

/* Attempt to dictate the amount. The server must overwrite it: a weekend day
   at ₦16,000 × 2 is ₦32,000 no matter what the client sends.

   AS THE OWNER, not as the employee. This check inherits Phase 2's role, and
   the employee role cannot insert a day at all — check 17 proves exactly that
   — so the insert was refused by RLS and the trigger the check exists to
   exercise was never reached. A check that cannot reach its own subject and
   reports "refused" looks almost identical to one that passes, which is why
   this was invisible for three phases. */
reset role;
do $$
declare paid numeric;
begin
  insert into public.day_records (employee_id, work_date, kind, amount, rate)
  values ('11111111-1111-4111-8111-111111111111', current_date - 6, 'weekend', 1, 1)
  returning amount into paid;
  perform public._harness_record(
    18, 'FORGERY', 'client-sent amount ignored; server computed 32000',
    '32000', paid::text, paid = 32000);
exception when others then
  perform public._harness_record(
    18, 'FORGERY', 'client-sent amount ignored; server computed 32000',
    '32000', 'ERROR: ' || sqlerrm, false);
end $$;

-- Hand back to the employee: everything after this runs as the worker again.
set local role authenticated;
do $$
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );
end $$;

-- ── Attendance sessions, from the worker's side ───────────────────────────
-- The brief says the workplace code must not be exposed inside the employee
-- interface. The strongest form of that is the ROW being unreadable — a UI
-- that merely hides it would still hand it over to a browser console.

select public._harness_record(
  19, 'SESSIONS', 'worker CANNOT read any attendance session (code invisible)',
  '0', (select count(*)::text from public.attendance_sessions),
  (select count(*) from public.attendance_sessions) = 0);

-- ...and yet they are still told attendance is open, without the code.
do $$
declare r record;
begin
  select * into r from public.my_attendance_status();
  perform public._harness_record(
    20, 'SESSIONS', 'my_attendance_status says open WITHOUT the code',
    'open for Harness Contractor A',
    coalesce(r.contractor_name,'(none)') || ' / is_open=' || coalesce(r.is_open::text,'null'),
    r.is_open is true and r.contractor_name = 'Harness Contractor A');
exception when others then
  perform public._harness_record(
    20, 'SESSIONS', 'my_attendance_status says open WITHOUT the code',
    'open for Harness Contractor A', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── Three wrong codes, and the question of whether they differ ────────────
-- These are run together, capturing the message from each, because the point
-- is not only that each is refused — it is that the refusals are
-- INDISTINGUISHABLE. A worker must not be able to tell a code belonging to
-- nobody from a code belonging to the contractor next door: the second answer
-- would confirm the number was real and hand over a name, which turns the
-- check-in endpoint into a validation oracle.
--
-- All three calls happen inside one block so the attempt budget is spent once
-- (three of five), leaving room for the correct-code check that follows.
do $$
declare
  r_stale record; r_other record; r_junk record;
  msg_stale text;   -- a well-formed code whose session ended yesterday
  msg_other text;   -- a LIVE code belonging to a different contractor
  msg_junk  text;   -- a code that is nobody's
  shot      text;
begin
  /* v11: these used to be caught as exceptions. Migration 017 made a refusal a
     RETURNED value, because raising one rolled back the attempt record the
     function had just written — which is why the five-attempt cap never fired.
     A refusal is `ok = false` with a message; nothing is thrown. */
  select * into r_stale from public.check_in_with_code('0000');
  msg_stale := r_stale.message;
  select * into r_other from public.check_in_with_code('1357');
  msg_other := r_other.message;
  select * into r_junk from public.check_in_with_code('9999');
  msg_junk := r_junk.message;

  perform public._harness_record(
    21, 'SESSIONS', 'yesterday''s code is refused',
    'refused (ok=false)', coalesce(msg_stale, 'ACCEPTED — a stale code recorded a day'),
    r_stale.ok is false and msg_stale is not null);

  perform public._harness_record(
    22, 'SESSIONS', 'another contractor''s code is refused',
    'refused (ok=false)', coalesce(msg_other, 'ACCEPTED — the code worked for the wrong contractor'),
    r_other.ok is false and msg_other is not null);

  perform public._harness_record(
    23, 'SESSIONS', 'a code that is nobody''s is refused',
    'refused (ok=false)', coalesce(msg_junk, 'ACCEPTED — a guessed code worked'),
    r_junk.ok is false and msg_junk is not null);

  /* The check that actually tests the leak. If a wrong-but-real code and a
     wrong-and-fake code produce the same sentence, there is nothing to learn
     from probing. If they differ at all, the oracle is back. */
  select case
           when r_stale.ok is not false or r_other.ok is not false or r_junk.ok is not false
             then 'one or more calls were ACCEPTED'
           when msg_stale is null or msg_other is null or msg_junk is null
             then 'one or more calls were ACCEPTED'
           when msg_stale = msg_other and msg_other = msg_junk
             then 'identical: "' || msg_stale || '"'
           else 'DIFFERENT — "'
                || concat_ws('" / "', msg_stale, msg_other, msg_junk) || '"'
         end
    into shot;

  perform public._harness_record(
    24, 'SESSIONS', 'a real code for another contractor reads EXACTLY like a fake one',
    'identical messages for all three',
    shot,
    r_stale.ok is false and r_other.ok is false and r_junk.ok is false
      and msg_stale is not null and msg_stale = msg_other and msg_other = msg_junk);

  /* Belt and braces: no contractor's name may appear in the refusal, whatever
     the text happens to say. */
  perform public._harness_record(
    25, 'SESSIONS', 'the refusal never names another contractor',
    'no contractor name in the message',
    coalesce(msg_other, '(none)'),
    r_other.ok is false
      and position('Harness Contractor A' in msg_other) = 0
      and position('Harness Contractor B' in msg_other) = 0);
end $$;

/* ── THE FIX ITSELF ─────────────────────────────────────────────────────────
   Every check above passed for three phases while the cap was dead, because
   each one only asked whether a refusal happened — and it did. None asked
   whether the attempt was RECORDED, and it never was: raising the refusal
   rolled back the insert that came before it, so six wrong codes left the
   table empty and the count could never reach five.

   Three wrong codes have been made at this point in the file, so three rows
   must be sitting there. This is the check that would have caught it, and it
   is here rather than at the end so that it sits beside the refusals it
   belongs to. Numbered 58 because inserting a number in the middle would
   renumber every check after it; the number is an id, not a position. */
reset role;
select public._harness_record(
  58, 'SESSIONS', 'each wrong code is RECORDED, so the cap can reach five',
  '3 rows', (select count(*)::text from public.check_in_attempts),
  (select count(*) from public.check_in_attempts) = 3);
set local role authenticated;
do $$
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );
end $$;


-- The real code, which must work.
do $$
declare r record;
begin
  select * into r from public.check_in_with_code('7429');
  perform public._harness_record(
    26, 'SESSIONS', 'the correct code records the day',
    'work', coalesce(r.kind,'(none)'),
    r.ok is true and r.kind = 'work' and r.work_date = current_date);
exception when others then
  perform public._harness_record(
    26, 'SESSIONS', 'the correct code records the day', 'work', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── The overlap bug ───────────────────────────────────────────────────────
-- Two live sessions cover this worker: their contractor's ('7429') and the
-- site-wide one ('8642'). Both codes are legitimately open to them, so BOTH
-- must be accepted. Before the fix, whichever session the planner returned
-- first was compared against, so one of these two codes was reported wrong.
/* Counting the sessions is a fact about the FIXTURE, not about permissions, so
   it runs as the owner. Read as the employee it returns 0 — which is what
   check 19 asserts a few lines above, so the two checks were contradicting each
   other and the file "failed" a database that was behaving perfectly. */
reset role;
select public._harness_record(
  27, 'SESSIONS', 'two live sessions cover this worker (the overlap is real)',
  '2', (select count(*)::text from public.attendance_sessions
          where status = 'open' and now() < expires_at
            and work_date = current_date
            and (contractor_id is null
                 or contractor_id = '33333333-3333-4333-8333-333333333333')),
  (select count(*) from public.attendance_sessions
     where status = 'open' and now() < expires_at
       and work_date = current_date
       and (contractor_id is null
            or contractor_id = '33333333-3333-4333-8333-333333333333')) = 2);

-- Hand back to the employee: everything after this runs as the worker again.
set local role authenticated;
do $$
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );
end $$;

-- The site-wide code. The day already exists, so success means `already`.
do $$
declare r record; n int;
begin
  select * into r from public.check_in_with_code('8642');
  select count(*) into n from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111' and work_date = current_date;
  perform public._harness_record(
    28, 'SESSIONS', 'the OTHER live code covering the worker is accepted, not refused',
    'accepted (already=true), 1 day',
    'accepted=' || coalesce(r.already::text,'?') || ', ' || n || ' day(s)',
    r.ok is true and r.already is true and n = 1);
exception when others then
  perform public._harness_record(
    28, 'SESSIONS', 'the OTHER live code covering the worker is accepted, not refused',
    'accepted (already=true), 1 day', 'REFUSED: ' || sqlerrm, false);
end $$;

-- And the employer's deterministic view must name the worker's OWN contractor,
-- not the site-wide row that happens to sort first.
do $$
declare r record;
begin
  select * into r from public.my_attendance_status();
  perform public._harness_record(
    29, 'SESSIONS', 'my_attendance_status prefers the worker''s own contractor',
    'Harness Contractor A', coalesce(r.contractor_name,'(null)'),
    r.is_open is true and r.contractor_name = 'Harness Contractor A');
exception when others then
  perform public._harness_record(
    29, 'SESSIONS', 'my_attendance_status prefers the worker''s own contractor',
    'Harness Contractor A', 'ERROR: ' || sqlerrm, false);
end $$;

select public._harness_record(
  30, 'SESSIONS', 'the recorded day is marked as a check-in',
  '1', (select count(*)::text from public.day_records
          where employee_id = '11111111-1111-4111-8111-111111111111'
            and work_date = current_date
            and source = 'check_in'),
  (select count(*) from public.day_records
     where employee_id = '11111111-1111-4111-8111-111111111111'
       and work_date = current_date
       and source = 'check_in') = 1);

-- Checking in twice must not create a second day, and must not error at
-- someone who did come to work.
do $$
declare r record;
begin
  select * into r from public.check_in_with_code('7429');
  perform public._harness_record(
    31, 'SESSIONS', 'checking in twice does not double the day',
    '1 day, already=true',
    (select count(*)::text from public.day_records
      where employee_id = '11111111-1111-4111-8111-111111111111'
        and work_date = current_date) || ' day(s), already=' || coalesce(r.already::text,'null'),
    r.already is true
    and (select count(*) from public.day_records
          where employee_id = '11111111-1111-4111-8111-111111111111'
            and work_date = current_date) = 1);
exception when others then
  perform public._harness_record(
    31, 'SESSIONS', 'checking in twice does not double the day',
    '1 day, already=true', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── The hole that used to exist ───────────────────────────────────────────
-- A worker could previously INSERT a day for any date. The insert policy now
-- requires an open session covering that worker and that date. A date three
-- days out has none, and the worker DOES have a rate period covering it, so
-- the session rule is the only thing that can refuse this.
do $$
begin
  insert into public.day_records (employee_id, work_date, kind)
  values ('11111111-1111-4111-8111-111111111111', current_date + 3, 'work');
  perform public._harness_record(
    32, 'SESSIONS', 'worker CANNOT insert a day with no session open',
    'refused', 'ACCEPTED — a day was created with no session', false);
exception when others then
  perform public._harness_record(
    32, 'SESSIONS', 'worker CANNOT insert a day with no session open', 'refused', sqlerrm, true);
end $$;

-- ── The other hole: self-promotion to double pay ──────────────────────────
-- kind drives the multiplier, so 'work' -> 'overtime' doubles the money through
-- the system's own arithmetic. The guard trigger must refuse it from a worker.
do $$
declare
  before_kind text; before_amt numeric;
  after_kind  text; after_amt  numeric;
begin
  select kind, amount into before_kind, before_amt
    from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111' and work_date = current_date;

  begin
    update public.day_records set kind = 'overtime'
     where employee_id = '11111111-1111-4111-8111-111111111111' and work_date = current_date;
  exception when others then
    null;   -- refused outright, which passes just as well as a silent no-op
  end;

  select kind, amount into after_kind, after_amt
    from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111' and work_date = current_date;

  perform public._harness_record(
    33, 'SESSIONS', 'worker CANNOT reclassify their own day to overtime',
    'kind=' || coalesce(before_kind,'?') || ' amount=' || coalesce(before_amt::text,'?'),
    'kind=' || coalesce(after_kind,'?') || ' amount=' || coalesce(after_amt::text,'?'),
    after_kind = before_kind and after_amt = before_amt);
end $$;

reset role;


-- ============================================================================
-- PHASE 3 — SIGNED-OUT VISITOR
-- ============================================================================
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select public._harness_record(
  34, 'ANON', 'signed-out visitor sees zero employees',
  '0', (select count(*)::text from public.employees),
  (select count(*) from public.employees) = 0);

select public._harness_record(
  35, 'ANON', 'signed-out visitor sees zero day records',
  '0', (select count(*)::text from public.day_records),
  (select count(*) from public.day_records) = 0);

select public._harness_record(
  36, 'ANON', 'signed-out visitor sees zero attendance sessions',
  '0', (select count(*)::text from public.attendance_sessions),
  (select count(*) from public.attendance_sessions) = 0);

reset role;


-- ============================================================================
-- PHASE 4 — WHICH MIGRATIONS ARE ACTUALLY INSTALLED
-- ============================================================================
-- Static assertions against the installed function bodies, run as the owner
-- after the role switches above. A green RLS report on a project that cannot
-- write a check-in is exactly the trap these three close.
--
-- If 37 fails, check-in cannot record anything — apply 011.
-- If 38 or 39 fails, a live, valid code can still be refused when a site-wide
-- and a contractor session are open on the same day — apply 010. If both fail,
-- apply 010 then 011.

select public._harness_record(
  37, 'MIGRATIONS', 'check_in_with_code can write a day (011 clause installed)',
  'installed', d.state, d.state = 'installed')
from (
  select case when exists (
    select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = 'check_in_with_code'
       and position('on conflict on constraint day_records_employee_id_work_date_key'
                    in pg_get_functiondef(p.oid)) > 0
  ) then 'installed' else 'MISSING - apply 011' end as state
) d;

select public._harness_record(
  38, 'MIGRATIONS', 'check_in_with_code orders deterministically (010 then 011)',
  'installed', d.state, d.state = 'installed')
from (
  select case when exists (
    select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = 'check_in_with_code'
       and position('order by (s.contractor_id is null), s.work_date desc, s.id'
                    in pg_get_functiondef(p.oid)) > 0
  ) then 'installed' else 'MISSING - apply 010 then 011' end as state
) d;

select public._harness_record(
  39, 'MIGRATIONS', 'my_attendance_status orders deterministically (010)',
  'installed', d.state, d.state = 'installed')
from (
  select case when exists (
    select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = 'my_attendance_status'
       and position('order by (s.contractor_id is null), s.work_date desc, s.id'
                    in pg_get_functiondef(p.oid)) > 0
  ) then 'installed' else 'MISSING - apply 010' end as state
) d;


-- ============================================================================
-- PHASE 4 — WHAT A WORKER MAY NOT DO TO THEIR OWN RECORD
-- ============================================================================
-- Phase 5 made the worker's screens read-only. Read-only in the UI is a
-- courtesy; this is the part that holds when someone opens the browser console.
-- The two rules that matter:
--
--   1. a day the employer has CONFIRMED cannot be deleted by the worker it
--      belongs to — settled money is not removable by the party it is owed to;
--   2. a claim the worker made themselves, still unresolved, CAN be withdrawn.
--      That is not a hole, it is the feature: "I tapped the wrong day" has to
--      be fixable without the employer, as long as nobody has agreed to it yet.

set local role authenticated;
do $$
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );
end $$;

do $$
declare
  n int;
  before_count int;
  after_count int;
begin
  -- Settle one day, as the employer. The worker is watching: everything below
  -- happens as them, on their own row.
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );
  update public.day_records set status = 'confirmed'
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and work_date = current_date - 2;

  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select count(*) into before_count from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111' and status = 'confirmed';

  delete from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111' and status = 'confirmed';
  get diagnostics n = row_count;

  select count(*) into after_count from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111' and status = 'confirmed';

  perform public._harness_record(
    40, 'EMPLOYEE', 'worker CANNOT delete a day the employer confirmed',
    '0 deleted, the row still there',
    n || ' deleted, ' || before_count || ' -> ' || after_count || ' confirmed row(s)',
    n = 0 and before_count = 1 and after_count = 1);
exception when others then
  perform public._harness_record(
    40, 'EMPLOYEE', 'worker CANNOT delete a day the employer confirmed',
    '0 deleted, the row still there', 'ERROR: ' || sqlerrm, false);
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and work_date = current_date and status = 'claimed';

  if n = 0 then
    perform public._harness_record(
      41, 'EMPLOYEE', 'worker CAN withdraw their own unconfirmed day',
      '1 withdrawn', 'no unconfirmed day to withdraw (nothing to test)', false);
  else
    delete from public.day_records
     where employee_id = '11111111-1111-4111-8111-111111111111'
       and work_date = current_date and status = 'claimed';
    get diagnostics n = row_count;
    perform public._harness_record(
      41, 'EMPLOYEE', 'worker CAN withdraw their own unconfirmed day',
      '1 withdrawn', n || ' withdrawn', n = 1);
  end if;
exception when others then
  perform public._harness_record(
    41, 'EMPLOYEE', 'worker CAN withdraw their own unconfirmed day',
    '1 withdrawn', 'ERROR: ' || sqlerrm, false);
end $$;

reset role;


-- ============================================================================
-- PHASE 6 — WHAT A WORKER MAY ASK FOR (checks 42-47)
-- ============================================================================
-- Phase 5 made a worker's month read-only. The brief still requires that they
-- be able to raise a correction, so the two must be true at once: a worker
-- ASKS, and only the employer's answer changes the ledger. These checks are
-- that sentence, executed.
--
-- The database half of this is one table and one function (migration 012). The
-- thing being defended is not the row in correction_requests — it is that
-- answering one is the ONLY write path it opens, and that it is open only to
-- the employer who owns the worker.

-- ── 42. The worker can raise a request about their own day ────────────────
do $$
declare n int; st text;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  insert into public.correction_requests
    (employee_id, work_date, request_kind, want_kind, message)
  values
    ('11111111-1111-4111-8111-111111111111', current_date - 2,
     'reclassify', 'overtime', 'I worked overtime that day.');

  select count(*), max(status) into n, st
    from public.correction_requests
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and work_date = current_date - 2;

  perform public._harness_record(
    42, 'CORRECTIONS', 'worker CAN ask for a correction on their own day',
    '1 request, open', n || ' request(s), ' || coalesce(st, 'none'), n = 1 and st = 'open');
exception when others then
  perform public._harness_record(
    42, 'CORRECTIONS', 'worker CAN ask for a correction on their own day',
    '1 request, open', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 43. ...but not about anybody else's ───────────────────────────────────
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  insert into public.correction_requests
    (employee_id, work_date, request_kind, want_kind, message)
  values
    ('22222222-2222-4222-8222-222222222222', current_date - 2,
     'reclassify', 'overtime', 'Not mine to ask about.');

  perform public._harness_record(
    43, 'CORRECTIONS', 'worker CANNOT raise a request about a colleague''s day',
    'refused', 'ACCEPTED — the request was filed against someone else', false);
exception when others then
  perform public._harness_record(
    43, 'CORRECTIONS', 'worker CANNOT raise a request about a colleague''s day',
    'refused', sqlerrm, true);
end $$;

-- ── 44. The worker cannot approve their own request ───────────────────────
-- This is the one that matters. If a worker could set status = 'approved' on
-- their own request, they would have a second way to write the ledger — after
-- Phase 5 closed the first one — and the employer's answer would be forgeable.
-- The policy's WITH CHECK allows 'withdrawn' and nothing else.
do $$
declare st text;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  begin
    update public.correction_requests set status = 'approved'
     where employee_id = '11111111-1111-4111-8111-111111111111'
       and work_date = current_date - 2;
  exception when others then
    null;   -- refused outright, which passes just as well as a silent no-op
  end;

  select max(status) into st
    from public.correction_requests
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and work_date = current_date - 2;

  perform public._harness_record(
    44, 'CORRECTIONS', 'worker CANNOT approve their own request',
    'still open', coalesce(st, 'none'), st = 'open');
exception when others then
  perform public._harness_record(
    44, 'CORRECTIONS', 'worker CANNOT approve their own request',
    'still open', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 45. One open request per day, enforced by the database ────────────────
-- A double tap on a flaky connection must not put two identical requests in
-- the employer's queue. The rule lives in a partial unique index, so it holds
-- no matter what the UI does.
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  insert into public.correction_requests
    (employee_id, work_date, request_kind, want_kind, message)
  values
    ('11111111-1111-4111-8111-111111111111', current_date - 2,
     'reclassify', 'overtime', 'Second tap.');

  select count(*) into n from public.correction_requests
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and work_date = current_date - 2;

  perform public._harness_record(
    45, 'CORRECTIONS', 'a second open request for the same day is refused',
    '1 request', n || ' request(s)', false);
exception when unique_violation then
  perform public._harness_record(
    45, 'CORRECTIONS', 'a second open request for the same day is refused',
    'refused', 'unique_violation', true);
when others then
  perform public._harness_record(
    45, 'CORRECTIONS', 'a second open request for the same day is refused',
    'refused', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 46. The employer approves, and the LEDGER changes ─────────────────────
-- The day under this request was confirmed by check 40, so this exercises the
-- hard path: a confirmed day's money is frozen by the guard trigger, and
-- reclassifying to overtime changes the money. The function must reopen,
-- reclassify, and leave the day confirmed — which is what the employer meant.
do $$
declare
  v_id      uuid;
  v_req     public.correction_requests%rowtype;
  v_after   public.day_records%rowtype;
  v_events  int;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select id into v_id
    from public.correction_requests
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and work_date = current_date - 2
     and status = 'open';

  select * into v_req from public.resolve_correction(v_id, true, 'Confirmed with the crew.');

  select * into v_after
    from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and work_date = current_date - 2;

  select count(*) into v_events
    from public.day_record_events
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and created_at > now() - interval '1 minute';

  perform public._harness_record(
    46, 'CORRECTIONS', 'approving overtime reclassifies the day and keeps it confirmed',
    'overtime, confirmed, 2x, request approved',
    v_after.kind || ', ' || v_after.status || ', ' || v_after.amount || ', request ' || v_req.status,
    v_after.kind = 'overtime'
      and v_after.status = 'confirmed'
      and v_after.amount = v_after.rate * 2
      and v_after.source = 'correction'
      and v_req.status = 'approved'
      and v_req.resolved_by is not null);
exception when others then
  perform public._harness_record(
    46, 'CORRECTIONS', 'approving overtime reclassifies the day and keeps it confirmed',
    'overtime, confirmed, 2x, request approved', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 47. An answered request does not block a later one ────────────────────
-- The partial index covers OPEN requests only. Without that, a worker whose
-- request was rejected could never raise another about the same day, and the
-- uniqueness rule meant to stop double taps would become a permanent ban.
do $$
declare st text;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  insert into public.correction_requests
    (employee_id, work_date, request_kind, message)
  values
    ('11111111-1111-4111-8111-111111111111', current_date - 2,
     'remove', 'And actually I was not there either.');

  select max(status) into st from public.correction_requests
   where employee_id = '11111111-1111-4111-8111-111111111111'
     and work_date = current_date - 2;

  perform public._harness_record(
    47, 'CORRECTIONS', 'an answered request does not block a new one',
    'a second request exists', 'latest status ' || coalesce(st, 'none'),
    (select count(*) from public.correction_requests
      where employee_id = '11111111-1111-4111-8111-111111111111'
        and work_date = current_date - 2) = 2);
exception when others then
  perform public._harness_record(
    47, 'CORRECTIONS', 'an answered request does not block a new one',
    'a second request exists', 'ERROR: ' || sqlerrm, false);
end $$;

-- ============================================================================
-- PHASE 7 — WHAT MAY BE BILLED, AND WHAT A DOCUMENT MAY NOT DO (checks 48-57)
-- ============================================================================
-- Phase 7 adds an invoice: a period, frozen into a document the employer can
-- hand to a contractor. Three things have to be true at once, and these checks
-- are those sentences executed:
--
--   1. The figures on it are the ledger's own. The database counts and sums the
--      stored days; it never re-values one. Check 48 compares the document with
--      an independent sum of the same rows, so a second calculation engine
--      cannot creep in unnoticed.
--   2. It cannot be double-issued, hand-written, or deleted. Only voided — a
--      wrong invoice stays on file, because the fact that it was sent matters.
--   3. A worker may not read one. A line only means something beside everyone
--      else's pay on the same document, and it is not the worker's business.
--
-- The day values here come from earlier checks (46 made current_date - 2 an
-- approved overtime day), so nothing is hardcoded: the expected total is
-- computed from the ledger at the moment the check runs.

-- ── 48. The employer can bill a period, and the total is the ledger's own ──
do $$
declare v_inv public.invoices%rowtype; v_ledger numeric;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select * into v_inv
    from public.issue_invoice(
      '33333333-3333-4333-8333-333333333333', current_date - 6, current_date, 'Harness');

  select coalesce(sum(d.amount), 0) into v_ledger
    from public.day_records d
    join public.employees e on e.id = d.employee_id
   where e.contractor_id = '33333333-3333-4333-8333-333333333333'
     and d.work_date between current_date - 6 and current_date;

  perform public._harness_record(
    48, 'BILLING', 'the employer can bill a period, and the total is the ledger sum',
    'issued, total = sum of stored amounts',
    coalesce(v_inv.number, 'no document') || ' · ' || coalesce(v_inv.total::text, '?')
      || ' vs ledger ' || v_ledger,
    v_inv.id is not null
      and v_inv.status = 'issued'
      and v_inv.total = v_ledger
      and v_inv.worker_count >= 1
      and v_inv.actual_days >= 1);
exception when others then
  perform public._harness_record(
    48, 'BILLING', 'the employer can bill a period, and the total is the ledger sum',
    'issued, total = sum of stored amounts', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 49. The document adds up to its own lines ─────────────────────────────
-- The invariant that makes an invoice worth anything. If this ever fails, the
-- document and its detail disagree and nobody can tell which figure to trust.
do $$
declare v_total numeric; v_sum numeric; v_lines int;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select total into v_total from public.invoices
   where contractor_id = '33333333-3333-4333-8333-333333333333' and status = 'issued'
   order by issued_at desc limit 1;

  select coalesce(sum(amount), 0), count(*) into v_sum, v_lines
    from public.invoice_lines
   where invoice_id = (select id from public.invoices
                        where contractor_id = '33333333-3333-4333-8333-333333333333'
                          and status = 'issued'
                        order by issued_at desc limit 1);

  perform public._harness_record(
    49, 'BILLING', 'the document total is exactly the sum of its lines',
    'total = sum(lines.amount)', v_total || ' vs ' || v_sum || ' over ' || v_lines || ' line(s)',
    v_lines >= 1 and v_total = v_sum);
exception when others then
  perform public._harness_record(
    49, 'BILLING', 'the document total is exactly the sum of its lines',
    'total = sum(lines.amount)', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 50. The same period cannot be billed twice ────────────────────────────
-- Enforced by a partial unique index, not by a disabled button: two devices, or
-- a double tap, must not produce two invoices for the same work.
do $$
declare v_msg text := 'no error — a second invoice was allowed';
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  begin
    perform public.issue_invoice(
      '33333333-3333-4333-8333-333333333333', current_date - 6, current_date);
  exception when others then
    v_msg := sqlerrm;
  end;

  perform public._harness_record(
    50, 'BILLING', 'billing the same period twice is refused by the database',
    'a refusal naming the existing invoice',
    left(v_msg, 90),
    position('already been billed' in v_msg) > 0);
exception when others then
  perform public._harness_record(
    50, 'BILLING', 'billing the same period twice is refused by the database',
    'a refusal naming the existing invoice', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 51. A period with no days cannot be billed, and leaves nothing behind ──
do $$
declare v_msg text := 'no error — an empty period was billed'; v_left int;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  begin
    perform public.issue_invoice(
      '33333333-3333-4333-8333-333333333333', current_date - 400, current_date - 390);
  exception when others then
    v_msg := sqlerrm;
  end;

  select count(*) into v_left from public.invoices
   where period_from = current_date - 400;

  perform public._harness_record(
    51, 'BILLING', 'a period with no recorded days is refused, and leaves no document',
    'refused, 0 documents on that period',
    left(v_msg, 70) || ' · ' || v_left || ' document(s) left',
    position('nothing to bill' in v_msg) > 0 and v_left = 0);
exception when others then
  perform public._harness_record(
    51, 'BILLING', 'a period with no recorded days is refused, and leaves no document',
    'refused, 0 documents on that period', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 52. A wrong invoice is voided, kept, and replaced ─────────────────────
do $$
declare v_old public.invoices%rowtype; v_new public.invoices%rowtype;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select * into v_old from public.invoices
   where contractor_id = '33333333-3333-4333-8333-333333333333' and status = 'issued'
   order by issued_at desc limit 1;

  perform public.void_invoice(v_old.id, 'Wrong period.');

  select * into v_new
    from public.issue_invoice(
      '33333333-3333-4333-8333-333333333333', v_old.period_from, v_old.period_to);

  select * into v_old from public.invoices where id = v_old.id;

  perform public._harness_record(
    52, 'BILLING', 'a voided invoice is kept and reissuing gets a new number',
    'old = void with its figures, new = issued, different number',
    coalesce(v_old.number, '?') || '/' || coalesce(v_old.status, '?')
      || ' → ' || coalesce(v_new.number, '?') || '/' || coalesce(v_new.status, '?'),
    v_old.status = 'void'
      and v_old.void_reason = 'Wrong period.'
      and v_old.total = v_new.total
      and v_new.status = 'issued'
      and v_new.number <> v_old.number
      and v_new.id <> v_old.id);
exception when others then
  perform public._harness_record(
    52, 'BILLING', 'a voided invoice is kept and reissuing gets a new number',
    'old = void with its figures, new = issued, different number',
    'ERROR: ' || sqlerrm, false);
end $$;

-- ── 53. The unassigned workers are billable in their own right ────────────
-- The colleague has no contractor. Those days are still owed, so "no
-- contractor" is a bill of its own — and a NULL contractor id must not defeat
-- the double-billing guard.
do $$
declare v_inv public.invoices%rowtype; v_msg text := 'no error — billed twice';
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select * into v_inv from public.issue_invoice(null, current_date - 6, current_date);

  begin
    perform public.issue_invoice(null, current_date - 6, current_date);
  exception when others then
    v_msg := sqlerrm;
  end;

  perform public._harness_record(
    53, 'BILLING', 'the unassigned workers can be billed, and only once',
    'a document named for them, then a refusal',
    coalesce(v_inv.contractor_name, '?') || ' · ' || coalesce(v_inv.worker_count::text, '?')
      || ' worker(s) · ' || left(v_msg, 50),
    v_inv.id is not null
      and v_inv.contractor_name = 'Unassigned workers'
      and v_inv.worker_count >= 1
      and position('already been billed' in v_msg) > 0);
exception when others then
  perform public._harness_record(
    53, 'BILLING', 'the unassigned workers can be billed, and only once',
    'a document named for them, then a refusal', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 54. The worker may not read any invoice ───────────────────────────────
do $$
declare n int; l int;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select count(*) into n from public.invoices;
  select count(*) into l from public.invoice_lines;

  perform public._harness_record(
    54, 'BILLING', 'a worker cannot read an invoice, not even their own line',
    '0 documents, 0 lines', n || ' document(s), ' || l || ' line(s)', n = 0 and l = 0);
exception when others then
  perform public._harness_record(
    54, 'BILLING', 'a worker cannot read an invoice, not even their own line',
    '0 documents, 0 lines', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 55. ...and may not issue one, nor hand-write one ──────────────────────
do $$
declare v_issue text := 'no error — the worker billed a period';
declare v_write text := 'no error — the worker wrote a document';
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  begin
    perform public.issue_invoice('33333333-3333-4333-8333-333333333333',
                                 current_date - 300, current_date - 290);
  exception when others then
    v_issue := sqlerrm;
  end;

  begin
    insert into public.invoices (employer_id, contractor_name, number, period_from, period_to, total)
    values ((select employer_uid from _ids), 'Made Up', 'INV-9999',
            current_date - 300, current_date - 290, 999999);
  exception when others then
    v_write := sqlerrm;
  end;

  perform public._harness_record(
    55, 'BILLING', 'a worker can neither issue a document nor write one by hand',
    'both refused', left(v_issue, 40) || ' / ' || left(v_write, 40),
    position('not yours' in v_issue) > 0
      or position('permission denied' in v_issue) > 0
      or position('permission denied' in v_write) > 0);
exception when others then
  perform public._harness_record(
    55, 'BILLING', 'a worker can neither issue a document nor write one by hand',
    'both refused', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 56. Even the employer cannot edit one, nor delete it ──────────────────
do $$
declare v_upd text := 'no error — the employer edited a frozen figure';
declare v_del text := 'no error — the employer deleted a document';
declare v_id uuid;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select id into v_id from public.invoices order by issued_at desc limit 1;

  begin
    update public.invoices set total = 1 where id = v_id;
  exception when others then
    v_upd := sqlerrm;
  end;

  begin
    delete from public.invoices where id = v_id;
  exception when others then
    v_del := sqlerrm;
  end;

  perform public._harness_record(
    56, 'BILLING', 'a frozen figure cannot be edited, and a document cannot be deleted',
    'both refused', left(v_upd, 40) || ' / ' || left(v_del, 40),
    position('permission denied' in v_upd) > 0
      and position('permission denied' in v_del) > 0);
exception when others then
  perform public._harness_record(
    56, 'BILLING', 'a frozen figure cannot be edited, and a document cannot be deleted',
    'both refused', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 57. Another employer sees none of it ──────────────────────────────────
-- The harness has two accounts; the second is a worker, not an employer, so
-- this is the strongest neighbouring case available here: a signed-in account
-- that owns nothing sees nothing.
do $$
declare n int; l int;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select count(*) into n from public.invoices where employer_id <> auth.uid();
  select count(*) into l from public.invoice_lines
   where invoice_id in (select id from public.invoices);

  perform public._harness_record(
    57, 'BILLING', 'documents never leak to an account that does not own them',
    '0 foreign documents, 0 lines', n || ' / ' || l, n = 0 and l = 0);
exception when others then
  perform public._harness_record(
    57, 'BILLING', 'documents never leak to an account that does not own them',
    '0 foreign documents, 0 lines', 'ERROR: ' || sqlerrm, false);
end $$;


-- ============================================================================
-- THE ATTENDANCE PIN (migration 018)
-- ============================================================================
-- Numbered from 59 because 58 is taken and the number is an id, not a
-- position. These are the checks that make four digits defensible: the PIN is
-- never stored as itself, a worker cannot issue one for anybody, a worker
-- cannot use the verifier as a guessing oracle, and five wrong guesses shut
-- the door.

-- ── 59, 60. The employer issues a PIN ─────────────────────────────────────
do $$
declare
  v_pin  text;
  v_hash text;
  v_salt text;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  v_pin := public.set_attendance_pin('11111111-1111-4111-8111-111111111111');

  perform public._harness_record(
    59, 'PIN', 'the employer can give a worker a PIN, and it comes back as four digits',
    '4 digits', coalesce(v_pin, '(none)'),
    v_pin is not null and v_pin ~ '^[0-9]{4}$');

  /* THE PIN MUST NOT BE SITTING IN THE DATABASE. The employer can read these
     columns — they are their worker's row — so this is a real read, not a
     peek at something the API hides. */
  select pin_hash, pin_salt into v_hash, v_salt
    from public.employees where id = '11111111-1111-4111-8111-111111111111';

  perform public._harness_record(
    60, 'PIN', 'what is stored is a digest, not the PIN itself',
    '64 hex chars, salted, and not equal to the PIN',
    coalesce(left(v_hash, 16), '(null)') || '… salt ' || coalesce(length(v_salt)::text, '0') || ' chars',
    v_hash is not null and v_hash ~ '^[0-9a-f]{64}$'
      and v_hash <> v_pin and v_salt is not null and length(v_salt) >= 16);
exception when others then
  perform public._harness_record(
    59, 'PIN', 'the employer can give a worker a PIN, and it comes back as four digits',
    '4 digits', 'ERROR: ' || sqlerrm, false);
  perform public._harness_record(
    60, 'PIN', 'what is stored is a digest, not the PIN itself',
    'a hash', 'not reached', false);
end $$;

-- ── 61. A worker cannot issue one, for themselves or anybody else ─────────
do $$
declare v_err text := 'no error — a worker issued a PIN';
declare v_pin text;
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  begin
    v_pin := public.set_attendance_pin('11111111-1111-4111-8111-111111111111');
  exception when others then
    v_err := sqlerrm;
  end;

  -- And the direction that matters more: a colleague.
  if v_err like 'no error%' then
    begin
      v_pin := public.set_attendance_pin('22222222-2222-4222-8222-222222222222');
      v_err := 'no error — a worker issued a PIN for a colleague';
    exception when others then
      v_err := sqlerrm;
    end;
  end if;

  perform public._harness_record(
    61, 'PIN', 'a worker CANNOT issue a PIN, for themselves or a colleague',
    'both refused', left(v_err, 60), position('not on your roster' in v_err) > 0);
exception when others then
  perform public._harness_record(
    61, 'PIN', 'a worker CANNOT issue a PIN, for themselves or a colleague',
    'both refused', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 62. The verifier is not a guessing oracle for a signed-in worker ──────
-- The whole point of a 4-digit PIN is that it cannot be tried in a loop. If a
-- signed-in account can call the verifier directly, it can. This check is the
-- reason verify_attendance_pin is executable by the owner and nobody else.
do $$
declare v_err text := 'no error — a worker called the verifier';
begin
  begin
    perform public.verify_attendance_pin('11111111-1111-4111-8111-111111111111', '0000');
  exception when others then
    v_err := sqlerrm;
  end;

  perform public._harness_record(
    62, 'PIN', 'a worker CANNOT call the PIN verifier in a loop',
    'refused', left(v_err, 60),
    position('permission denied' in v_err) > 0 or position('does not exist' in v_err) > 0);
exception when others then
  perform public._harness_record(
    62, 'PIN', 'a worker CANNOT call the PIN verifier in a loop',
    'refused', 'ERROR: ' || sqlerrm, false);
end $$;

reset role;

-- ── 63–66. The PIN itself, as the owner, because only the owner may check ──
do $$
declare
  v_status text;
  v_fails  int;
  v_locked timestamptz;
  emp      uuid := '11111111-1111-4111-8111-111111111111';
begin
  /* The PIN issued in check 59 is not readable from here — that is the whole
     design, and this block cannot cheat around it. So the verifier is tested
     against a PIN written directly as the owner: the salt already on the row
     is reused with a known value, which also proves pin_hash() is deterministic
     for the same salt and PIN. Nothing here guesses what the four digits were. */
  update public.employees
     set pin_hash = public.pin_hash('4321', pin_salt),
         pin_fails = 0, pin_locked_until = null
   where id = emp;

  -- 63. The right PIN verifies.
  v_status := public.verify_attendance_pin(emp, '4321');
  perform public._harness_record(
    63, 'PIN', 'the right PIN verifies as ok',
    'ok', v_status, v_status = 'ok');

  -- 64. A wrong PIN is REFUSED AND RECORDED. This is migration 017's lesson,
  --     applied before the mistake: if a wrong PIN raised, the write would be
  --     rolled back by the very failure it was recording, and the lockout
  --     below could never fire.
  v_status := public.verify_attendance_pin(emp, '0001');
  select pin_fails into v_fails from public.employees where id = emp;
  perform public._harness_record(
    64, 'PIN', 'a wrong PIN is refused AND written down, so the cap can count it',
    'wrong, 1 recorded', v_status || ', ' || coalesce(v_fails::text, '?') || ' recorded',
    v_status = 'wrong' and v_fails = 1);

  -- 65. Five wrong guesses close the door, and the CORRECT PIN stops working.
  --     A lockout that still accepts the right PIN is not a lockout.
  perform public.verify_attendance_pin(emp, '0002');
  perform public.verify_attendance_pin(emp, '0003');
  perform public.verify_attendance_pin(emp, '0004');
  v_status := public.verify_attendance_pin(emp, '0005');   -- the fifth
  v_status := public.verify_attendance_pin(emp, '4321');   -- the right one, now late

  select pin_fails, pin_locked_until into v_fails, v_locked
    from public.employees where id = emp;

  perform public._harness_record(
    65, 'PIN', 'five wrong guesses lock the PIN, and the right PIN stops working too',
    'locked', v_status,
    v_status = 'locked' and v_locked is not null and v_locked > now());

  -- 66. A worker with no PIN cannot be verified against anything.
  update public.employees
     set pin_hash = null, pin_salt = null, pin_fails = 0, pin_locked_until = null
   where id = '22222222-2222-4222-8222-222222222222';

  v_status := public.verify_attendance_pin('22222222-2222-4222-8222-222222222222', '0000');
  perform public._harness_record(
    66, 'PIN', 'a worker with NO PIN matches nothing, not even a guess of 0000',
    'not_set', v_status, v_status = 'not_set');
exception when others then
  perform public._harness_record(
    63, 'PIN', 'the right PIN verifies as ok',
    'ok', 'ERROR: ' || sqlerrm, false);
end $$;


-- ============================================================================
-- THE SITE KIOSK (migration 019)
-- ============================================================================
-- The kiosk is the one surface a stranger can walk up to, so its checks are the
-- ones that matter most. Everything below runs as a LINKED DEVICE or as an
-- account that is deliberately not one.
--
-- Numbered from 67. The number is an id, not a position.

-- ── Setup, as the owner ────────────────────────────────────────────────────
-- A device account is an ordinary account that has been linked. The harness
-- uses the employee account as the machine, which also proves the point: being
-- a device does not make you an employer, and being a worker does not let you
-- use the kiosk until somebody links you to one.
reset role;
insert into public.attendance_devices (id, employer_id, label, device_user_id, status, linked_at)
select '99999999-9999-4999-8999-999999999999', employer_uid, 'Harness Site Kiosk',
       employee_uid, 'active', now()
from _ids;

-- Known PINs for both workers, and the lock left over from the PIN phase
-- cleared — that lock was the point of check 65 and would otherwise fail every
-- kiosk check below for reasons that have nothing to do with the kiosk.
update public.employees
   set pin_salt = 'harnesskiosksalt', pin_hash = public.pin_hash('4321', 'harnesskiosksalt'),
       pin_fails = 0, pin_locked_until = null
 where id = '11111111-1111-4111-8111-111111111111';

update public.employees
   set pin_salt = 'harnesskiosksalt2', pin_hash = public.pin_hash('2468', 'harnesskiosksalt2'),
       pin_fails = 0, pin_locked_until = null
 where id = '22222222-2222-4222-8222-222222222222';

/* A second employer with a worker of their own — the "somebody else's site"
   case. Before the kiosk existed there was no path where one employer's machine
   named another employer's worker, so this fixture is new.

   The account row comes first, and it is not optional: employers.user_id is a
   foreign key into auth.users, so inserting the business without its account
   fails with a constraint violation before any check runs. It is inserted
   AFTER _ids was materialised at the top of the file, so it cannot disturb the
   "two most recent accounts" the rest of the harness picks. */
insert into auth.users (id, email)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other-employer@example.com');

insert into public.employers (user_id, business_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Other Employer Ltd');

insert into public.employees (id, employer_id, full_name, email, employee_user_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Someone Else''s Worker', 'elsewhere@example.com', null);

-- ── 67. An account that is not a linked device cannot use the kiosk ───────
-- The employer is a signed-in account with no device row. If this were allowed,
-- the kiosk functions would be a public attendance API.
do $$
declare r record;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select * into r from public.kiosk_check_in(
    '22222222-2222-4222-8222-222222222222', null, '2468', '8642');

  perform public._harness_record(
    67, 'KIOSK', 'an account that is not a linked device cannot use the kiosk',
    'refused', coalesce(r.message, '(allowed!)'),
    r.ok is false and r.message like '%not linked%');
end $$;

-- ── 68. A linked device sees its roster, and no money in it ───────────────
do $$
declare r record; payload text;
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select * into r from public.kiosk_roster();
  payload := coalesce(r.people::text, '') || coalesce(r.contractors::text, '');

  perform public._harness_record(
    68, 'KIOSK', 'the kiosk gets the roster — and nothing about pay',
    'people + contractors, no rate/amount',
    jsonb_array_length(r.people) || ' people, ' || jsonb_array_length(r.contractors) || ' contractors',
    jsonb_array_length(r.people) >= 2
      and jsonb_array_length(r.contractors) >= 1
      and position('rate' in payload) = 0
      and position('amount' in payload) = 0
      and position('₦' in payload) = 0);
exception when others then
  perform public._harness_record(
    68, 'KIOSK', 'the kiosk gets the roster — and nothing about pay',
    'people + contractors', 'ERROR: ' || sqlerrm, false);
end $$;

-- ── 69. The wrong contractor ──────────────────────────────────────────────
-- Worker 1111 belongs to Contractor A. The kiosk passes Contractor B, because
-- that is what somebody would do to try to check in under a different crew.
do $$
declare r record;
begin
  select * into r from public.kiosk_check_in(
    '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444',
    '4321', '1357');

  perform public._harness_record(
    69, 'KIOSK', 'a worker CANNOT check in under a contractor they are not assigned to',
    'refused', coalesce(r.message, '(allowed!)'),
    r.ok is false and r.message like '%not listed under that contractor%');
end $$;

-- ── 70. A wrong PIN, and the counter it must leave behind ─────────────────
do $$
declare r record; n int;
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select * into r from public.kiosk_check_in(
    '22222222-2222-4222-8222-222222222222', null, '0000', '8642');

  /* Read the counter as the OWNER. The device is employee 1111's account, and
     employees_self_select lets a worker see only their own row — so counting
     2222's failures from here returns no rows at all. That is a permission, not
     a fact, and the difference is exactly what made the old check-in lockout
     look broken for three phases. */
  reset role;
  select pin_fails into n from public.employees
   where id = '22222222-2222-4222-8222-222222222222';

  perform public._harness_record(
    70, 'KIOSK', 'a wrong PIN is refused AND written down, so the PIN cap can count',
    'wrong, 1 recorded', coalesce(r.message, '(none)') || ' / ' || coalesce(n::text, '?'),
    r.ok is false and r.message like '%PIN is not correct%' and n = 1);
end $$;

-- ── 71. A code from yesterday ─────────────────────────────────────────────
do $$
declare r record;
begin
  select * into r from public.kiosk_check_in(
    '22222222-2222-4222-8222-222222222222', null, '2468', '0000');

  perform public._harness_record(
    71, 'KIOSK', 'a site code from yesterday cannot be used today',
    'refused', coalesce(r.message, '(allowed!)'),
    r.ok is false and r.message like '%not valid now%');
end $$;

-- ── 72. Everything right ──────────────────────────────────────────────────
do $$
declare r record;
begin
  select * into r from public.kiosk_check_in(
    '22222222-2222-4222-8222-222222222222', null, '2468', '8642');

  perform public._harness_record(
    72, 'KIOSK', 'the right worker, PIN and site code records the day as kiosk',
    'ok, kiosk', coalesce(r.kind, '(none)') || ' / ' || coalesce(r.method, '(none)'),
    r.ok is true and r.already is false and r.method = 'kiosk' and r.work_date = current_date);
end $$;

-- ── 73. The same person, again ────────────────────────────────────────────
do $$
declare r record; n int;
begin
  select * into r from public.kiosk_check_in(
    '22222222-2222-4222-8222-222222222222', null, '2468', '8642');

  -- As the owner, for the same reason as check 70: a worker cannot count
  -- another worker's days, so counting from the device would always read 0.
  reset role;
  select count(*) into n from public.day_records
   where employee_id = '22222222-2222-4222-8222-222222222222' and work_date = current_date;

  perform public._harness_record(
    73, 'KIOSK', 'checking in twice creates no second day',
    'already, 1 row', 'already=' || r.already::text || ', ' || n || ' row(s)',
    r.ok is true and r.already is true and n = 1);
end $$;

-- ── 74. Somebody else's worker ────────────────────────────────────────────
-- The id is real, the PIN is real, the code is real. The worker belongs to a
-- different employer, and that is the whole of the reason this must fail.
reset role;
update public.employees
   set pin_salt = 'foreignsalt', pin_hash = public.pin_hash('1111', 'foreignsalt'),
       pin_fails = 0, pin_locked_until = null
 where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

do $$
declare r record; n int;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select * into r from public.kiosk_check_in(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, '1111', '8642');

  select count(*) into n from public.day_records
   where employee_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  perform public._harness_record(
    74, 'KIOSK', 'a device CANNOT record attendance for another employer''s worker',
    'refused, 0 rows', coalesce(r.message, '(allowed!)'),
    r.ok is false and r.message like '%not on this site%' and n = 0);
end $$;

-- ── 75. §19: the method cannot change the money ───────────────────────────
-- The kiosk row and the phone row are the same day, recorded two ways. If
-- attendance_method ever reached the money, this is where it would show.
--
-- The phone day is recorded HERE rather than borrowed from check 26, because
-- check 41 withdraws that day on purpose (a worker deleting their own
-- unconfirmed day) and the row is gone by now. Recording a fresh one also makes
-- the comparison honest: both rows are created inside this phase, minutes
-- apart, on the same date, by the two different routes.
do $$
declare r record;
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  select * into r from public.check_in_with_code('7429');
  perform public._harness_record(
    75, 'KIOSK', 'the phone route still works after the kiosk was added',
    'ok', coalesce(r.kind, '(none)') || ' via ' || case when r.ok then 'check_in' else coalesce(r.message,'?') end,
    r.ok is true);
end $$;

reset role;
do $$
declare
  k record;
  m record;
begin
  select amount, rate, multiplier, kind into k
    from public.day_records
   where employee_id = '22222222-2222-4222-8222-222222222222' and work_date = current_date;

  select amount, rate, multiplier, kind into m
    from public.day_records
   where employee_id = '11111111-1111-4111-8111-111111111111' and work_date = current_date;

  perform public._harness_record(
    76, 'KIOSK', 'a kiosk day and a phone day of the same kind are the same money',
    'amount = rate x multiplier on both, same multiplier',
    'kiosk ' || coalesce(k.rate::text,'?') || 'x' || coalesce(k.multiplier::text,'?') || '=' || coalesce(k.amount::text,'?')
      || ' / phone ' || coalesce(m.rate::text,'?') || 'x' || coalesce(m.multiplier::text,'?') || '=' || coalesce(m.amount::text,'?'),
    k.amount = k.rate * k.multiplier
      and m.amount = m.rate * m.multiplier
      and k.kind = m.kind
      and k.multiplier = m.multiplier);
end $$;

-- ── 77. Revocation is immediate ───────────────────────────────────────────
reset role;
update public.attendance_devices
   set status = 'revoked', revoked_at = now()
 where id = '99999999-9999-4999-8999-999999999999';

do $$
declare r record; roster_err text := 'no error — a revoked device read the roster';
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text
       from _ids),
    true
  );

  begin
    perform * from public.kiosk_roster();
  exception when others then
    roster_err := sqlerrm;
  end;

  select * into r from public.kiosk_check_in(
    '22222222-2222-4222-8222-222222222222', null, '2468', '8642');

  perform public._harness_record(
    77, 'KIOSK', 'revoking a device stops it at once, with no cached access',
    'roster refused and check-in refused',
    left(roster_err, 44) || ' / ' || coalesce(r.message, '(none)'),
    position('not linked' in roster_err) > 0 and r.ok is false);
end $$;


reset role;


-- ============================================================================
-- REPORT
-- ============================================================================
-- Drop the helper first so the report queries run as the owner cleanly.
drop function if exists public._harness_record(int, text, text, text, text, boolean);

select
  employer_email_used as "employer account",
  employee_email_used as "employee account",
  total_accounts      as "accounts in project"
from _ids;

select
  lpad(n::text, 2) as "#", area, check_name,
  expected, actual,
  case when pass then 'PASS' else 'FAIL' end as result
from _rls
order by n;

select
  count(*) filter (where pass)     as passed,
  count(*) filter (where not pass) as failed,
  count(*)                         as total,
  case
    when count(*) filter (where not pass) = 0
      then 'ALL CHECKS PASSED — isolation holds'
    else '*** FAILURES PRESENT — DO NOT USE THIS PROJECT FOR REAL DATA ***'
  end as verdict
from _rls;

rollback;

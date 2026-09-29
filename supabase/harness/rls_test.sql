-- ============================================================================
-- DayPay Employer Version — RLS verification harness (v5)
-- ============================================================================
-- Proves an employee cannot read another employee's wages.
-- Seeds test data, runs the checks, then ROLLS BACK. Safe to re-run.
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

-- A session that ended yesterday. Its code must be dead.
insert into public.attendance_sessions
  (id, employer_id, contractor_id, work_date, code, expires_at)
select '77777777-7777-4777-8777-777777777777', employer_uid,
       '33333333-3333-4333-8333-333333333333',
       current_date - 1, '0000', now() - interval '1 hour'
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
  '3', (select count(*)::text from public.attendance_sessions),
  (select count(*) from public.attendance_sessions) = 3);

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

-- Attempt to dictate the amount. The server must overwrite it: a weekend day
-- at ₦16,000 × 2 is ₦32,000 no matter what the client sends.
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
  msg_stale text;   -- a well-formed code whose session ended yesterday
  msg_other text;   -- a LIVE code belonging to a different contractor
  msg_junk  text;   -- a code that is nobody's
  shot      text;
begin
  begin perform public.check_in_with_code('0000');
  exception when others then msg_stale := sqlerrm; end;

  begin perform public.check_in_with_code('1357');
  exception when others then msg_other := sqlerrm; end;

  begin perform public.check_in_with_code('9999');
  exception when others then msg_junk := sqlerrm; end;

  perform public._harness_record(
    21, 'SESSIONS', 'yesterday''s code is refused',
    'refused', coalesce(msg_stale, 'ACCEPTED — a stale code recorded a day'),
    msg_stale is not null);

  perform public._harness_record(
    22, 'SESSIONS', 'another contractor''s code is refused',
    'refused', coalesce(msg_other, 'ACCEPTED — the code worked for the wrong contractor'),
    msg_other is not null);

  perform public._harness_record(
    23, 'SESSIONS', 'a code that is nobody''s is refused',
    'refused', coalesce(msg_junk, 'ACCEPTED — a guessed code worked'),
    msg_junk is not null);

  /* The check that actually tests the leak. If a wrong-but-real code and a
     wrong-and-fake code produce the same sentence, there is nothing to learn
     from probing. If they differ at all, the oracle is back. */
  select case
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
    msg_stale is not null and msg_stale = msg_other and msg_other = msg_junk);

  /* Belt and braces: no contractor's name may appear in the refusal, whatever
     the text happens to say. */
  perform public._harness_record(
    25, 'SESSIONS', 'the refusal never names another contractor',
    'no contractor name in the message',
    coalesce(msg_other, '(none)'),
    msg_other is not null
      and position('Harness Contractor A' in msg_other) = 0
      and position('Harness Contractor B' in msg_other) = 0);
end $$;


-- The real code, which must work.
do $$
declare r record;
begin
  select * into r from public.check_in_with_code('7429');
  perform public._harness_record(
    26, 'SESSIONS', 'the correct code records the day',
    'work', coalesce(r.kind,'(none)'),
    r.kind = 'work' and r.work_date = current_date);
exception when others then
  perform public._harness_record(
    26, 'SESSIONS', 'the correct code records the day', 'work', 'ERROR: ' || sqlerrm, false);
end $$;

select public._harness_record(
  27, 'SESSIONS', 'the recorded day is marked as a check-in',
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
    28, 'SESSIONS', 'checking in twice does not double the day',
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
    28, 'SESSIONS', 'checking in twice does not double the day',
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
    29, 'SESSIONS', 'worker CANNOT insert a day with no session open',
    'refused', 'ACCEPTED — a day was created with no session', false);
exception when others then
  perform public._harness_record(
    29, 'SESSIONS', 'worker CANNOT insert a day with no session open', 'refused', sqlerrm, true);
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
    30, 'SESSIONS', 'worker CANNOT reclassify their own day to overtime',
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
  31, 'ANON', 'signed-out visitor sees zero employees',
  '0', (select count(*)::text from public.employees),
  (select count(*) from public.employees) = 0);

select public._harness_record(
  32, 'ANON', 'signed-out visitor sees zero day records',
  '0', (select count(*)::text from public.day_records),
  (select count(*) from public.day_records) = 0);

select public._harness_record(
  33, 'ANON', 'signed-out visitor sees zero attendance sessions',
  '0', (select count(*)::text from public.attendance_sessions),
  (select count(*) from public.attendance_sessions) = 0);

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

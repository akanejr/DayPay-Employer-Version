-- ============================================================================
-- DayPay Employer Version — RLS verification harness
-- ============================================================================
-- PURPOSE
--   Prove, empirically, that an employee cannot read another employee's wages,
--   and that neither party can forge money or confirmation state.
--
--   The agent cannot run this: its sandbox has no network route to Supabase.
--   That is exactly why this file exists — it runs in YOUR browser, and you
--   paste the result back.
--
-- HOW TO RUN
--   1. Both accounts must already exist:
--        Supabase Dashboard -> Authentication -> Add user
--        (tick "Auto Confirm User" for both)
--   2. Put those two email addresses in the CONFIG block below.
--   3. Paste this ENTIRE file into the SQL Editor and run it.
--   4. It seeds test data, runs the checks, then ROLLS BACK everything.
--      Nothing is left behind. Safe to re-run any number of times.
--
-- READING THE OUTPUT
--   Every row must say PASS. Any FAIL is a real security hole — do not put
--   real salary data in this project until all rows pass.
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- CONFIG — edit these two lines only
-- ────────────────────────────────────────────────────────────────────────────
create temp table _cfg on commit drop as
select
  'employer@example.com'::text as employer_email,   -- owns the roster
  'employee@example.com'::text as employee_email;   -- a member of staff

grant select on _cfg to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- Resolve the two accounts
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  a uuid; b uuid;
begin
  select id into a from auth.users where email = (select employer_email from _cfg);
  select id into b from auth.users where email = (select employee_email from _cfg);

  if a is null then
    raise exception 'No account found for %. Create it under Authentication -> Add user (Auto Confirm on).',
      (select employer_email from _cfg);
  end if;
  if b is null then
    raise exception 'No account found for %. Create it under Authentication -> Add user (Auto Confirm on).',
      (select employee_email from _cfg);
  end if;
  if a = b then
    raise exception 'The two emails must be different accounts.';
  end if;
end $$;

create temp table _ids on commit drop as
select
  (select id from auth.users where email = (select employer_email from _cfg)) as employer_uid,
  (select id from auth.users where email = (select employee_email from _cfg)) as employee_uid;

grant select on _ids to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- Seed (runs as postgres, which owns the tables and so bypasses RLS)
--   employee 1 : linked to the employee account  (must be invisible to others)
--   employee 2 : a colleague, NOT linked         (must be invisible to them)
-- ────────────────────────────────────────────────────────────────────────────
insert into public.employers (user_id, business_name)
select employer_uid, 'Harness Ltd' from _ids;

insert into public.employees (id, employer_id, full_name, email, employee_user_id)
select
  '11111111-1111-4111-8111-111111111111',
  employer_uid,
  'Linked Employee',
  (select employee_email from _cfg),
  employee_uid
from _ids;

insert into public.employees (id, employer_id, full_name, email, employee_user_id)
select
  '22222222-2222-4222-8222-222222222222',
  employer_uid,
  'Colleague Employee',
  'colleague@example.com',
  null
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


-- ────────────────────────────────────────────────────────────────────────────
-- Results table
-- ────────────────────────────────────────────────────────────────────────────
create temp table _rls (
  n int, area text, check_name text,
  expected text, actual text, pass boolean
);
grant select, insert on _rls to authenticated;


-- ============================================================================
-- ACT AS THE EMPLOYER
-- ============================================================================
-- `set local role` is what makes these checks meaningful: RLS is evaluated
-- against the role AND the claims, so both must be switched. If your editor
-- refuses the role switch, it means the login running the query cannot SET
-- ROLE — the checks below would then be meaningless, and that is itself worth
-- reporting rather than working around.
set local role authenticated;
set local request.jwt.claims = json_build_object(
  'sub', (select employer_uid::text from _ids), 'role', 'authenticated')::text;

insert into _rls (n, area, check_name, expected, actual, pass) values
(1, 'employer', 'sees both employees on their roster',
 '2',
 (select count(*)::text from public.employees),
 (select count(*) from public.employees) = 2);

insert into _rls (n, area, check_name, expected, actual, pass) values
(2, 'employer', 'sees both employees'' day records',
 '2',
 (select count(*)::text from public.day_records),
 (select count(*) from public.day_records) = 2);

insert into _rls (n, area, check_name, expected, actual, pass) values
(3, 'employer', 'sees both rate periods',
 '2',
 (select count(*)::text from public.employee_rate_periods),
 (select count(*) from public.employee_rate_periods) = 2);

reset role;


-- ============================================================================
-- ACT AS THE EMPLOYEE — the test that matters
-- ============================================================================
set local role authenticated;
set local request.jwt.claims = json_build_object(
  'sub', (select employee_uid::text from _ids), 'role', 'authenticated')::text;

insert into _rls (n, area, check_name, expected, actual, pass) values
(4, 'EMPLOYEE ISOLATION', 'sees ONLY their own employee row (not the roster)',
 '1',
 (select count(*)::text from public.employees),
 (select count(*) from public.employees) = 1);

insert into _rls (n, area, check_name, expected, actual, pass) values
(5, 'EMPLOYEE ISOLATION', 'sees ONLY their own day records',
 '1',
 (select count(*)::text from public.day_records),
 (select count(*) from public.day_records) = 1);

insert into _rls (n, area, check_name, expected, actual, pass) values
(6, 'EMPLOYEE ISOLATION', 'sees ONLY their own rate periods',
 '1',
 (select count(*)::text from public.employee_rate_periods),
 (select count(*) from public.employee_rate_periods) = 1);

insert into _rls (n, area, check_name, expected, actual, pass) values
(7, 'EMPLOYEE ISOLATION', 'CANNOT read the colleague''s ₦99,000 rate',
 '0',
 (select count(*)::text from public.employee_rate_periods where daily_rate = 99000),
 (select count(*) from public.employee_rate_periods where daily_rate = 99000) = 0);

insert into _rls (n, area, check_name, expected, actual, pass) values
(8, 'EMPLOYEE ISOLATION', 'CANNOT read the colleague''s day record',
 '0',
 (select count(*)::text from public.day_records
   where employee_id = '22222222-2222-4222-8222-222222222222'),
 (select count(*) from public.day_records
   where employee_id = '22222222-2222-4222-8222-222222222222') = 0);

-- Forged confirmation: the employee must not be able to self-confirm a day.
do $$
declare before_ct int; after_ct int;
begin
  select count(*) into before_ct from public.day_records where status = 'confirmed';
  begin
    insert into public.day_records (employee_id, work_date, kind, status)
    values ('11111111-1111-4111-8111-111111111111', current_date - 5, 'work', 'confirmed');
    after_ct := 1;  -- insert succeeded → policy failed to block it
  exception when others then
    after_ct := 0;  -- correctly refused
  end;
  insert into _rls (n, area, check_name, expected, actual, pass)
  values (9, 'FORGERY', 'employee CANNOT insert a self-confirmed day',
          'refused', case when after_ct = 0 then 'refused' else 'ALLOWED' end,
          after_ct = 0);
end $$;

-- Forged amount: even if a client sends an amount, the trigger must ignore it.
do $$
declare paid numeric; expected numeric;
begin
  insert into public.day_records (employee_id, work_date, kind, amount, rate)
  values ('11111111-1111-4111-8111-111111111111', current_date - 6, 'weekend', 1, 1)
  returning amount into paid;
  expected := 32000;
  insert into _rls (n, area, check_name, expected, actual, pass)
  values (10, 'FORGERY', 'client-supplied amount ignored; server computed it',
          expected::text, paid::text, paid = expected);
exception when others then
  insert into _rls (n, area, check_name, expected, actual, pass)
  values (10, 'FORGERY', 'client-supplied amount ignored; server computed it',
          '32000', 'ERROR: ' || sqlerrm, false);
end $$;

reset role;


-- ============================================================================
-- ACT AS AN ANONYMOUS VISITOR (not signed in at all)
-- ============================================================================
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into _rls (n, area, check_name, expected, actual, pass) values
(11, 'ANON', 'signed-out visitor sees zero employees',
 '0', (select count(*)::text from public.employees),
 (select count(*) from public.employees) = 0);

insert into _rls (n, area, check_name, expected, actual, pass) values
(12, 'ANON', 'signed-out visitor sees zero day records',
 '0', (select count(*)::text from public.day_records),
 (select count(*) from public.day_records) = 0);

reset role;


-- ============================================================================
-- REPORT
-- ============================================================================
select
  lpad(n::text, 2) as "#",
  area,
  check_name,
  expected,
  actual,
  case when pass then 'PASS' else 'FAIL' end as result
from _rls
order by n;

select
  count(*) filter (where pass) as passed,
  count(*) filter (where not pass) as failed,
  count(*) as total,
  case
    when count(*) filter (where not pass) = 0
      then 'ALL CHECKS PASSED — isolation holds'
    else '*** FAILURES PRESENT — DO NOT USE THIS PROJECT FOR REAL DATA ***'
  end as verdict
from _rls;

rollback;

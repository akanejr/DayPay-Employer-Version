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
-- CONFIG
--
-- Leave both blank and the harness will automatically use the two most
-- recently created accounts in this project — which is almost always what you
-- want right after creating them. The report at the end states exactly which
-- addresses it used, so you can confirm it picked the right two.
--
-- Only fill these in if you want to force a specific assignment.
-- ────────────────────────────────────────────────────────────────────────────
create temp table _cfg on commit drop as
select
  ''::text as employer_email,   -- blank = auto-pick
  ''::text as employee_email;   -- blank = auto-pick

grant select on _cfg to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- Resolve the two accounts
-- ────────────────────────────────────────────────────────────────────────────
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
from picked;

grant select on _ids to authenticated;

-- Fail early and clearly rather than producing nonsense results.
do $$
declare n int; a uuid; b uuid;
begin
  select count(*) into n from auth.users;
  if n < 2 then
    raise exception
      'This project has % account(s). The harness needs TWO. Create a second one under Authentication -> Add user (tick Auto Confirm), then run this again.',
      n;
  end if;

  select employer_uid, employee_uid into a, b from _ids;
  if a is null or b is null then
    raise exception 'Could not resolve two accounts. Check the emails in the CONFIG block.';
  end if;
  if a = b then
    raise exception 'Both roles resolved to the same account. Set the two emails explicitly in the CONFIG block.';
  end if;
end $$;


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
-- anon needs insert rights too: the anonymous phase below runs with that role
-- and must still be able to record its own result row.
grant select, insert on _rls to authenticated, anon;


-- ============================================================================
-- ACT AS THE EMPLOYER
-- ============================================================================
-- NOTE ON SYNTAX: `SET LOCAL x = <expr>` is invalid in PostgreSQL — SET only
-- accepts a literal. Dynamic values therefore go through set_config(), which
-- does accept an expression. Getting this wrong gives
-- "42601: syntax error at or near (".
set local role authenticated;
do $$
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employer_uid::text, 'role', 'authenticated')::text from _ids),
    true
  );
end $$;

-- Guard against a silent false pass: if the role switch did not take effect,
-- every check below would run as the table owner and pass for the wrong
-- reason. This row makes that failure loud.
insert into _rls values
(0, 'PREFLIGHT', 'role switch actually applied (not silently running as owner)',
 'authenticated', current_user, current_user = 'authenticated');

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
do $$
begin
  perform set_config(
    'request.jwt.claims',
    (select json_build_object('sub', employee_uid::text, 'role', 'authenticated')::text from _ids),
    true
  );
end $$;

insert into _rls values
(13, 'PREFLIGHT', 'employee role switch applied', 'authenticated', current_user,
 current_user = 'authenticated');

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

-- Which accounts were tested (check these are the two you created)
select
  employer_email_used as "employer account",
  employee_email_used as "employee account",
  total_accounts      as "accounts in project"
from _ids;

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

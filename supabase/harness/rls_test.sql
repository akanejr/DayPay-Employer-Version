-- ============================================================================
-- DayPay Employer Version — RLS verification harness (v3)
-- ============================================================================
-- Proves an employee cannot read another employee's wages.
-- Seeds test data, runs the checks, then ROLLS BACK. Safe to re-run.
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
grant select on
  public.employers, public.employees, public.employee_rate_periods,
  public.day_records, public.day_record_events
  to anon;
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
  4, 'PREFLIGHT', 'employee role switch applied',
  'authenticated', current_user, current_user = 'authenticated');

select public._harness_record(
  5, 'EMPLOYEE ISOLATION', 'sees ONLY their own employee row (not the roster)',
  '1', (select count(*)::text from public.employees),
  (select count(*) from public.employees) = 1);

select public._harness_record(
  6, 'EMPLOYEE ISOLATION', 'sees ONLY their own day records',
  '1', (select count(*)::text from public.day_records),
  (select count(*) from public.day_records) = 1);

select public._harness_record(
  7, 'EMPLOYEE ISOLATION', 'sees ONLY their own rate periods',
  '1', (select count(*)::text from public.employee_rate_periods),
  (select count(*) from public.employee_rate_periods) = 1);

-- The bait: a colleague on ₦99,000/day must be invisible.
select public._harness_record(
  8, 'EMPLOYEE ISOLATION', 'CANNOT read the colleague''s 99000 rate',
  '0', (select count(*)::text from public.employee_rate_periods
          where daily_rate = 99000),
  (select count(*) from public.employee_rate_periods
     where daily_rate = 99000) = 0);

select public._harness_record(
  9, 'EMPLOYEE ISOLATION', 'CANNOT read the colleague''s day record',
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
    10, 'FORGERY', 'employee CANNOT insert a self-confirmed day (expect 42501)',
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
    11, 'FORGERY', 'client-sent amount ignored; server computed 32000',
    '32000', paid::text, paid = 32000);
exception when others then
  perform public._harness_record(
    11, 'FORGERY', 'client-sent amount ignored; server computed 32000',
    '32000', 'ERROR: ' || sqlerrm, false);
end $$;

reset role;


-- ============================================================================
-- PHASE 3 — SIGNED-OUT VISITOR
-- ============================================================================
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select public._harness_record(
  12, 'ANON', 'signed-out visitor sees zero employees',
  '0', (select count(*)::text from public.employees),
  (select count(*) from public.employees) = 0);

select public._harness_record(
  13, 'ANON', 'signed-out visitor sees zero day records',
  '0', (select count(*)::text from public.day_records),
  (select count(*) from public.day_records) = 0);

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

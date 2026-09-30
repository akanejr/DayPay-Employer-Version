-- DayPay — WHAT IS ACTUALLY INSTALLED, in one paste.
--
-- Run this in the Supabase SQL Editor, on the project you applied the
-- migrations to. It reads the database and reports; it changes nothing, needs
-- no fixture, no signed-in user and no second account, and is safe to run at
-- any time — before a batch, after a batch, or a month later when you are
-- wondering whether a project was ever brought up to date.
--
-- Every row should read PASS. A FAIL names exactly what is missing and what
-- the consequence is, so the answer is not "something is wrong" but "016 has
-- not been run" or "017 was replaced by an older build".
--
-- IT MUST SURVIVE A HALF-INSTALLED PROJECT. That is the state it is most
-- often run in, and it used to fail at it: a capability check written
-- has_function_privilege('authenticated', 'public.some_function(uuid, text)')
-- RAISES when the function is absent, so one missing migration turned the
-- whole report into a Postgres error instead of a row saying which migration
-- was missing. Every capability check below is therefore OID-based — it asks
-- the catalog about functions that exist, and an absence is reported as a
-- missing function rather than thrown. `migrations.mjs` runs this file
-- against a project stopped at 017 for exactly that reason.
--
-- There are deliberately NO "how many ..." rows any more. A count reads a
-- table or a column that a later migration adds -- `select count(*) from
-- employees where pin_hash is not null` cannot even be PARSED on a project
-- without 018 -- so a fact row written that way takes the whole report down
-- with it, on exactly the project that needs it most. Every row below is now
-- a structural question answerable from the catalogs alone, which is what
-- makes this file safe to paste into a project in any state.
--
-- The counts themselves live where they belong: the app. Roster shows which
-- workers hold a PIN, and Site attendance kiosk lists the linked machines.
--
-- This exists because the previous way to answer "is it installed?" was to
-- read a function body by hand, and the honest answer to that is: nobody does
-- that twice.

with fn as (
  select pg_get_functiondef(p.oid)   as def,
         pg_get_function_result(p.oid) as res
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_in_with_code'
),
st as (
  select pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_attendance_status'
),
cr as (
  select
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'correction_requests') as policies,
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'correction_requests'
        and cmd = 'DELETE')                                               as delete_policies,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'resolve_correction'
        and p.prosecdef)                                                  as resolver
),
pin as (
  select
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'employees'
        and column_name in ('pin_hash','pin_salt','pin_set_at','pin_fails','pin_locked_until')) as cols,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('set_attendance_pin','employee_pin_status','verify_attendance_pin')) as fns,
    /* OID-based on purpose: the name-and-signature form raises when the
       function is missing, which would abort this report on exactly the
       project it was written to diagnose. */
    (select coalesce(bool_or(has_function_privilege('authenticated', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'verify_attendance_pin') as oracle_open
),
kiosk as (
  select
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'day_records'
        and column_name = 'attendance_method') as method_col,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('claim_attendance_device', 'kiosk_roster',
                          'kiosk_check_in')) as fns,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'kiosk_check_in') as checkin_fns,
    (select coalesce(relrowsecurity, false) from pg_class
      where relname = 'attendance_devices'
        and relnamespace = 'public'::regnamespace) as rls,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('claim_attendance_device', 'kiosk_roster',
                          'kiosk_check_in')) as anon_open,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'kiosk_check_in'
        and position('raise exception' in pg_get_functiondef(p.oid)) = 0) as no_raise
)
select '017 · a refusal has somewhere to go' as check_name,
       case when (select position('ok boolean' in res) > 0
                    and position('message text' in res) > 0 from fn)
            then 'PASS' else 'FAIL — run 017: a refusal would arrive as an error' end as verdict
union all
select '017 · no refusal raises any more (so attempts survive)',
       case when (select position('raise exception' in def) = 0 from fn)
            then 'PASS' else 'FAIL — run 017: every wrong code erases its own record' end
union all
select '017 · the attempt is written BEFORE the refusal',
       case when (select position('insert into public.check_in_attempts' in def) > 0
                      and position('insert into public.check_in_attempts' in def)
                        < position('Code not correct, visit the site.' in def) from fn)
            then 'PASS' else 'FAIL — run 017: the cap cannot count what is never written' end
union all
select '017 · the five-attempt cap is installed',
       case when (select position('Too many wrong codes. Try again in a few minutes.' in def) > 0 from fn)
            then 'PASS' else 'FAIL — run 017: nothing limits how many codes can be tried' end
union all
select '017 · the wrong-code sentence names nobody',
       case when (select position('Code not correct, visit the site.' in def) > 0
                      and position('Check with your contractor' in def) = 0 from fn)
            then 'PASS' else 'FAIL — an older refusal wording is installed' end
union all
select '016 · which session the worker is told about is deterministic',
       case when (select position('order by (s.contractor_id is null)' in def) > 0 from st)
            then 'PASS' else 'FAIL — run 016: the worker can be told the wrong session' end
union all
select '016 · it still never returns a code',
       case when (select position('s.code' in def) = 0 from st)
            then 'PASS' else 'FAIL — my_attendance_status mentions a code' end
union all
select '012 · correction_requests exists with its four policies',
       case when (select policies from cr) >= 4
            then 'PASS' else 'FAIL — run 012: workers cannot raise corrections' end
union all
select '012 · requests are history, so nobody may delete them',
       case when (select delete_policies from cr) = 0
            then 'PASS' else 'FAIL — a DELETE policy exists on correction_requests' end
union all
select '012 · resolve_correction is installed and SECURITY DEFINER',
       case when (select resolver from cr) = 1
            then 'PASS' else 'FAIL — run 012: an approved correction cannot be applied' end
union all
select '018 · the personal attendance PIN is installed',
       case when (select cols from pin) = 5 and (select fns from pin) = 3
            then 'PASS' else 'FAIL — run 018: nobody can be checked in at a kiosk' end
union all
select '018 · the PIN hash cannot be guessed through the API',
       case when (select fns from pin) < 3
              then 'FAIL — run 018: the PIN functions are not installed'
            when (select oracle_open from pin) = false then 'PASS'
            else 'FAIL — verify_attendance_pin is callable by any signed-in worker' end
union all
select '019 · the site kiosk is installed (device table, three functions)',
       case when to_regclass('public.attendance_devices') is null
              or (select fns from kiosk) < 3
            then 'FAIL — run 019: nobody can be recorded at a site kiosk'
            else 'PASS' end
union all
select '019 · a kiosk day is marked as a kiosk day, for audit only',
       case when (select method_col from kiosk) = 1
            then 'PASS'
            else 'FAIL — run 019: the audit view cannot tell the two routes apart' end
union all
select '019 · kiosk refusals are returned, so a wrong PIN is still counted',
       case when (select checkin_fns from kiosk) = 0
              then 'FAIL — run 019: kiosk_check_in is missing'
            when (select no_raise from kiosk) = 1 then 'PASS'
            else 'FAIL — kiosk_check_in raises: a refusal would erase its own record' end
union all
select '019 · nobody anonymous can drive a kiosk',
       case when (select fns from kiosk) < 3
              then 'FAIL — run 019: the kiosk functions are not installed'
            when (select anon_open from kiosk) = false then 'PASS'
            else 'FAIL — an anonymous visitor can call a kiosk function' end
union all
select '019 · the machines table is protected by row level security',
       case when to_regclass('public.attendance_devices') is null
              then 'FAIL — run 019: there is no devices table to protect'
            when (select rls from kiosk) then 'PASS'
            else 'FAIL — attendance_devices has RLS disabled' end

order by check_name;

-- How to read a FAIL: it names the migration to run. Nothing here changes the
-- database, needs a fixture, a signed-in user or a second account, so it is
-- safe before a batch, after a batch, or a year later on a project nobody
-- remembers the history of.

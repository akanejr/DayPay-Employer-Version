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
attempts as (
  select count(*) as n from public.check_in_attempts
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
select '017 · how many wrong codes are on record (a fact, not a check)',
       'INFO — ' || (select n::text from attempts)
       || ' attempt(s) recorded. This number was stuck at 0 before 017.'
order by check_name;

-- The last row is a fact, not a check: check_in_attempts was empty forever
-- before 017, because the insert was rolled back by the refusal it happened
-- next to. After 017 it only goes up. If it is 0 and you have not tried a
-- wrong code yet, that is correct too.

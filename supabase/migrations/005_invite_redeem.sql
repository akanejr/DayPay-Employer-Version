-- ============================================================================
-- DayPay Employer Version — migration 005: invite redemption
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- WHY THIS NEEDS A SERVER-SIDE FUNCTION
--   An employee holds only a SELECT policy on `employees`. The employer's
--   policy is `employer_id = auth.uid()`; the employee's own is
--   `employee_user_id = auth.uid()`. Neither allows a write, and that is
--   deliberate — a policy letting an employee UPDATE their own row would let
--   them change their own name, rate link, or status.
--
--   So linking an account to a roster entry cannot happen from the client. It
--   happens here, in a SECURITY DEFINER function, which is the narrowest
--   available hole: it takes a code, and it can set one column on one row.
--
-- SECURITY PROPERTIES
--   * Returns ONLY the single entry it linked — never the roster, never a list.
--     An employee still cannot see their colleagues.
--   * Refuses to re-link an entry already claimed by a different account.
--   * The code is single-use: cleared in the same statement that links it, so
--     a forwarded screenshot or a lost phone cannot link a second account.
--   * The employer's business name is read through the function, because the
--     employee has no policy on `employers` at all.
--   * Not callable by a signed-out visitor.
--
-- ON CODE STRENGTH
--   Codes are 8 characters from a 31-character alphabet (~8.5e11
--   combinations), generated client-side with crypto.getRandomValues, and
--   single-use. There is no rate limiting; brute-forcing that space against an
--   authenticated endpoint is not realistic. If this is ever exposed more
--   widely, add a per-user attempt counter.
--
-- NOTE ON REGENERATING
--   No SQL code generator is provided on purpose. The client already
--   generates codes with a CSPRNG, and the employer can write to their own
--   `employees` rows through the existing RLS policy, so re-issuing a code is
--   an ordinary client update. Keeping code generation in one place avoids two
--   implementations drifting apart.
-- ============================================================================

begin;

/* Redeem an invite code. Returns one row describing the roster entry that was
   linked, or raises with a message the UI can show directly. */
create or replace function public.redeem_invite(code text)
returns table (
  employee_id   uuid,
  full_name     text,
  job_title     text,
  business_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  emp public.employees%rowtype;
  biz text;
begin
  if uid is null then
    raise exception 'You need to be signed in to join a team.'
      using errcode = 'insufficient_privilege';
  end if;

  if code is null or length(trim(code)) = 0 then
    raise exception 'Enter the code from your employer.'
      using errcode = 'invalid_parameter_value';
  end if;

  /* Case-insensitive and tolerant of spaces: codes get typed from paper,
     pasted out of WhatsApp, and read aloud over the phone. */
  select e.* into emp
  from public.employees e
  where e.invite_code is not null
    and upper(replace(trim(e.invite_code), ' ', '')) =
        upper(replace(trim(code), ' ', ''))
  limit 1;

  if not found then
    raise exception 'That code was not recognised. Check it with your employer.'
      using errcode = 'no_data_found';
  end if;

  if emp.status <> 'active' then
    raise exception 'That roster entry is archived. Ask your employer to restore it.'
      using errcode = 'check_violation';
  end if;

  -- Idempotent: a double-tap, or redeeming again on a second device, succeeds
  -- rather than erroring at the user.
  if emp.employee_user_id = uid then
    select e2.business_name into biz
    from public.employers e2 where e2.user_id = emp.employer_id;
    return query select emp.id, emp.full_name, emp.job_title, biz;
    return;
  end if;

  if emp.employee_user_id is not null then
    raise exception 'That code has already been used by another account.'
      using errcode = 'unique_violation';
  end if;

  /* Link and burn the code in one statement. */
  update public.employees
     set employee_user_id = uid,
         invite_code = null
   where id = emp.id;

  select e3.business_name into biz
  from public.employers e3 where e3.user_id = emp.employer_id;

  return query select emp.id, emp.full_name, emp.job_title, biz;
end $$;

revoke all on function public.redeem_invite(text) from public;
revoke all on function public.redeem_invite(text) from anon;
grant execute on function public.redeem_invite(text) to authenticated;


/* Detach the signed-in account from its roster entry.
   Without this, someone who redeemed the wrong code — or who has left the job —
   would be stuck seeing a business's records forever. Deliberately narrow: it
   can only unlink the CALLER, from an entry that is already theirs.

   The invite code is cleared too. The employer re-issues one from the roster
   screen when they want to invite the person back. */
create or replace function public.leave_roster()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'You need to be signed in.' using errcode = 'insufficient_privilege';
  end if;

  update public.employees
     set employee_user_id = null,
         invite_code = null
   where employee_user_id = uid;
end $$;

revoke all on function public.leave_roster() from public;
revoke all on function public.leave_roster() from anon;
grant execute on function public.leave_roster() to authenticated;

commit;

-- ============================================================================
-- Verify:
--
--   select proname, prosecdef from pg_proc
--   where proname in ('redeem_invite', 'leave_roster');
--
-- Expect two rows, both prosecdef = true (SECURITY DEFINER).
-- ============================================================================

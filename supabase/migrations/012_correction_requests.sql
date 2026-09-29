-- DayPay — Phase 6: corrections, overtime assignment, worker detail, audit.
--
-- WHAT THIS ADDS
--
-- One new table and one new function. Nothing existing is altered, replaced or
-- dropped, and no data is moved.
--
--   correction_requests   a worker says "this day is wrong"; the employer
--                         answers it. A REQUEST, not an edit — which is the
--                         whole point. Phase 5 made a worker's month
--                         read-only, and the brief still requires that they be
--                         able to raise a correction. Asking is how both of
--                         those are true at once.
--
--   resolve_correction()  the employer's answer, and — when approved — the
--                         change itself, in the same transaction.
--
-- WHY THE TABLE RATHER THAN A NOTE ON THE DAY
--
-- A disputed day and a request about it are different things with different
-- lifetimes. A request has an author, a decision, a decider and a decision
-- time; it outlives the day (day_record_id is ON DELETE SET NULL) and stays as
-- history after the day it is about has been fixed or removed. Phase 0 settled
-- that correction requests are first-class rows; this is that row.
--
-- THE THREE THINGS A WORKER MAY ASK
--
--   remove      "I did not work that day."
--   reclassify  "That was overtime, not a normal day."
--   missing     "I worked that day and it has not been recorded."
--
-- Exactly three, because they are exactly the three moves the employer already
-- has: delete a day, change its kind, add a day. Approval is therefore not a
-- new way to write the ledger — it is the existing write, performed by the
-- employer's own hand, with the request as the reason.
--
-- WHAT APPROVAL DOES TO A CONFIRMED DAY
--
-- A confirmed day's money is frozen by the guard trigger, and reclassifying
-- changes the money through the system's own arithmetic. So for a confirmed
-- day the function does the deliberate sequence — reopen, change, confirm
-- again — and leaves the day confirmed, which is what the employer meant by
-- approving. The audit trail records all three steps rather than one, which is
-- the honest account of what happened.
--
-- GONE IS THE FREE-FOR-ALL: every branch requires is_employer_of() to be true
-- for the request's own worker. The worker may open a request, withdraw their
-- own still-open one, and read their own. Nothing else.
--
-- SAFE TO APPLY: creates one table and one function, adds policies and grants.
-- Re-running it is harmless — every statement is guarded.
--
-- NOTE ON NUMBERING: the refusal-as-value change offered earlier under the
-- name "012" has no SQL written yet and becomes 013. Work that exists is
-- numbered in the order it exists.

begin;

-- ── Preflight ───────────────────────────────────────────────────────────────
-- The table references auth.users and public.employees, and the function calls
-- is_employer_of(). Check for those where a failure is visible and harmless,
-- rather than at the moment an employer answers a request.

do $$
begin
  if to_regclass('public.employees') is null then
    raise exception
      'public.employees does not exist. Run supabase/migrations/001_employer_schema.sql first.';
  end if;

  if to_regclass('public.day_records') is null then
    raise exception
      'public.day_records does not exist. Run supabase/migrations/001_employer_schema.sql first.';
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'is_employer_of'
  ) then
    raise exception 'public.is_employer_of() is missing. Run 001_employer_schema.sql first.';
  end if;
end $$;

-- ── The table ───────────────────────────────────────────────────────────────

create table if not exists public.correction_requests (
  id            uuid primary key default gen_random_uuid(),

  -- Who is asking and which day they are asking about. This pair, not
  -- day_record_id, is the real identity of the request: a 'missing' request
  -- has no row to point at, and a request must survive the day being deleted.
  employee_id   uuid not null references public.employees(id) on delete cascade,
  work_date     date not null,

  -- Convenience link to the day as it stood when the request was made. Null
  -- for 'missing', and nulled by the database if that day is ever removed —
  -- the audit trail outlives the record it describes.
  day_record_id uuid references public.day_records(id) on delete set null,

  request_kind  text not null
                  check (request_kind in ('remove', 'reclassify', 'missing')),

  -- What they say the day should be. Only meaningful for 'reclassify'.
  want_kind     text check (want_kind in ('work', 'weekend', 'overtime', 'holiday', 'leave')),
  leave_type    text,
  leave_percent numeric(5,2) not null default 0
                  check (leave_percent >= 0 and leave_percent <= 100),

  message       text,

  -- open -> approved | rejected, or open -> withdrawn by the worker.
  status        text not null default 'open'
                  check (status in ('open', 'approved', 'rejected', 'withdrawn')),
  resolved_by   uuid references auth.users(id),
  resolved_at   timestamptz,
  decision_note text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A reclassify must say what it should become; the other two must not
  -- pretend to. Same shape of rule as the day table's leave_type_consistency.
  constraint correction_want_kind_consistency check (
    (request_kind = 'reclassify' and want_kind is not null)
    or (request_kind <> 'reclassify' and want_kind is null)
  ),

  -- A leave reclassification must name its type, mirroring day_records.
  constraint correction_leave_type_consistency check (
    (want_kind = 'leave' and leave_type is not null)
    or (want_kind is distinct from 'leave' and leave_type is null)
  )
);

/* ONE OPEN REQUEST PER WORKER PER DAY. Enforced by the database, not by a
   button that is disabled in the UI: a worker tapping twice on a flaky
   connection must not produce two requests for the employer to answer twice.
   Resolved requests are deliberately NOT covered, so the history of what was
   asked and answered stays complete. */
create unique index if not exists correction_requests_one_open_idx
  on public.correction_requests (employee_id, work_date)
  where status = 'open';

create index if not exists correction_requests_worker_idx
  on public.correction_requests (employee_id, work_date desc);

/* What the employer's screen asks for: everything still waiting on them.
   Partial, because the open set is the only set anybody queries by status. */
create index if not exists correction_requests_open_idx
  on public.correction_requests (created_at)
  where status = 'open';

comment on table public.correction_requests is
  'A worker asking their employer to correct a day. A request is not an edit: approval applies the change through resolve_correction(), and the request itself remains as history.';

comment on column public.correction_requests.status is
  'open (waiting), approved or rejected (employer answered), withdrawn (the worker changed their mind before an answer).';

-- ── Keep updated_at honest ──────────────────────────────────────────────────

create or replace function public.correction_requests_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists correction_requests_updated_at on public.correction_requests;
create trigger correction_requests_updated_at
  before update on public.correction_requests
  for each row execute function public.correction_requests_touch();

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.correction_requests enable row level security;

-- The worker: may open a request about their own day, read their own, and
-- withdraw their own while it is still unanswered.
drop policy if exists corrections_self_insert on public.correction_requests;
create policy corrections_self_insert on public.correction_requests
  for insert to authenticated
  with check (public.is_self(employee_id) and status = 'open');

drop policy if exists corrections_self_select on public.correction_requests;
create policy corrections_self_select on public.correction_requests
  for select to authenticated
  using (public.is_self(employee_id));

/* The WITH CHECK is the load-bearing half. Without it a worker could UPDATE
   their own open request straight to status = 'approved' and have the
   employer's answer forged in the database — the request table would become a
   second way to write the ledger, which is exactly what this design exists to
   prevent. They may set 'withdrawn' and nothing else. */
drop policy if exists corrections_self_update on public.correction_requests;
create policy corrections_self_update on public.correction_requests
  for update to authenticated
  using (public.is_self(employee_id) and status = 'open')
  with check (public.is_self(employee_id) and status in ('open', 'withdrawn'));

-- The employer: reads every request about their own workers, and answers it.
-- resolve_correction() is SECURITY DEFINER and does its own ownership check,
-- so this policy governs direct table access rather than the normal path.
drop policy if exists corrections_employer_all on public.correction_requests;
create policy corrections_employer_all on public.correction_requests
  for all to authenticated
  using (public.is_employer_of(employee_id))
  with check (public.is_employer_of(employee_id));

/* No DELETE policy for anyone, on purpose. A request that was withdrawn,
   rejected or approved is a record of a conversation, and the brief asks for
   an audit trail rather than a tidy table. */

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Since 2026-04-28 a table created in `public` is not reachable through the
-- API until it is granted explicitly, so this is not optional ceremony: with
-- it missing, every request fails with a permission error that looks nothing
-- like a missing grant.

grant select, insert, update on public.correction_requests to authenticated;

-- ── The employer's answer ───────────────────────────────────────────────────

/* Approves or rejects one request. On approval, applies the change the worker
   asked for in the same transaction, so "approved" and "the record changed"
   cannot come apart.

   SECURITY DEFINER because it must both read the request and write the day
   regardless of the caller's own policies — which makes the ownership check at
   the top the entire security boundary. It is checked first, before anything
   is read into a variable that a caller could act on. */
create or replace function public.resolve_correction(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null
) returns public.correction_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid             uuid := auth.uid();
  v_req           public.correction_requests%rowtype;
  v_day           public.day_records%rowtype;
  v_had_day       boolean;
  v_was_confirmed boolean := false;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_req
    from public.correction_requests
   where id = p_id
     for update;                        -- two devices answering at once

  if not found then
    raise exception 'That request no longer exists.' using errcode = 'no_data_found';
  end if;

  if not public.is_employer_of(v_req.employee_id) then
    raise exception 'That request is not yours to answer.' using errcode = 'insufficient_privilege';
  end if;

  if v_req.status <> 'open' then
    raise exception 'That request has already been answered.'
      using errcode = 'check_violation';
  end if;

  if p_approve then
    select * into v_day
      from public.day_records
     where employee_id = v_req.employee_id
       and work_date   = v_req.work_date;

    v_had_day := found;
    if v_had_day then
      v_was_confirmed := v_day.status = 'confirmed';
    end if;

    if v_req.request_kind = 'remove' then
      /* Removing a day is not blocked by the frozen-money rule — that rule
         guards UPDATE, and the employer's own Delete already works this way.
         The audit events survive the row: day_record_events.day_record_id is
         ON DELETE SET NULL, so the trail keeps the story and loses only the
         pointer. */
      if v_had_day then
        delete from public.day_records where id = v_day.id;
      end if;

    elsif v_req.request_kind = 'reclassify' then
      /* Reopen first when the day is confirmed: the guard trigger refuses a
         money change on a confirmed day, and changing the kind IS a money
         change. Reopening and re-confirming keeps the employer's earlier
         decision intact and records all three steps. */
      if v_was_confirmed then
        update public.day_records set status = 'claimed' where id = v_day.id;
      end if;

      if v_had_day then
        update public.day_records
           set kind          = v_req.want_kind,
               leave_type    = v_req.leave_type,
               leave_percent = v_req.leave_percent,
               source        = 'correction'
         where id = v_day.id;
      else
        -- Nothing recorded, but they asked for a kind. Record it.
        insert into public.day_records
          (employee_id, work_date, kind, leave_type, leave_percent, status, source)
        values
          (v_req.employee_id, v_req.work_date, v_req.want_kind, v_req.leave_type,
           v_req.leave_percent, 'claimed', 'correction')
        on conflict on constraint day_records_employee_id_work_date_key do nothing;
      end if;

      if v_was_confirmed then
        update public.day_records set status = 'confirmed'
         where employee_id = v_req.employee_id and work_date = v_req.work_date;
      end if;

    else  -- 'missing'
      /* Only acts when there is nothing there. If a day already exists, the
         worker was mistaken or it arrived by another route; approving is then
         simply the acknowledgement, and silently rewriting an existing day
         because somebody said it was absent would lose information. */
      if not v_had_day then
        insert into public.day_records
          (employee_id, work_date, kind, status, source)
        values
          (v_req.employee_id, v_req.work_date, 'work', 'claimed', 'correction')
        on conflict on constraint day_records_employee_id_work_date_key do nothing;
      end if;
    end if;
  end if;

  update public.correction_requests
     set status        = case when p_approve then 'approved' else 'rejected' end,
         resolved_by   = uid,
         resolved_at   = now(),
         decision_note = p_note
   where id = p_id
  returning * into v_req;

  return v_req;
end $$;

revoke all on function public.resolve_correction(uuid, boolean, text) from public;
revoke all on function public.resolve_correction(uuid, boolean, text) from anon;
grant execute on function public.resolve_correction(uuid, boolean, text) to authenticated;

-- ── Proof ───────────────────────────────────────────────────────────────────
-- Structure only, and deliberately so: the behavioural proof needs two real
-- signed-in accounts and lives in supabase/harness/rls_test.sql, which runs in
-- a transaction that rolls back. What can be proved here is that the objects
-- exist with the properties the design depends on — the invariants, not the
-- text of the file that created them. (Migration 010 is the cautionary tale:
-- it asserted a literal string, the string was legitimately different, and the
-- migration could never install.)

do $$
declare
  v_pred text;
  v_secdef boolean;
begin
  -- The uniqueness rule must be PARTIAL, i.e. restricted to open requests.
  -- A plain unique index here would silently forbid a second request about a
  -- day that has already been answered once.
  select pg_get_indexdef(i.indexrelid) into v_pred
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'correction_requests_one_open_idx';

  if v_pred is null then
    raise exception 'The one-open-request rule is missing. Do not stop here - tell me.';
  end if;

  if position('where' in lower(v_pred)) = 0 then
    raise exception
      'correction_requests_one_open_idx is not partial, so a worker could never raise a second request about the same day. Do not stop here - tell me.';
  end if;

  -- A worker must not be able to answer their own request.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'correction_requests'
       and policyname = 'corrections_self_update'
       and cmd in ('UPDATE', 'ALL')
  ) then
    raise exception 'The worker''s withdraw-only update policy is missing. Do not stop here - tell me.';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'correction_requests'
       and cmd = 'DELETE'
  ) then
    raise exception
      'A DELETE policy exists on correction_requests. Requests are history and must not be deletable. Do not stop here - tell me.';
  end if;

  -- The function must be SECURITY DEFINER. As the caller it could not write
  -- the day at all, and approval would fail for the employer.
  select p.prosecdef into v_secdef
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'resolve_correction';

  if v_secdef is not true then
    raise exception 'resolve_correction() is not SECURITY DEFINER, so it cannot apply the change. Do not stop here - tell me.';
  end if;

  raise notice 'correction_requests is in place: a worker may ask, only the employer may answer, and an unprotected second write path to the ledger does not exist.';
end $$;

commit;

-- Verify afterwards:
--   select indexdef from pg_indexes
--    where schemaname = 'public' and tablename = 'correction_requests';
--     -> correction_requests_one_open_idx ... WHERE (status = 'open'::text)
--
--   select policyname, cmd, qual is not null as has_using from pg_policies
--    where tablename = 'correction_requests' order by policyname;
--     -> corrections_employer_all | ALL | true
--        corrections_self_insert  | INSERT | false   (WITH CHECK only)
--        corrections_self_select  | SELECT | true
--        corrections_self_update  | UPDATE | true
--        and NO delete policy
--
-- Then let the harness (checks 42-46) prove the behaviour.

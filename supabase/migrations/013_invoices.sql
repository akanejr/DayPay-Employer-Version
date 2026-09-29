-- DayPay — Phase 7: contractor period summary and invoices.
--
-- WHAT THIS ADDS
--
-- Two tables and two functions. Nothing existing is altered, replaced or
-- dropped, and no data is moved.
--
--   invoices        one billing document: who it is for, which period, what it
--                   came to, and whether it still stands.
--   invoice_lines   one row per worker inside that document.
--   issue_invoice() the employer's "bill this period" action.
--   void_invoice()  the undo. A wrong invoice is VOIDED, never deleted.
--
-- THE ONE RULE THIS FILE EXISTS TO KEEP
--
-- The brief forbids a second calculation engine, and an invoice is exactly
-- where one usually appears: a billing screen that "works out" what a
-- contractor is owed from rates and multipliers will eventually disagree with
-- the ledger, and the day it does, nobody can tell which figure is right.
--
-- So this file does NOT compute money. It does not know what a rate is, what a
-- weekend is, or what the multipliers are. Every figure it writes is either
--   * a COUNT of recorded days, or
--   * a SUM of `amount` or `multiplier` already stored on those days
-- by the same trigger that valued the day in the first place (001/008). The
-- invoice is an aggregate of frozen facts, which is why it cannot drift from
-- the Summary screen: both are reading the same numbers, and neither is
-- multiplying anything.
--
-- WHY A FROZEN DOCUMENT RATHER THAN A LIVE VIEW
--
-- A period summary is a view — it changes as days change. An invoice is not:
-- once it has been sent to a contractor, it has to keep saying what it said.
-- So issuing writes the numbers down. If a day is corrected afterwards, the
-- invoice does not secretly change underneath the contractor who was sent it;
-- the next invoice picks the change up, and everyone can see both.
--
-- WHAT AN INVOICE INCLUDES, AND WHY THERE IS ONLY ONE TOTAL
--
-- Every day recorded in the period counts, including days still awaiting
-- confirmation and days under dispute — the same rule the Summary screen uses,
-- where a disputed day "is still included in the month total until it is
-- settled". The invoice therefore shows those counts per worker and in total,
-- and there is deliberately NO second "confirmed only" total anywhere: two
-- totals for one period is how a billing dispute starts. If the employer wants
-- to hold a disputed day back, they settle it first and bill afterwards.
--
-- Workers are billed to the contractor they are assigned to NOW, so a worker
-- moved between contractors mid-period follows their current one for the whole
-- period. Correcting that properly means snapshotting the assignment on the
-- day, which is a change to the ledger's shape and belongs in its own phase,
-- not smuggled into a billing migration.
--
-- SAFE TO APPLY: creates two tables and two functions, adds policies and
-- grants. Re-running it is harmless — every statement is guarded.
--
-- NUMBERING: the refusal-as-value change offered earlier is now 014, because
-- 013 is this file. Numbers follow work that exists.

begin;

-- ── Preflight ───────────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.employees') is null
     or to_regclass('public.day_records') is null then
    raise exception
      'public.employees / public.day_records are missing. Run supabase/migrations/001_employer_schema.sql first.';
  end if;

  if to_regclass('public.contractors') is null then
    raise exception
      'public.contractors is missing. Run supabase/migrations/007_contractors.sql first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'employees'
       and column_name = 'contractor_id'
  ) then
    raise exception
      'public.employees.contractor_id is missing. Run supabase/migrations/007_contractors.sql first.';
  end if;
end $$;

-- ── The document ────────────────────────────────────────────────────────────

create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  employer_id    uuid not null references auth.users(id) on delete cascade,

  -- Null means the unassigned workers — a real thing to bill for, and the
  -- reason this cannot be NOT NULL.
  contractor_id  uuid references public.contractors(id) on delete set null,

  /* The contractor's name AS IT WAS. Not a join. If the contractor is renamed
     or archived next month, this document must still say what it said when it
     was sent. Same for the worker names on the lines. */
  contractor_name text not null,

  number         text not null,
  period_from    date not null,
  period_to      date not null,

  -- A wrong invoice is voided, never deleted: the fact that a wrong one was
  -- issued is itself part of the record.
  status         text not null default 'issued'
                   check (status in ('issued', 'void')),
  note           text,
  void_reason    text,

  issued_by      uuid references auth.users(id),
  issued_at      timestamptz not null default now(),
  voided_at      timestamptz,

  -- The frozen totals. Every one of these is derived from invoice_lines by
  -- issue_invoice(), which is itself only counting and summing stored values.
  worker_count   int not null default 0,
  actual_days    int not null default 0,
  leave_days     int not null default 0,
  equivalents    numeric(12,2) not null default 0,
  total          numeric(14,2) not null default 0,
  confirmed_days int not null default 0,
  claimed_days   int not null default 0,
  disputed_days  int not null default 0,

  constraint invoices_period_order check (period_to >= period_from),
  constraint invoices_void_consistency check (
    (status = 'void' and voided_at is not null)
    or (status = 'issued' and voided_at is null)
  ),

  -- Numbers are per employer and never reused.
  unique (employer_id, number)
);

create index if not exists invoices_employer_idx
  on public.invoices (employer_id, issued_at desc);

/* DOUBLE-BILLING GUARD. One live invoice per contractor per period, and the
   database enforces it rather than a disabled button — a second device, or a
   double tap, must not produce two invoices for the same work.

   `coalesce(contractor_id, ...)` is load-bearing: in a plain unique index two
   NULLs are never equal, so unassigned workers could be billed twice without
   this ever firing. Voided invoices are excluded, so voiding and reissuing is
   the supported way to correct a mistake. */
create unique index if not exists invoices_one_live_period_idx
  on public.invoices (
    employer_id,
    coalesce(contractor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_from,
    period_to
  )
  where status = 'issued';

comment on table public.invoices is
  'A billing document, frozen when issued: the figures are written down, not recomputed. Voiding is the undo; nothing is deleted.';

-- ── The lines ───────────────────────────────────────────────────────────────

create table if not exists public.invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id) on delete cascade,

  -- Kept for linking back to the worker; the NAME is frozen beside it, because
  -- the document must not change when somebody is renamed or leaves.
  employee_id   uuid references public.employees(id) on delete set null,
  employee_name text not null,
  job_title     text,

  days          int not null default 0,
  worked        int not null default 0,
  leave_days    int not null default 0,
  equivalents   numeric(12,2) not null default 0,
  amount        numeric(14,2) not null default 0,
  confirmed_days int not null default 0,
  claimed_days   int not null default 0,
  disputed_days  int not null default 0
);

create index if not exists invoice_lines_invoice_idx
  on public.invoice_lines (invoice_id, employee_name);

comment on column public.invoice_lines.equivalents is
  'The SUM of the stored multiplier on each of the worker''s days in the period. Never recomputed from a rate here.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;

/* An invoice is between the employer and their contractor. A worker has no
   business reading one — not even the line about themselves, because the line
   only makes sense beside everyone else's pay on the same document.

   SELECT ONLY, and that is the load-bearing part. There is no INSERT, UPDATE
   or DELETE policy on either table, so no client can write one — not even the
   employer. A row-level policy of `for all` would have permitted a hand-made
   POST carrying figures of the client's own choosing, which is precisely the
   "second calculation engine" the brief forbids, wearing a different hat. The
   only way an invoice comes into existence is issue_invoice(), which reads the
   ledger itself. Exactly the arrangement day_record_events already uses. */
-- Both names are dropped, not just the current one: `create policy` has no
-- IF NOT EXISTS, so a second run has to clear its own name before re-creating
-- it, and an earlier draft used the _all name.
drop policy if exists invoices_employer_all on public.invoices;
drop policy if exists invoices_employer_select on public.invoices;
create policy invoices_employer_select on public.invoices
  for select to authenticated
  using (employer_id = auth.uid());

/* SECURITY DEFINER so this answers "do you own this invoice?" without the
   invoice_lines policy having to recurse into the invoices policy for every
   row it checks. */
create or replace function public.owns_invoice(inv uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.invoices i
    where i.id = inv and i.employer_id = auth.uid()
  );
$$;

revoke all on function public.owns_invoice(uuid) from public;
revoke all on function public.owns_invoice(uuid) from anon;
grant execute on function public.owns_invoice(uuid) to authenticated;

drop policy if exists invoice_lines_employer_all on public.invoice_lines;
drop policy if exists invoice_lines_employer_select on public.invoice_lines;
create policy invoice_lines_employer_select on public.invoice_lines
  for select to authenticated
  using (public.owns_invoice(invoice_id));

/* No DELETE policy on either table, on purpose. An invoice that was wrong, or
   superseded, is part of the paper trail — void_invoice() is how it is undone. */

-- ── Grants ──────────────────────────────────────────────────────────────────
-- SELECT only, and the write privileges are revoked explicitly rather than
-- merely not granted. 004_grants.sql sets `alter default privileges ... grant
-- select, insert, update, delete on tables to authenticated`, so a table
-- created afterwards inherits FULL write access unless it is taken away — which
-- is how the first draft of this file ended up reachable by a hand-made POST.
-- Belt (the policy above) and braces (this revoke): either alone would do, and
-- the pair means neither has to be trusted.

grant select on public.invoices to authenticated;
grant select on public.invoice_lines to authenticated;

revoke insert, update, delete on public.invoices from authenticated, anon;
revoke insert, update, delete on public.invoice_lines from authenticated, anon;

-- ── Issuing ─────────────────────────────────────────────────────────────────

/* Bills one contractor (or the unassigned workers) for one period.
 *
 * Reads the ledger, counts and sums, writes the document. Does not value any
 * day: the amounts it adds up were written by the money trigger when the day
 * was recorded, and are the same numbers the Summary screen shows.
 */
create or replace function public.issue_invoice(
  p_contractor_id uuid,
  p_from          date,
  p_to            date,
  p_note          text default null
) returns public.invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid        uuid := auth.uid();
  v_inv      public.invoices%rowtype;
  v_name     text;
  v_next     int;
  v_lines    int;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  if p_from is null or p_to is null then
    raise exception 'A period needs a start and an end date.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_to < p_from then
    raise exception 'The period ends before it starts.'
      using errcode = 'invalid_parameter_value';
  end if;

  /* SECURITY DEFINER bypasses RLS, so ownership is checked by hand. Without
     this, any signed-in account could bill any contractor in the database. */
  if p_contractor_id is not null then
    select c.name into v_name
      from public.contractors c
     where c.id = p_contractor_id and c.employer_id = uid;

    if not found then
      raise exception 'That contractor is not yours.' using errcode = 'insufficient_privilege';
    end if;
  else
    v_name := 'Unassigned workers';
  end if;

  /* One number per employer, allocated under a lock. Two devices issuing at
     the same instant would otherwise read the same max and collide — and the
     unique constraint would turn a busy afternoon into a failed invoice. */
  perform pg_advisory_xact_lock(hashtext('daypay:invoice:' || uid::text));

  select coalesce(max(nullif(regexp_replace(number, '^[^0-9]*', ''), '')::int), 0) + 1
    into v_next
    from public.invoices
   where employer_id = uid;

  begin
    insert into public.invoices
      (employer_id, contractor_id, contractor_name, number,
       period_from, period_to, note, issued_by)
    values
      (uid, p_contractor_id, v_name,
       'INV-' || lpad(v_next::text, 4, '0'),
       p_from, p_to, nullif(trim(coalesce(p_note, '')), ''), uid)
    returning * into v_inv;
  exception when unique_violation then
    /* Two whole sentences rather than a %s substitution: PGlite's RAISE
       appends a stray character to a substituted message, which would put a
       typo in front of the employer, and the sentence reads better spelled
       out anyway. */
    if p_contractor_id is null then
      raise exception 'That period has already been billed for the unassigned workers. Void the existing invoice first if it is wrong.'
        using errcode = 'check_violation';
    else
      raise exception 'That period has already been billed for this contractor. Void the existing invoice first if it is wrong.'
        using errcode = 'check_violation';
    end if;
  end;

  /* THE ONLY PLACE ANY FIGURE IS PRODUCED, and every one of them is a COUNT or
     a SUM of values already stored on the day. No rate is read, no multiplier
     is applied, nothing is derived. */
  insert into public.invoice_lines
    (invoice_id, employee_id, employee_name, job_title,
     days, worked, leave_days, equivalents, amount,
     confirmed_days, claimed_days, disputed_days)
  select
    v_inv.id,
    e.id,
    e.full_name,
    e.job_title,
    count(*)::int,
    count(*) filter (where d.kind <> 'leave')::int,
    count(*) filter (where d.kind = 'leave')::int,
    coalesce(sum(d.multiplier) filter (where d.kind <> 'leave'), 0),
    coalesce(sum(d.amount), 0),
    count(*) filter (where d.status = 'confirmed')::int,
    count(*) filter (where d.status = 'claimed')::int,
    count(*) filter (where d.status = 'disputed')::int
  from public.day_records d
  join public.employees e on e.id = d.employee_id
  where e.employer_id = uid
    and (
      (p_contractor_id is null and e.contractor_id is null)
      or e.contractor_id = p_contractor_id
    )
    and d.work_date between p_from and p_to
  group by e.id, e.full_name, e.job_title
  order by e.full_name;

  get diagnostics v_lines = row_count;

  if v_lines = 0 then
    /* Nothing recorded means nothing to bill. Rolling back is the honest
       outcome: an empty invoice with a number is worse than no invoice, and
       the number would have been burned on it. */
    raise exception 'There are no recorded days for that period, so there is nothing to bill.'
      using errcode = 'no_data_found';
  end if;

  update public.invoices i
     set worker_count   = agg.workers,
         actual_days    = agg.days,
         leave_days     = agg.leave,
         equivalents    = agg.equiv,
         total          = agg.amount,
         confirmed_days = agg.confirmed,
         claimed_days   = agg.claimed,
         disputed_days  = agg.disputed
    from (
      select count(*)::int as workers,
             coalesce(sum(days), 0)::int as days,
             coalesce(sum(leave_days), 0)::int as leave,
             coalesce(sum(equivalents), 0) as equiv,
             coalesce(sum(amount), 0) as amount,
             coalesce(sum(confirmed_days), 0)::int as confirmed,
             coalesce(sum(claimed_days), 0)::int as claimed,
             coalesce(sum(disputed_days), 0)::int as disputed
        from public.invoice_lines
       where invoice_id = v_inv.id
    ) agg
   where i.id = v_inv.id
  returning * into v_inv;

  return v_inv;
end $$;

revoke all on function public.issue_invoice(uuid, date, date, text) from public;
revoke all on function public.issue_invoice(uuid, date, date, text) from anon;
grant execute on function public.issue_invoice(uuid, date, date, text) to authenticated;

-- ── Voiding ─────────────────────────────────────────────────────────────────

/* The undo. The document and its lines stay exactly as they were; only the
   status changes, so "what did we send, and what did we replace it with" is
   answerable. A voided invoice stops blocking its period, which is what makes
   reissuing possible. */
create or replace function public.void_invoice(
  p_id     uuid,
  p_reason text default null
) returns public.invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  v_inv public.invoices%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv from public.invoices where id = p_id for update;

  if not found then
    raise exception 'That invoice no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_inv.employer_id <> uid then
    raise exception 'That invoice is not yours.' using errcode = 'insufficient_privilege';
  end if;

  if v_inv.status = 'void' then
    raise exception 'That invoice has already been voided.' using errcode = 'check_violation';
  end if;

  update public.invoices
     set status = 'void',
         voided_at = now(),
         void_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_id
  returning * into v_inv;

  return v_inv;
end $$;

revoke all on function public.void_invoice(uuid, text) from public;
revoke all on function public.void_invoice(uuid, text) from anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;

-- ── Proof ───────────────────────────────────────────────────────────────────
-- Invariants, not literal text. Migration 010 is the cautionary tale: it
-- asserted a string, the string was legitimately different, and the migration
-- could never install.

do $$
declare
  v_pred text;
begin
  -- The double-billing guard must be PARTIAL, i.e. only cover live invoices.
  -- Without the WHERE clause a voided invoice would go on blocking its period
  -- and reissuing would be impossible.
  select pg_get_indexdef(i.indexrelid) into v_pred
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'invoices_one_live_period_idx';

  if v_pred is null then
    raise exception 'The double-billing guard is missing. Do not stop here - tell me.';
  end if;

  if position('where' in lower(v_pred)) = 0 then
    raise exception
      'invoices_one_live_period_idx is not partial, so a voided invoice would block its period forever. Do not stop here - tell me.';
  end if;

  -- It must also cover the unassigned case, or those workers can be billed twice.
  if position('coalesce' in lower(v_pred)) = 0 then
    raise exception
      'The double-billing guard does not coalesce the contractor id, so the unassigned workers could be billed twice. Do not stop here - tell me.';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('invoices', 'invoice_lines')
       and cmd = 'DELETE'
  ) then
    raise exception
      'A DELETE policy exists on invoices or invoice_lines. Documents are voided, never deleted. Do not stop here - tell me.';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'invoices'
       and policyname = 'invoices_employer_select'
  ) then
    raise exception 'The employer read policy on invoices is missing. Do not stop here - tell me.';
  end if;

  /* No policy may permit a direct write. Without this, an employer could POST
     an invoice with any total they liked and it would be stored as fact. */
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('invoices', 'invoice_lines')
       and cmd in ('INSERT', 'UPDATE', 'ALL')
  ) then
    raise exception
      'A write policy exists on invoices or invoice_lines, so a client could hand-write a document. Do not stop here - tell me.';
  end if;

  /* And the grants must not offer one either — 004's default privileges give
     every new table INSERT/UPDATE/DELETE unless they are revoked. */
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('invoices', 'invoice_lines')
       and grantee in ('authenticated', 'anon')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception
      'authenticated still holds write grants on invoices or invoice_lines. Do not stop here - tell me.';
  end if;

  raise notice 'invoices are in place: one live invoice per contractor per period, figures summed from stored days, and no way for a worker to read one.';
end $$;

commit;

-- Verify afterwards:
--   select indexdef from pg_indexes
--    where schemaname = 'public' and tablename = 'invoices';
--     -> invoices_one_live_period_idx ... WHERE (status = 'issued'::text)
--
--   select policyname, cmd from pg_policies
--    where tablename in ('invoices','invoice_lines') order by tablename, policyname;
--     -> invoices_employer_all | ALL
--        invoice_lines_employer_all | ALL
--        and NO delete policy anywhere
--
-- Then bill a period in the app and check the arithmetic against the ledger:
--   select i.number, i.contractor_name, i.period_from, i.period_to, i.status,
--          i.worker_count, i.actual_days, i.equivalents, i.total
--     from public.invoices i order by i.issued_at desc;
--
--   select sum(d.amount) as ledger_total,
--          (select total from public.invoices order by issued_at desc limit 1) as invoice_total
--     from public.day_records d
--     join public.employees e on e.id = d.employee_id
--    where d.work_date between <period_from> and <period_to>;
--     -> the two must be equal. If they are not, it is a bug and I want to know.

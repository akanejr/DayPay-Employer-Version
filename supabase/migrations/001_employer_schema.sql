-- ============================================================================
-- DayPay Employer Version — migration 001: multi-employee schema
-- ============================================================================
-- Run this in the Supabase SQL Editor on the NEW DEV project only.
-- It is idempotent-ish: it will refuse to run twice rather than corrupt data.
--
-- DESIGN RULES (these are the whole point of the schema)
--
--   1. Money is computed SERVER-SIDE from the rate period in force on the
--      work date. A client may claim that they worked; it may NOT claim what
--      that work pays. See the trigger `day_records_compute_money`.
--
--   2. Amounts are FROZEN. Once a day is confirmed, its amount never
--      recomputes, even if the rate changes later. A raise is a new rate
--      period; it never rewrites history.
--
--   3. Every change to a claim is recorded in `day_record_events`. Nothing
--      is silently overwritten.
--
--   4. An employee can read exactly one employee row: their own. Never a
--      colleague's, never the roster.
-- ============================================================================

begin;

-- ── Guard: refuse to run on a project that already has the schema ──────────
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'day_records'
  ) then
    raise exception
      'Migration 001 has already been applied. Nothing was changed.';
  end if;
end $$;


-- ============================================================================
-- TABLES
-- ============================================================================

-- An employer is simply an authenticated user who owns employees.
create table public.employers (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A person on the roster. `employee_user_id` is null until they sign up and
-- link themselves with the invite code; until then the employer maintains
-- their days on their behalf.
create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  employer_id      uuid not null references auth.users(id) on delete cascade,
  full_name        text not null check (length(trim(full_name)) > 0),
  job_title        text,
  email            text,
  employee_user_id uuid references auth.users(id) on delete set null,
  invite_code      text unique,
  status           text not null default 'active'
                     check (status in ('active', 'archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index employees_employer_idx on public.employees (employer_id);
create index employees_user_idx     on public.employees (employee_user_id)
  where employee_user_id is not null;

-- A rate is in force from `effective_from` (inclusive) until the next period
-- begins. A raise is appended; it is never applied retroactively.
create table public.employee_rate_periods (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  effective_from     date not null,
  daily_rate         numeric(14,2) not null check (daily_rate >= 0),
  weekend_multiplier numeric(6,3)  not null default 2 check (weekend_multiplier >= 0),
  holiday_multiplier numeric(6,3)  not null default 2 check (holiday_multiplier >= 0),
  created_at         timestamptz not null default now(),
  unique (employee_id, effective_from)
);

create index rate_periods_lookup_idx
  on public.employee_rate_periods (employee_id, effective_from desc);

-- One row per person per day. `amount` is frozen at confirmation.
create table public.day_records (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id) on delete cascade,
  work_date      date not null,

  kind           text not null
                   check (kind in ('work','weekend','overtime','holiday','leave')),
  leave_type     text,          -- only meaningful when kind = 'leave'
  leave_percent  numeric(5,2) not null default 0
                   check (leave_percent >= 0 and leave_percent <= 100),

  -- Money. All three are written by the trigger, not by the client.
  rate           numeric(14,2) not null default 0 check (rate >= 0),
  multiplier     numeric(6,3)  not null default 1 check (multiplier >= 0),
  amount         numeric(14,2) not null default 0 check (amount >= 0),

  -- Workflow
  status         text not null default 'claimed'
                   check (status in ('claimed','confirmed','disputed')),
  note           text,
  claimed_by     uuid references auth.users(id),
  confirmed_by   uuid references auth.users(id),
  confirmed_at   timestamptz,
  disputed_by    uuid references auth.users(id),
  disputed_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One record per person per day. This is what makes the ledger a ledger.
  unique (employee_id, work_date),

  -- A leave record must name its type; a non-leave record must not.
  constraint leave_type_consistency check (
    (kind = 'leave' and leave_type is not null)
    or (kind <> 'leave' and leave_type is null)
  )
);

create index day_records_lookup_idx  on public.day_records (employee_id, work_date desc);
create index day_records_month_idx   on public.day_records (employee_id, work_date)
  where status <> 'disputed';

-- Append-only audit trail. Nothing here is ever updated or deleted.
create table public.day_record_events (
  id           bigserial primary key,
  day_record_id uuid references public.day_records(id) on delete set null,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  actor        uuid references auth.users(id),
  action       text not null,
  reason       text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

create index day_record_events_idx on public.day_record_events (employee_id, created_at desc);


-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================
-- These are SECURITY DEFINER so that RLS policies calling them do not recurse
-- back into the same policies. Each takes a specific employee id and answers
-- a yes/no question about the CURRENT user only, so they cannot be used to
-- enumerate anyone else's data. search_path is pinned to defeat hijacking.

create or replace function public.is_employer_of(emp uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.id = emp
      and e.employer_id = auth.uid()
  );
$$;

create or replace function public.is_self(emp uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.id = emp
      and e.employee_user_id = auth.uid()
  );
$$;

-- True when the current user may see this employee at all.
create or replace function public.can_see_employee(emp uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.is_employer_of(emp) or public.is_self(emp);
$$;

revoke all on function public.is_employer_of(uuid) from public;
revoke all on function public.is_self(uuid) from public;
revoke all on function public.can_see_employee(uuid) from public;
grant execute on function public.is_employer_of(uuid) to authenticated;
grant execute on function public.is_self(uuid) to authenticated;
grant execute on function public.can_see_employee(uuid) to authenticated;


-- ============================================================================
-- MONEY ENGINE — the client never decides what a day is worth
-- ============================================================================

create or replace function public.day_records_compute_money()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  period      public.employee_rate_periods%rowtype;
  m           numeric(6,3);
  chosen_mult numeric(6,3);
begin
  -- Find the rate period in force ON THE WORK DATE (not today).
  select * into period
  from public.employee_rate_periods p
  where p.employee_id = new.employee_id
    and p.effective_from <= new.work_date
  order by p.effective_from desc
  limit 1;

  if not found then
    raise exception
      'No rate period covers %. Add a rate for this employee effective on or before that date.',
      new.work_date
      using errcode = 'check_violation';
  end if;

  -- A raise that starts tomorrow must not retroactively reprice today, and a
  -- period that starts after the work date is not eligible at all (handled by
  -- the <= filter above). This is rule 2 restated in code.
  chosen_mult := case new.kind
    when 'weekend'  then period.weekend_multiplier
    when 'overtime' then period.weekend_multiplier   -- matches the client engine
    when 'holiday'  then period.holiday_multiplier
    when 'leave'    then new.leave_percent / 100.0
    else 1
  end;

  new.rate       := period.daily_rate;
  new.multiplier := chosen_mult;
  new.amount     := round(period.daily_rate * chosen_mult, 2);
  new.updated_at := now();

  return new;
end $$;

create trigger day_records_compute_money
  before insert or update of kind, leave_percent, work_date, employee_id
  on public.day_records
  for each row execute function public.day_records_compute_money();


-- ── BEFORE: validate and stamp. No writes to other tables. ────────────────────

create or replace function public.day_records_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.claimed_by := coalesce(new.claimed_by, auth.uid());

  else  -- UPDATE
    -- Frozen money: a confirmed day's amount is history.
    if old.status = 'confirmed' then
      if new.amount       <> old.amount
         or new.rate        <> old.rate
         or new.multiplier  <> old.multiplier
         or new.work_date   <> old.work_date
         or new.employee_id <> old.employee_id then
        raise exception
          'This day is confirmed and its amount is final. Reopen it before changing the money.'
          using errcode = 'check_violation';
      end if;
    end if;

    -- Only the employer may move a day into 'confirmed'.
    if new.status = 'confirmed'
       and old.status <> 'confirmed'
       and not public.is_employer_of(new.employee_id) then
      raise exception 'Only the employer can confirm a day.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Resolution stamps. Branching on tg_op rather than using
  -- `tg_op = 'INSERT' or old.status ...` because PostgreSQL does not guarantee
  -- short-circuit evaluation, and reading OLD during an INSERT would raise
  -- "record old is not assigned yet" and mask the real behaviour.
  if new.status = 'confirmed' then
    if tg_op = 'INSERT' or old.status <> 'confirmed' then
      new.confirmed_by := auth.uid();
      new.confirmed_at := now();
    end if;
  elsif new.status = 'disputed' then
    if tg_op = 'INSERT' or old.status <> 'disputed' then
      new.disputed_by := auth.uid();
      new.disputed_at := now();
    end if;
  elsif new.status = 'claimed' and tg_op = 'UPDATE'
        and old.status in ('confirmed', 'disputed') then
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.disputed_by  := null;
    new.disputed_at  := null;
  end if;

  return new;
end $$;

create trigger day_records_guard
  before insert or update on public.day_records
  for each row execute function public.day_records_guard();


-- ── AFTER: record the audit trail. ───────────────────────────────────────
-- This MUST be an AFTER trigger. `day_record_events.day_record_id` has a
-- foreign key to `day_records.id`, and in a BEFORE trigger that row does not
-- exist yet — the constraint fails with 23503.

create or replace function public.day_records_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.day_record_events
      (day_record_id, employee_id, actor, action, after)
    values
      (new.id, new.employee_id, auth.uid(), 'created', to_jsonb(new));

  else  -- UPDATE
    if new.status is distinct from old.status then
      insert into public.day_record_events
        (day_record_id, employee_id, actor, action, reason, before, after)
      values
        (new.id, new.employee_id, auth.uid(),
         'status:' || old.status || '->' || new.status,
         new.note, to_jsonb(old), to_jsonb(new));

    -- Fields compared explicitly: record-level `is distinct from` is not
    -- dependable, and `updated_at` changes on every write, so whole-row
    -- comparison would log a spurious "amended" for no-ops.
    elsif new.kind          is distinct from old.kind
       or new.work_date     is distinct from old.work_date
       or new.leave_type    is distinct from old.leave_type
       or new.leave_percent is distinct from old.leave_percent
       or new.note          is distinct from old.note
       or new.amount        is distinct from old.amount
       or new.rate          is distinct from old.rate
       or new.multiplier    is distinct from old.multiplier
       or new.employee_id   is distinct from old.employee_id then
      insert into public.day_record_events
        (day_record_id, employee_id, actor, action, reason, before, after)
      values
        (new.id, new.employee_id, auth.uid(), 'amended',
         new.note, to_jsonb(old), to_jsonb(new));
    end if;
  end if;

  return null;
end $$;

create trigger day_records_audit
  after insert or update on public.day_records
  for each row execute function public.day_records_audit();

-- Note: the two BEFORE triggers fire in name-alphabetical order, so
-- `day_records_compute_money` runs before `day_records_guard`. Money is
-- therefore settled before the guard inspects it.

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.employers            enable row level security;
alter table public.employees            enable row level security;
alter table public.employee_rate_periods enable row level security;
alter table public.day_records          enable row level security;
alter table public.day_record_events    enable row level security;

-- ── employers: a user sees and maintains only their own row ───────────────
create policy employers_self_select on public.employers
  for select to authenticated using (user_id = auth.uid());
create policy employers_self_insert on public.employers
  for insert to authenticated with check (user_id = auth.uid());
create policy employers_self_update on public.employers
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── employees ─────────────────────────────────────────────────────────────
-- An employer sees their whole roster. An employee sees exactly one row:
-- their own. There is deliberately no policy that lets an employee read the
-- roster, and none that lets them edit their own row (which would otherwise
-- allow changing their own name, rate link, or status).
create policy employees_employer_all on public.employees
  for all to authenticated
  using (employer_id = auth.uid())
  with check (employer_id = auth.uid());

create policy employees_self_select on public.employees
  for select to authenticated
  using (employee_user_id = auth.uid());

-- ── employee_rate_periods ─────────────────────────────────────────────────
-- Only the employer may change rates. The employee may READ their own rates,
-- because a payslip they cannot verify is not a payslip.
create policy rate_periods_employer_all on public.employee_rate_periods
  for all to authenticated
  using (public.is_employer_of(employee_id))
  with check (public.is_employer_of(employee_id));

create policy rate_periods_self_select on public.employee_rate_periods
  for select to authenticated
  using (public.is_self(employee_id));

-- ── day_records ───────────────────────────────────────────────────────────
create policy day_records_employer_all on public.day_records
  for all to authenticated
  using (public.is_employer_of(employee_id))
  with check (public.is_employer_of(employee_id));

-- The employee may read their own days.
create policy day_records_self_select on public.day_records
  for select to authenticated
  using (public.is_self(employee_id));

-- The employee may claim a day — but only as a claim. `status = 'claimed'` in
-- the WITH CHECK is load-bearing: without it an employee could insert a row
-- that is already 'confirmed' and bypass the employer entirely.
create policy day_records_self_insert on public.day_records
  for insert to authenticated
  with check (public.is_self(employee_id) and status = 'claimed');

-- An employee may edit or withdraw their own claim while it is still
-- unresolved. They may not touch a confirmed or disputed day, and they may
-- not edit anyone else's.
create policy day_records_self_update on public.day_records
  for update to authenticated
  using (public.is_self(employee_id) and status = 'claimed')
  with check (public.is_self(employee_id) and status in ('claimed','disputed'));

create policy day_records_self_delete on public.day_records
  for delete to authenticated
  using (public.is_self(employee_id) and status = 'claimed');

-- ── day_record_events ─────────────────────────────────────────────────────
-- Read-only to both parties. Rows are written by SECURITY DEFINER triggers,
-- so no INSERT policy exists — and that is deliberate: an audit trail that
-- the audited party can write to is not an audit trail.
create policy events_employer_select on public.day_record_events
  for select to authenticated
  using (public.is_employer_of(employee_id));

create policy events_self_select on public.day_record_events
  for select to authenticated
  using (public.is_self(employee_id));


-- ============================================================================
-- KEEP updated_at HONEST
-- ============================================================================

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger employers_updated_at
  before update on public.employers
  for each row execute function public.handle_updated_at();

create trigger employees_updated_at
  before update on public.employees
  for each row execute function public.handle_updated_at();

commit;

-- ============================================================================
-- NEXT STEP: run supabase/harness/rls_test.sql to prove the isolation holds.
-- Do not put real salary data in this project until that harness passes.
-- ============================================================================

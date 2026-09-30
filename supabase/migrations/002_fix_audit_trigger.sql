-- ============================================================================
-- DayPay Employer Version — migration 002: fix the audit trigger
-- ============================================================================
-- Run this in the Supabase SQL Editor. It is fully idempotent — safe to run
-- repeatedly, and safe to run before or after migration 001.
--
-- THE BUG
--   `day_records_guard` was a BEFORE INSERT trigger, and it wrote the audit
--   row into `day_record_events` referencing `new.id`. In a BEFORE trigger the
--   `day_records` row does not exist yet, so the foreign key
--   `day_record_events.day_record_id -> day_records.id` was violated:
--
--     ERROR 23503: insert or update on table "day_record_events" violates
--     foreign key constraint "day_record_events_day_record_id_fkey"
--
-- THE FIX
--   Split the work by trigger timing, which is what each phase is actually for:
--
--     BEFORE  — validate and stamp. May raise an exception to reject the row;
--               may modify NEW. Cannot reference a row that does not exist yet.
--     AFTER   — record. The row exists, so foreign keys resolve.
--
--   Validation and bookkeeping stay in the BEFORE trigger; the audit trail
--   moves to a new AFTER trigger.
--
--   This also makes `day_records_guard` easier to reason about: it either
--   raises or it returns, and it has no side effects on other tables.
-- ============================================================================

begin;

-- ── BEFORE: validate and stamp. No writes to other tables. ─────────────────

create or replace function public.day_records_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Who claimed it. Never trust a client-supplied value here.
    new.claimed_by := coalesce(new.claimed_by, auth.uid());

  else  -- UPDATE
    -- Frozen money: a confirmed day's amount is history. Changing it is
    -- refused outright; the day must be reopened first.
    if old.status = 'confirmed' then
      if new.amount      <> old.amount
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

  -- Resolution stamps, so a caller cannot forge them. Branching on tg_op here
  -- rather than using `tg_op = 'INSERT' or old.status ...` because PostgreSQL
  -- does not guarantee short-circuit evaluation — reading OLD during an INSERT
  -- would raise "record old is not assigned yet" and mask the real behaviour.
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
    -- Reopened: clear the resolution stamps.
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.disputed_by  := null;
    new.disputed_at  := null;
  end if;

  return new;
end $$;


-- ── AFTER: record. The row exists now, so the FK resolves. ─────────────────

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
    -- A status change is the event that matters most, so it is recorded even
    -- if nothing else moved.
    if new.status is distinct from old.status then
      insert into public.day_record_events
        (day_record_id, employee_id, actor, action, reason, before, after)
      values
        (new.id, new.employee_id, auth.uid(),
         'status:' || old.status || '->' || new.status,
         new.note, to_jsonb(old), to_jsonb(new));

    -- Otherwise record a genuine amendment. Fields are compared explicitly
    -- because record-level `is distinct from` is not dependable, and because
    -- `updated_at` changes on every write — comparing whole rows would log an
    -- "amended" event for no-ops.
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

  return null;  -- ignored for AFTER triggers
end $$;

-- Remove the old BEFORE trigger that referenced the audit table, then install
-- the two correct ones.
drop trigger if exists day_records_guard on public.day_records;
create trigger day_records_guard
  before insert or update on public.day_records
  for each row execute function public.day_records_guard();

drop trigger if exists day_records_audit on public.day_records;
create trigger day_records_audit
  after insert or update on public.day_records
  for each row execute function public.day_records_audit();

-- Note: the two BEFORE triggers fire in name-alphabetical order, so
-- `day_records_compute_money` runs before `day_records_guard`. Money is
-- therefore settled before the guard inspects it. Do not rename either
-- without preserving that order.

commit;

-- ============================================================================
-- Verify the fix landed:
--
--   select tgname, pg_get_triggerdef(oid) as definition
--   from pg_trigger
--   where tgrelid = 'public.day_records'::regclass and not tgisinternal
--   order by tgname;
--
-- Expect exactly three: day_records_audit (AFTER INSERT OR UPDATE),
-- day_records_compute_money (BEFORE), day_records_guard (BEFORE).
-- ============================================================================

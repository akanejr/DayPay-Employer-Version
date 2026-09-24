-- ============================================================================
-- DayPay Employer Version — migration 003: legacy employee-side table
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- WHY THIS EXISTS
--   Migration 001 built the multi-employee schema (employers, employees,
--   day_records, ...). But the existing DayPay app screens — the month
--   calendar, year view, payslips — store their data in a single per-user
--   `user_data` row. That table was never created on this project, so signing
--   in produces errors like:
--
--     relation "public.user_data" does not exist
--
--   Creating it makes the whole app work in one place: the personal tracker on
--   the Month and Year tabs, and the staff roster on the Staff tab.
--
-- RELATIONSHIP TO THE NEW SCHEMA
--   These two worlds are deliberately separate for now.
--
--     user_data    — one row per person, their own private log. RLS keyed on
--                    `auth.uid() = user_id`. This is the original single-user
--                    design, unchanged.
--     employees /  — the multi-employee ledger. An employer owns rows; an
--     day_records    employee can read only their own, and only if linked.
--
--   Migrating a personal log into a linked employee record is decision-
--   dependent work (does the past belong to the employer? at which rate?) and
--   is NOT done here. This migration only stops the errors.
-- ============================================================================

begin;

create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attendance jsonb not null default '{}'::jsonb,
  settings jsonb not null default
    '{"dailyRate":16000,"weekendMultiplier":2}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- Four policies, one per operation, each scoped to the owning user. Written as
-- drop-then-create so re-running this file is safe.
drop policy if exists "Users can view own data"   on public.user_data;
create policy "Users can view own data"
  on public.user_data for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own data" on public.user_data;
create policy "Users can insert own data"
  on public.user_data for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own data" on public.user_data;
create policy "Users can update own data"
  on public.user_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own data" on public.user_data;
create policy "Users can delete own data"
  on public.user_data for delete
  using (auth.uid() = user_id);

-- Keep updated_at honest.
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists set_updated_at on public.user_data;
create trigger set_updated_at
  before update on public.user_data
  for each row execute function public.handle_updated_at();

-- Explicit grants, so a missing default-privilege cannot surface later as an
-- opaque "permission denied" instead of a normal RLS denial.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.user_data to authenticated;

commit;

-- ============================================================================
-- Verify:
--
--   select count(*) from public.user_data;
--
-- Expect 0 rows, no error. Then sign in to the app — the cloud error should
-- be gone and the month view should load.
-- ============================================================================

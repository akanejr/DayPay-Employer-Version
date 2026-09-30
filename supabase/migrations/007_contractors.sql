-- DayPay — Phase 3: contractors.
--
-- WHY THIS EXISTS
--
-- The roster is currently flat: an employer has workers, full stop. On a plant
-- or a site, workers arrive through contractors — Contractor Alpha brings
-- seven fitters, Contractor Beta brings five riggers — and a flat list cannot
-- answer "how many of Alpha's people are in today", which is the question the
-- employer is actually asked.
--
-- So one table sits between the employer and their workers:
--
--   EMPLOYER  →  CONTRACTORS  →  WORKERS
--
-- SAFE TO APPLY
--   * additive only: one new table, one new nullable column
--   * no existing row changes meaning
--   * a worker with no contractor is not a broken row — it is how every
--     existing worker starts, and the UI has an 'Unassigned' group for them
--   * deleting a contractor is not possible through the UI, but if it ever
--     happened the FK is `on delete set null`, so workers are orphaned onto
--     the unassigned list rather than deleted with it
--
-- Deliberately NOT here: anything about attendance sessions or daily codes.
-- That is Phase 4. This migration is only the hierarchy.

begin;

-- ── contractors ─────────────────────────────────────────────────────────────

create table if not exists public.contractors (
  id          uuid primary key default gen_random_uuid(),
  employer_id uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  note        text,
  status      text not null default 'active'
                check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.contractors is
  'A supplier of workers. One employer -> many contractors -> many employees.';

-- Two contractors cannot share a name for the same employer, because the
-- employer would then be unable to tell them apart in a dropdown. Compared
-- case- and space-insensitively: 'Alpha' and 'alpha ' are the same supplier.
create unique index if not exists contractors_employer_name_idx
  on public.contractors (employer_id, lower(trim(name)));

create index if not exists contractors_employer_idx
  on public.contractors (employer_id);

drop trigger if exists contractors_updated_at on public.contractors;
create trigger contractors_updated_at
  before update on public.contractors
  for each row execute function public.handle_updated_at();

-- ── employees.contractor_id ─────────────────────────────────────────────────

alter table public.employees
  add column if not exists contractor_id uuid
    references public.contractors(id) on delete set null;

create index if not exists employees_contractor_idx
  on public.employees (contractor_id)
  where contractor_id is not null;

comment on column public.employees.contractor_id is
  'Which contractor supplies this worker. NULL means unassigned, which is the correct state for every worker created before contractors existed.';

-- ── Permissions ─────────────────────────────────────────────────────────────

alter table public.contractors enable row level security;

-- The employer owns their contractor list outright. Same shape as the
-- employers_self_* policies: the whole row is theirs or it is invisible.
drop policy if exists contractors_employer_all on public.contractors;
create policy contractors_employer_all on public.contractors
  for all to authenticated
  using (employer_id = auth.uid())
  with check (employer_id = auth.uid());

/* A worker may read the ONE contractor that supplies them — and nothing else.
   This goes through a SECURITY DEFINER helper rather than reading `employees`
   inside the policy. The helper bypasses RLS while it looks, which is what
   keeps this from recursing through employees_self_select.

   Why a worker needs this at all: their own row already names a contractor, so
   being unable to resolve that id to a name would leave them looking at a bare
   uuid. It grants no access to any other contractor, or to any other worker. */
create or replace function public.is_my_contractor(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.contractor_id = cid
      and e.employee_user_id = auth.uid()
  );
$$;

revoke all on function public.is_my_contractor(uuid) from public;
revoke all on function public.is_my_contractor(uuid) from anon;
grant execute on function public.is_my_contractor(uuid) to authenticated;

drop policy if exists contractors_worker_select on public.contractors;
create policy contractors_worker_select on public.contractors
  for select to authenticated
  using (public.is_my_contractor(id));

-- ── Grants ──────────────────────────────────────────────────────────────────
-- New tables in public are no longer automatically exposed to the Data API,
-- so the grant is explicit. RLS still decides which ROWS are visible; this only
-- decides that the table can be reached at all.

grant select, insert, update, delete on public.contractors to authenticated;

-- Proof the shape is what we think it is.
do $$
declare
  n_contractors int;
  n_assigned    int;
  n_unassigned  int;
begin
  select count(*) into n_contractors from public.contractors;
  select count(*) filter (where contractor_id is not null),
         count(*) filter (where contractor_id is null)
    into n_assigned, n_unassigned
    from public.employees;

  raise notice 'contractors: %, employees assigned: %, unassigned: %',
    n_contractors, n_assigned, n_unassigned;

  if n_unassigned > 0 then
    raise notice 'Unassigned workers are expected — that is every worker created before contractors existed.';
  end if;
end $$;

commit;

-- Verify afterwards:
--   select id, name, status from public.contractors;
--   select full_name, contractor_id from public.employees;
--   select proname, prosecdef from pg_proc where proname = 'is_my_contractor';
--     -> one row, prosecdef = true

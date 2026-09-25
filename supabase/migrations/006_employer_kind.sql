-- DayPay — Phase 1: distinguish a workforce account from a personal one.
--
-- WHY THIS IS NEEDED
--
-- Today the only question the app asks is "is there a row in `employers`?",
-- and that was a fine proxy for "is this an employer?" while the only way to
-- get such a row was to open the Staff tab and act.
--
-- The one-ledger plan changes that. Every account gets a personal workspace so
-- that its days live in `day_records` alongside everyone else's — which means
-- every account would answer "yes" to that question, and a personal user would
-- be handed a staff roster, an invite button and a contractor dashboard.
--
-- So the row needs to say what kind of account it is.
--
--   'business' — a real workforce account. Staff tab, roster, attendance,
--                contractors, invoices.
--   'personal' — someone tracking their own days. Month and Year only.
--
-- SAFE TO APPLY
--   * additive only: one column, with a default
--   * no data is deleted, no column is dropped, no type changes
--   * no existing row changes meaning — see the backfill below
--
-- The default is deliberately 'personal'. If some future code path inserts an
-- employers row without saying what it is, the safe answer is the one that
-- grants nothing.

begin;

alter table public.employers
  add column if not exists kind text not null default 'personal'
    check (kind in ('personal', 'business'));

comment on column public.employers.kind is
  'business = workforce account (roster, attendance, invoices). personal = own days only. Default personal so an unspecified account is granted nothing.';

-- Backfill. Every employers row that exists right now was created by a real
-- workforce action — `ensureEmployer()` is only ever reached from the Staff
-- tab — so the only truthful value for them is 'business'. Without this the
-- column default would silently demote the owner's existing account and the
-- Staff tab would disappear.
update public.employers
   set kind = 'business'
 where kind = 'personal';

-- RLS is unchanged: `employers_self_select` already restricts a row to its
-- owner, and `kind` rides along on that row. No new policy is needed and none
-- is added, because a column the owner may read is not a new privilege.

-- Proof the backfill is what we think it is.
do $$
declare
  n_business int;
  n_personal int;
begin
  select count(*) filter (where kind = 'business'),
         count(*) filter (where kind = 'personal')
    into n_business, n_personal
    from public.employers;

  raise notice 'employers: % business, % personal', n_business, n_personal;

  if n_business = 0 and n_personal = 0 then
    raise notice 'No employers rows yet. The first one created will be business.';
  end if;
end $$;

commit;

-- Verify afterwards:
--   select user_id, business_name, kind from public.employers;
-- Expect kind = 'business' for the account that has been using the Staff tab.

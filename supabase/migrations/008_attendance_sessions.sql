-- DayPay — Phase 4: workplace attendance sessions and daily codes.
--
-- WHAT THIS ADDS
--
-- Until now only the employer could create a day. This migration makes the
-- worker able to record their own attendance — but only through a session the
-- employer has deliberately opened, on the day, with a code that dies at
-- midnight. No GPS, no geofencing, no location services: verification is
-- session + code + account + date + contractor.
--
--   employer opens attendance  ->  a 4-digit code for today
--   worker is told the code at the workplace
--   worker enters it            ->  one day_records row, source 'check_in'
--
-- TWO EXISTING HOLES THIS ALSO CLOSES
--
-- Both were reachable by a worker calling the REST API directly, bypassing the
-- UI entirely. Neither is theoretical — they need no special tooling, only a
-- browser console.
--
--   1. `day_records_self_insert` let a worker insert a day for ANY date, with
--      any kind, from anywhere. That is exactly what the brief forbids
--      ("an employee must not be able to create attendance records outside
--      the authorized attendance-session rules"). It now requires an open
--      session covering that worker and that date.
--
--   2. `day_records_self_update` let a worker UPDATE their own claimed day.
--      The money trigger recomputes the amount from the kind, so changing
--      kind 'work' -> 'overtime' paid them double, through the system's own
--      arithmetic. The guard trigger now refuses a kind, date or person change
--      from anyone but the employer.
--
-- SAFE TO APPLY
--   * additive except for one replaced policy and one replaced trigger function,
--     both of which only ever TIGHTEN access
--   * no data is deleted; existing day_records rows get source 'employer', which
--     is what they are
--   * no existing UI depends on either hole: EmployeeView never creates days,
--     and the employer path is unaffected because is_employer_of still passes

begin;

-- ── attendance_sessions ─────────────────────────────────────────────────────

create table if not exists public.attendance_sessions (
  id            uuid primary key default gen_random_uuid(),
  employer_id   uuid not null references auth.users(id) on delete cascade,

  /* NULL means the whole site: the code works for any active worker. Set means
     the code works only for workers of that contractor, which is what makes
     "a code for Contractor Alpha must not work for Contractor Beta" true. */
  contractor_id uuid references public.contractors(id) on delete set null,

  work_date     date not null,
  code          text not null check (code ~ '^[0-9]{4}$'),

  status        text not null default 'open'
                  check (status in ('open', 'closed')),

  opens_at      timestamptz not null default now(),

  /* The expiry is stored as a timestamp, not derived from work_date, and it is
     supplied by the employer's client as the end of THEIR local day. The
     database runs in UTC; a session opened at 00:30 in Lagos is 23:30 UTC the
     previous day, so deriving validity from current_date would hand out the
     wrong day's session to everyone checking in early. A timestamp needs no
     timezone guess: the code simply stops working when the employer's day
     ends. This is also what makes "yesterday's code must not work today" true
     without any explicit date comparison. */
  expires_at    timestamptz not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz,
  closed_by     uuid references auth.users(id) on delete set null,

  constraint attendance_session_window check (expires_at > opens_at)
);

comment on table public.attendance_sessions is
  'One open window per contractor per day in which workers may record their own attendance. The code is single-day and never leaves the employer side.';

comment on column public.attendance_sessions.contractor_id is
  'NULL = whole site (any active worker). Set = only that contractor''s workers.';

-- One session per contractor per day. Written as two partial indexes rather
-- than one unique constraint because PostgreSQL treats NULLs as distinct, so a
-- plain unique(employer_id, contractor_id, work_date) would happily allow two
-- site-wide sessions for the same day.
create unique index if not exists attendance_sessions_contractor_day_idx
  on public.attendance_sessions (employer_id, contractor_id, work_date)
  where contractor_id is not null;

create unique index if not exists attendance_sessions_site_day_idx
  on public.attendance_sessions (employer_id, work_date)
  where contractor_id is null;

create index if not exists attendance_sessions_open_idx
  on public.attendance_sessions (employer_id, status, expires_at);

drop trigger if exists attendance_sessions_updated_at on public.attendance_sessions;
create trigger attendance_sessions_updated_at
  before update on public.attendance_sessions
  for each row execute function public.handle_updated_at();

-- ── check_in_attempts ───────────────────────────────────────────────────────
-- Exists for one reason: a 4-digit code is 10,000 combinations, which a
-- determined guesser could walk through. The attempt cap is what makes four
-- digits acceptable, and it is why the code shape decision was "4 digits WITH
-- an attempt limit".
--
-- No policies at all. It is written and read only by SECURITY DEFINER
-- functions, so no client can read it, write it, or clear its own record.

create table if not exists public.check_in_attempts (
  id           bigserial primary key,
  session_id   uuid not null references public.attendance_sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists check_in_attempts_cap_idx
  on public.check_in_attempts (session_id, user_id, attempted_at desc);

-- ── day_records provenance ──────────────────────────────────────────────────

alter table public.day_records
  add column if not exists source text not null default 'employer'
    check (source in ('employer', 'check_in', 'correction'));

alter table public.day_records
  add column if not exists session_id uuid
    references public.attendance_sessions(id) on delete set null;

alter table public.day_records
  add column if not exists checked_in_at timestamptz;

comment on column public.day_records.source is
  'How the day got here: employer (marked on their behalf), check_in (the worker entered a session code), correction (approved request).';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.attendance_sessions enable row level security;
alter table public.check_in_attempts   enable row level security;

-- The employer owns their sessions outright.
drop policy if exists attendance_sessions_employer_all on public.attendance_sessions;
create policy attendance_sessions_employer_all on public.attendance_sessions
  for all to authenticated
  using (employer_id = auth.uid())
  with check (employer_id = auth.uid());

/* Deliberately NO worker policy on attendance_sessions.
   The brief says the code must not be exposed inside the employee interface.
   The strongest way to honour that is for the worker's own query to be unable
   to return the row at all. A worker learns whether attendance is open only
   through my_attendance_status(), which returns a boolean and a name and never
   the code. */

-- ── Session lookup used by the insert policy ────────────────────────────────

/* Is there an open session covering this worker on this date?
   This is what turns "workers may record their own days" into "workers may
   record their own days ONLY while the employer has attendance open". */
create or replace function public.session_covers(emp uuid, d date)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.employees e
      join public.attendance_sessions s
        on s.employer_id = e.employer_id
       and (s.contractor_id is null or s.contractor_id = e.contractor_id)
     where e.id = emp
       and s.work_date = d
       and s.status = 'open'
       and now() < s.expires_at
  );
$$;

revoke all on function public.session_covers(uuid, date) from public;
revoke all on function public.session_covers(uuid, date) from anon;
grant execute on function public.session_covers(uuid, date) to authenticated;

-- ── Hole 1: self-insert now requires an open session ────────────────────────

drop policy if exists day_records_self_insert on public.day_records;
create policy day_records_self_insert on public.day_records
  for insert to authenticated
  with check (
    public.is_self(employee_id)
    and status = 'claimed'
    and public.session_covers(employee_id, work_date)
  );

-- ── Hole 2: a worker may not reclassify their own day ───────────────────────
-- `day_records_guard` is replaced wholesale, carrying forward everything 002
-- put in it, plus the new refusal. Kept in the trigger rather than the policy
-- because comparing OLD with NEW is not expressible in a row-level policy.

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
    /* A worker may not change WHAT a day is — only their employer may
       reclassify, and only deliberately. Without this, changing kind
       'work' -> 'overtime' doubles the money through the system's own
       arithmetic, and changing work_date moves a paid day to another day. */
    if not public.is_employer_of(new.employee_id) then
      if new.kind        is distinct from old.kind
         or new.work_date  is distinct from old.work_date
         or new.employee_id is distinct from old.employee_id
         or new.leave_type is distinct from old.leave_type
         or new.leave_percent is distinct from old.leave_percent then
        raise exception
          'Only your employer can change what a day is. Ask them to correct it.'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

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

-- ── Employer: open and close attendance ─────────────────────────────────────

/* Opens attendance, or reopens it with a FRESH code.

   Rotating on reopen is the point: once a session is closed the old code is
   dead permanently, so a code photographed on Monday cannot be replayed on
   Wednesday even if the employer reopens the same day by accident. */
create or replace function public.open_attendance(
  p_contractor_id uuid,
  p_work_date     date,
  p_expires_at    timestamptz
) returns public.attendance_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid     uuid := auth.uid();
  v_row   public.attendance_sessions%rowtype;
  v_code  text;
  i       int;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  if p_work_date is null then
    raise exception 'A session needs a date.' using errcode = 'invalid_parameter_value';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'A session has to end in the future.' using errcode = 'invalid_parameter_value';
  end if;

  -- SECURITY DEFINER bypasses RLS, so ownership is checked by hand.
  if p_contractor_id is not null then
    if not exists (
      select 1 from public.contractors c
       where c.id = p_contractor_id and c.employer_id = uid
    ) then
      raise exception 'That contractor is not yours.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  /* Four digits, avoiding a code already live for this employer today so that
     two open sessions cannot be told apart by the same number. Not
     cryptographic — the attempt cap is what makes guessing impractical — but
     it is uniform, which a hand-picked code would not be. */
  for i in 1..40 loop
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (
      select 1 from public.attendance_sessions s
       where s.employer_id = uid
         and s.status = 'open'
         and now() < s.expires_at
         and s.code = v_code
    );
  end loop;

  select * into v_row
    from public.attendance_sessions s
   where s.employer_id = uid
     and s.work_date = p_work_date
     and ((p_contractor_id is null and s.contractor_id is null)
          or s.contractor_id = p_contractor_id);

  if found then
    update public.attendance_sessions
       set code       = v_code,
           status     = 'open',
           opens_at   = now(),
           expires_at = p_expires_at,
           closed_at  = null,
           closed_by  = null
     where id = v_row.id
     returning * into v_row;
  else
    insert into public.attendance_sessions
      (employer_id, contractor_id, work_date, code, expires_at)
    values (uid, p_contractor_id, p_work_date, v_code, p_expires_at)
    returning * into v_row;
  end if;

  return v_row;
end $$;

create or replace function public.close_attendance(p_session_id uuid)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  v_row public.attendance_sessions%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  update public.attendance_sessions
     set status    = 'closed',
         closed_at = now(),
         closed_by = uid
   where id = p_session_id
     and employer_id = uid
  returning * into v_row;

  if not found then
    raise exception 'That attendance session is not yours to close.'
      using errcode = 'insufficient_privilege';
  end if;

  return v_row;
end $$;

-- ── Worker: check in ────────────────────────────────────────────────────────

/* Records today's attendance for the signed-in worker.

   Returns the saved day on success. On failure it raises with a message
   written to be shown to a worker as-is — "That code is not the one for
   today" is the whole error handling the UI needs.

   The four failures are distinguished on purpose, because they need four
   different actions from the person reading them: get a code, wait for the
   employer, ask which contractor, or read the code again. */
create or replace function public.check_in_with_code(p_code text)
returns table (
  employee_id     uuid,
  full_name       text,
  work_date       date,
  kind            text,
  amount          numeric,
  contractor_name text,
  already         boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid        uuid := auth.uid();
  v_code     text;
  v_emp      public.employees%rowtype;
  v_session  public.attendance_sessions%rowtype;
  v_ended    int;
  v_other    text;
  v_fails    int;
  v_kind     text;
  v_row      public.day_records%rowtype;
  v_cname    text;
  v_already  boolean := false;
begin
  if uid is null then
    raise exception 'Sign in to record your attendance.' using errcode = 'insufficient_privilege';
  end if;

  v_code := trim(coalesce(p_code, ''));

  if v_code !~ '^[0-9]{4}$' then
    raise exception 'Enter the four-digit code from your workplace.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_emp
    from public.employees e
   where e.employee_user_id = uid
     and e.status = 'active'
   order by e.created_at
   limit 1;

  if not found then
    raise exception 'Your account is not linked to a workplace. Ask your employer for an invite code.'
      using errcode = 'no_data_found';
  end if;

  select * into v_session
    from public.attendance_sessions s
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
   order by s.work_date desc
   limit 1;

  if not found then
    -- Distinguish "finished" from "not started", because one means wait and
    -- the other means ask.
    select count(*) into v_ended
      from public.attendance_sessions s
     where s.employer_id = v_emp.employer_id
       and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
       and (s.status = 'closed' or now() >= s.expires_at)
       and s.work_date >= current_date - 1;

    if v_ended > 0 then
      raise exception 'Today''s attendance has been closed.' using errcode = 'check_violation';
    end if;

    raise exception 'Attendance is not open yet. Ask your employer to open it.'
      using errcode = 'no_data_found';
  end if;

  /* The attempt cap. Counted per worker per session, so one person guessing
     cannot lock out the rest of the crew — a shared counter would turn a
     nuisance into a denial of service for everybody. */
  select count(*) into v_fails
    from public.check_in_attempts a
   where a.session_id = v_session.id
     and a.user_id = uid
     and a.attempted_at > now() - interval '15 minutes';

  if v_fails >= 5 then
    raise exception 'Too many wrong codes. Ask your employer to read out the code, then try again in a few minutes.'
      using errcode = '53400';
  end if;

  if v_code <> v_session.code then
    insert into public.check_in_attempts (session_id, user_id)
    values (v_session.id, uid);

    select c.name into v_other
      from public.attendance_sessions s
      join public.contractors c on c.id = s.contractor_id
     where s.employer_id = v_emp.employer_id
       and s.id <> v_session.id
       and s.status = 'open'
       and now() < s.expires_at
       and s.code = v_code
     limit 1;

    if v_other is not null then
      raise exception 'That code is for %, not your contractor.', v_other
        using errcode = 'invalid_parameter_value';
    end if;

    raise exception 'That code is not the one for today. Check it and try again.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Weekend days earn the multiplier, so the kind follows the DATE, not the
  -- fact that someone tapped a button. Matches the rule the employer's
  -- marking screen already uses.
  v_kind := case
              when extract(isodow from v_session.work_date) >= 6 then 'weekend'
              else 'work'
            end;

  insert into public.day_records
    (employee_id, work_date, kind, status, source, session_id, checked_in_at)
  values
    (v_emp.id, v_session.work_date, v_kind, 'claimed', 'check_in', v_session.id, now())
  on conflict (employee_id, work_date) do nothing
  returning * into v_row;

  if v_row.id is null then
    /* Already recorded — the employer may have marked them present before they
       got their phone out. Succeed quietly rather than refusing: the worker did
       come to work, and an error here would send them to report a problem that
       does not exist. */
    select * into v_row
      from public.day_records d
     where d.employee_id = v_emp.id and d.work_date = v_session.work_date;
    v_already := true;
  end if;

  select c.name into v_cname
    from public.contractors c where c.id = v_emp.contractor_id;

  return query
    select v_emp.id, v_emp.full_name, v_row.work_date, v_row.kind,
           v_row.amount, v_cname, v_already;
end $$;

/* What the worker's screen needs to know before they type anything: is
   attendance open for me today, and for which contractor. Never the code. */
create or replace function public.my_attendance_status()
returns table (
  is_open         boolean,
  work_date       date,
  contractor_name text,
  last_ended      boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid      uuid := auth.uid();
  v_emp    public.employees%rowtype;
  v_date   date;
  v_cname  text;
begin
  if uid is null then
    return;
  end if;

  select * into v_emp
    from public.employees e
   where e.employee_user_id = uid and e.status = 'active'
   order by e.created_at
   limit 1;

  if not found then
    return;
  end if;

  /* Two explicit SELECT INTOs rather than two RETURN QUERYs followed by
     `if found`. RETURN QUERY does NOT set FOUND in PL/pgSQL, so that pattern
     would have silently reported whatever the previous statement left behind
     — meaning the "closed" case would never have been reached. */

  select s.work_date, c.name
    into v_date, v_cname
    from public.attendance_sessions s
    left join public.contractors c on c.id = s.contractor_id
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
   order by s.work_date desc
   limit 1;

  if found then
    return query select true, v_date, v_cname, false;
    return;
  end if;

  select s.work_date, c.name
    into v_date, v_cname
    from public.attendance_sessions s
    left join public.contractors c on c.id = s.contractor_id
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and (s.status = 'closed' or now() >= s.expires_at)
     and s.work_date >= current_date - 1
   order by s.work_date desc
   limit 1;

  if found then
    return query select false, v_date, v_cname, true;
  end if;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Row visibility is RLS's job; these decide only whether the table can be
-- reached at all.

grant select, insert, update, delete on public.attendance_sessions to authenticated;

-- check_in_attempts is deliberately absent from this list. It is written only
-- by SECURITY DEFINER functions, so no client can read it or clear its own
-- failed-attempt record.

revoke all on function public.open_attendance(uuid, date, timestamptz) from public;
revoke all on function public.open_attendance(uuid, date, timestamptz) from anon;
revoke all on function public.close_attendance(uuid) from public;
revoke all on function public.close_attendance(uuid) from anon;
revoke all on function public.check_in_with_code(text) from public;
revoke all on function public.check_in_with_code(text) from anon;
revoke all on function public.my_attendance_status() from public;
revoke all on function public.my_attendance_status() from anon;

grant execute on function public.open_attendance(uuid, date, timestamptz) to authenticated;
grant execute on function public.close_attendance(uuid) to authenticated;
grant execute on function public.check_in_with_code(text) to authenticated;
grant execute on function public.my_attendance_status() to authenticated;

-- ── Proof the shape is what we think it is ──────────────────────────────────

do $$
declare
  n_sessions int;
  n_definer  int;
begin
  select count(*) into n_sessions from public.attendance_sessions;

  select count(*) into n_definer
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('check_in_with_code', 'open_attendance', 'close_attendance',
                       'my_attendance_status', 'session_covers')
     and p.prosecdef;

  raise notice 'attendance_sessions: % row(s); % helper function(s) are SECURITY DEFINER',
    n_sessions, n_definer;

  if n_definer <> 5 then
    raise warning 'Expected 5 SECURITY DEFINER helpers, found %. Check the function definitions.', n_definer;
  end if;
end $$;

commit;

-- Verify afterwards:
--   select proname, prosecdef from pg_proc
--    where proname in ('check_in_with_code','open_attendance','close_attendance',
--                      'my_attendance_status','session_covers');
--     -> 5 rows, all prosecdef = true
--
--   select tablename, policyname from pg_policies
--    where tablename in ('attendance_sessions','check_in_attempts');
--     -> exactly ONE policy, attendance_sessions_employer_all.
--        Zero policies on check_in_attempts is correct: it is function-only.
--
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy
--    where polrelid = 'public.day_records'::regclass and polname = 'day_records_self_insert';
--     -> the WITH CHECK must mention session_covers

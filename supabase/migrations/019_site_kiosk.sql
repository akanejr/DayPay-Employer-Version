-- ============================================================================
-- 019 — THE SITE ATTENDANCE KIOSK
-- ============================================================================
-- WHAT THIS ADDS
--
-- A worker with no smartphone, or no network today, walks up to a computer at
-- the worksite, picks their contractor, picks their name, types the PIN their
-- employer gave them, types the code on the wall, and is checked in. No DayPay
-- account, no sign-in, no smartphone. The same day_records row is written
-- either way, so their pay is identical to a colleague who checked in on their
-- phone.
--
-- Three things, and they are small on purpose:
--
--   1. attendance_devices — the machine at the site, linked to one employer.
--   2. day_records.attendance_method — 'mobile' or 'kiosk' (or NULL, for a day
--      the employer marked by hand). For audit only; see the note below.
--   3. three functions: claim a device, read the roster, record an attendance.
--
-- THE METHOD COLUMN CANNOT AFFECT PAY, AND THAT IS STRUCTURAL
--
-- day_records has a trigger that computes rate x multiplier from the day's
-- kind. It reads employee_rate_periods and nothing else. It has never heard of
-- attendance_method, and this file does not teach it. So a kiosk day and a
-- mobile day of the same kind are the same money BY CONSTRUCTION rather than by
-- promise. The harness measures it anyway, because "by construction" is a
-- claim, and claims get measured.
--
-- WHERE THE METHOD COMES FROM
--
--   'mobile'  check_in_with_code() — the worker signed in on their own phone
--   'kiosk'   kiosk_check_in()     — the site machine
--   NULL      the employer marked the day, or a correction was approved
--
-- NULL is not a missing value. "Nobody's device recorded this" is a fact, and
-- it is the fact for every day that existed before today. The three rows of the
-- backfill below are the ones where we KNOW a phone did it, because source is
-- 'check_in'; everything else stays NULL because we would be guessing.
--
-- WHY A DEVICE HAS AN ACCOUNT
--
-- The alternative was a long secret in a URL, and it is worse: a bearer secret
-- on a machine anyone can walk up to cannot be rotated without changing the
-- link, cannot be signed out of, and is one screenshot away from being
-- everybody's. A device is an ordinary Supabase account that has been LINKED to
-- one employer by a code the employer reads out. It can be revoked in one tap,
-- and revocation is immediate because every function checks the link on every
-- call rather than trusting a token minted earlier.
--
-- The device account is not an employer and not an employee. It cannot open the
-- employer dashboard (no employers row), cannot see anybody's pay (kiosk_roster
-- returns no money), and cannot record attendance for any employer except the
-- one that linked it.
--
-- THE VALIDATION CHAIN, IN THE ORDER THE BRIEF GIVES IT (§10)
--
--   1. the worker exists          5. the PIN is right
--   2. and is active              6. the site code is live
--   3. and belongs to this employer  7. the attendance window is open
--   4. and to the chosen contractor  8. they have not already been recorded
--
-- The order is not decoration. Employee and contractor are checked BEFORE the
-- PIN, so a caller cannot use this function as a PIN oracle against workers
-- belonging to somebody else. All eight must pass, and the failure messages say
-- what to do without saying anything about anybody else.
--
-- Safe to re-run. Adding a table and a column, and replacing functions,
-- destroys no data. The backfill only fills rows that are NULL and were
-- provably created by a phone.
-- ============================================================================


begin;

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.employees') is null
     or to_regclass('public.day_records') is null
     or to_regclass('public.attendance_sessions') is null then
    raise exception 'Run migrations 001 and 008 first: employees, day_records or attendance_sessions is missing.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'check_in_with_code'
  ) then
    raise exception 'Run migration 011 first: check_in_with_code is missing.';
  end if;

  -- The kiosk is useless without the PIN it exists to verify.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'employees' and column_name = 'pin_hash'
  ) then
    raise exception 'Run migration 018 first: the personal attendance PIN is not installed.';
  end if;
end $$;


-- ── 1. The machine at the site ──────────────────────────────────────────────

create table if not exists public.attendance_devices (
  id             uuid primary key default gen_random_uuid(),

  -- Exactly one employer. A device linked to two worksites would be a device
  -- whose roster is the union of both, which is precisely the leak this table
  -- exists to prevent.
  employer_id    uuid not null references auth.users(id) on delete cascade,

  -- What the employer calls it, so that revoking the right one is possible
  -- when there are two sites. Free text, chosen by them.
  label          text not null default 'Site kiosk',

  /* While the device is waiting to be linked, this holds the one-time code the
     employer reads out. It is EXACTLY the invite-code pattern from migration
     005, including being nulled the moment it is used — one code, one device,
     and the code stops working the instant it has done its job. */
  link_code      text unique,

  -- The account signed in on the machine. Null until a device claims the code.
  device_user_id uuid references auth.users(id) on delete set null,

  status         text not null default 'pending'
                   check (status in ('pending', 'active', 'revoked')),
  created_at     timestamptz not null default now(),
  linked_at      timestamptz,
  revoked_at     timestamptz,

  -- Something to show the employer: which machine, and when it last did
  -- anything. Updated by kiosk_roster(), so it is the last time somebody stood
  -- at it rather than the last time it was opened.
  last_seen_at   timestamptz
);

-- One account cannot be the device for two employers. Without this, relinking a
-- machine would silently leave it able to serve both rosters.
create unique index if not exists attendance_devices_one_per_account_idx
  on public.attendance_devices (device_user_id)
  where device_user_id is not null;

create index if not exists attendance_devices_employer_idx
  on public.attendance_devices (employer_id);

comment on table public.attendance_devices is
  'A machine at the worksite, linked to one employer by a one-time code. It records attendance on behalf of workers who have no phone or no network, and can be revoked in one tap.';

alter table public.attendance_devices enable row level security;

-- The employer manages their own devices: create one, name it, revoke it.
drop policy if exists devices_employer_all on public.attendance_devices;
create policy devices_employer_all on public.attendance_devices
  for all to authenticated
  using (employer_id = auth.uid())
  with check (employer_id = auth.uid());

/* The device may read its own row — that is how the kiosk knows it is linked,
   what to call itself, and whether it has been revoked. It may NOT write: a
   device that could set its own status could un-revoke itself. */
drop policy if exists devices_self_select on public.attendance_devices;
create policy devices_self_select on public.attendance_devices
  for select to authenticated
  using (device_user_id = auth.uid());

-- No DELETE policy for anyone. Revoking is a status change; the record of which
-- machine recorded which days outlives the machine.
grant select, insert, update on public.attendance_devices to authenticated;


-- ── 2. How the day was recorded ─────────────────────────────────────────────

alter table public.day_records
  add column if not exists attendance_method text
    check (attendance_method in ('mobile', 'kiosk'));

comment on column public.day_records.attendance_method is
  'How the row was created: mobile (the worker''s own phone), kiosk (the site machine), or NULL (the employer marked it, or a correction put it there). Audit only — no calculation reads this column.';

/* The rows where we KNOW a phone did it. `source = 'check_in'` is set by
   check_in_with_code and by nothing else, so this is a fact about existing data
   rather than a guess. Employer-marked days and corrections are deliberately
   left NULL: nobody''s device recorded them, and inventing 'mobile' for them
   would be the audit trail making something up. */
update public.day_records
   set attendance_method = 'mobile'
 where attendance_method is null
   and source = 'check_in';


-- ── 3a. The mobile route now says so ────────────────────────────────────────

/* IDENTICAL to migration 017's function except for one column in the INSERT.

   `create or replace` rather than the drop-and-create that 017 needed: the
   return type is unchanged, so replacing works, and the grants survive — which
   matters, because a drop would take check-in offline for everybody until they
   were restated. The refusal contract, the sentences, the named-constraint
   clause and the attempt cap are all untouched. If this file ever needs to
   change the SHAPE, it will have to drop and re-grant, and this comment is the
   place that will say so. */
create or replace function public.check_in_with_code(p_code text)
returns table (
  ok              boolean,
  message         text,
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
  v_primary  public.attendance_sessions%rowtype;
  v_session  public.attendance_sessions%rowtype;
  v_open     int;
  v_ended    int;
  v_fails    int;
  v_kind     text;
  v_row      public.day_records%rowtype;
  v_cname    text;
  v_already  boolean := false;
begin
  if uid is null then
    return query select false, 'Sign in to record your attendance.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
  end if;

  v_code := trim(coalesce(p_code, ''));

  if v_code !~ '^[0-9]{4}$' then
    return query select false, 'Enter the four-digit code from your workplace.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
  end if;

  select * into v_emp
    from public.employees e
   where e.employee_user_id = uid
     and e.status = 'active'
   order by e.created_at, e.id
   limit 1;

  if not found then
    return query select false, 'Your account is not linked to a workplace. Ask your employer for an invite code.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
  end if;

  select count(*) into v_open
    from public.attendance_sessions s
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at;

  if v_open = 0 then
    select count(*) into v_ended
      from public.attendance_sessions s
     where s.employer_id = v_emp.employer_id
       and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
       and (s.status = 'closed' or now() >= s.expires_at)
       and s.work_date >= current_date - 1;

    if v_ended > 0 then
      return query select false, 'Today''s attendance has been closed.'::text,
                          null::uuid, null::text, null::date, null::text,
                          null::numeric, null::text, false;
      return;
    end if;

    return query select false, 'Attendance is not open yet. Ask your employer to open it.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
  end if;

  select * into v_primary
    from public.attendance_sessions s
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
   order by (s.contractor_id is null), s.work_date desc, s.id
   limit 1;

  select count(*) into v_fails
    from public.check_in_attempts a
   where a.session_id = v_primary.id
     and a.user_id = uid
     and a.attempted_at > now() - interval '15 minutes';

  if v_fails >= 5 then
    return query select false, 'Too many wrong codes. Try again in a few minutes.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
  end if;

  select * into v_session
    from public.attendance_sessions s
   where s.employer_id = v_emp.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
     and s.code = v_code
   order by (s.contractor_id is null), s.work_date desc, s.id
   limit 1;

  if not found then
    insert into public.check_in_attempts (session_id, user_id)
    values (v_primary.id, uid);

    return query select false, 'Code not correct, visit the site.'::text,
                        null::uuid, null::text, null::date, null::text,
                        null::numeric, null::text, false;
    return;
  end if;

  v_kind := case
              when extract(isodow from v_session.work_date) >= 6 then 'weekend'
              else 'work'
            end;

  insert into public.day_records
    (employee_id, work_date, kind, status, source, session_id, checked_in_at,
     attendance_method)
  values
    (v_emp.id, v_session.work_date, v_kind, 'claimed', 'check_in', v_session.id,
     now(), 'mobile')
  on conflict on constraint day_records_employee_id_work_date_key do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
      from public.day_records d
     where d.employee_id = v_emp.id and d.work_date = v_session.work_date;
    v_already := true;
  end if;

  select c.name into v_cname
    from public.contractors c where c.id = v_emp.contractor_id;

  return query
    select true, null::text, v_emp.id, v_emp.full_name, v_row.work_date,
           v_row.kind, v_row.amount, v_cname, v_already;
end $$;


-- ── 3b. Linking the machine ─────────────────────────────────────────────────

/* The device signs in with its own account and enters the code the employer
   read out. From that moment the machine is that employer's kiosk, and the code
   is gone.

   SECURITY DEFINER because linking writes device_user_id on a row the caller
   cannot update (the employer's policy scopes them to their own rows, and this
   account is not the employer). */
create or replace function public.claim_attendance_device(p_code text)
returns table (device_id uuid, label text, business_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid    uuid := auth.uid();
  v_code text;
  v_dev  public.attendance_devices%rowtype;
begin
  if uid is null then
    raise exception 'Sign in on this device first.' using errcode = 'insufficient_privilege';
  end if;

  v_code := upper(trim(coalesce(p_code, '')));

  if v_code = '' then
    raise exception 'Enter the code from your employer.';
  end if;

  /* Only a PENDING row can be claimed. A revoked device must never be
     re-linkable with an old code, and an active one must not be stolen by
     whoever is standing at the machine. */
  select * into v_dev
    from public.attendance_devices d
   where d.link_code = v_code
     and d.status = 'pending'
     for update;

  if not found then
    raise exception 'That code is not recognised. Ask your employer for a new one.';
  end if;

  /* One account, one device. Re-linking a machine that is already linked
     elsewhere is almost always a mistake, and silently moving it would leave a
     kiosk at the old site still able to record for the old employer. */
  if exists (
    select 1 from public.attendance_devices d
     where d.device_user_id = uid and d.status = 'active'
  ) then
    raise exception 'This device is already linked to an employer. Ask them to revoke it first.';
  end if;

  update public.attendance_devices d
     set device_user_id = uid,
         link_code      = null,
         status         = 'active',
         linked_at      = now(),
         last_seen_at   = now()
   where d.id = v_dev.id;

  return query
    select v_dev.id, v_dev.label,
           (select e.business_name from public.employers e where e.user_id = v_dev.employer_id);
end $$;

revoke all on function public.claim_attendance_device(text) from public;
revoke all on function public.claim_attendance_device(text) from anon;
grant execute on function public.claim_attendance_device(text) to authenticated;


-- ── 3c. The roster the kiosk shows ──────────────────────────────────────────

/* Contractors and people, and NOTHING ELSE.

   No rates, no amounts, no days, no pay — not because the kiosk would draw
   them, but because a function that returns them is a function that can be
   called from a browser console on a machine standing in a yard. The shape of
   the return is the security boundary: there is nothing here worth stealing.

   `has_pin` is included. It is not sensitive — the person standing there either
   has one or has to go and ask their supervisor — and without it the kiosk
   would invite people with no PIN to fail eight times before giving up.

   One call, not three. A site with bad connectivity should not need a round
   trip per step. */
create or replace function public.kiosk_roster()
returns table (
  business_name text,
  device_label  text,
  people        jsonb,
  contractors   jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_dev public.attendance_devices%rowtype;
begin
  select * into v_dev
    from public.attendance_devices d
   where d.device_user_id = uid
     and d.status = 'active';

  if not found then
    raise exception 'This device is not linked to DayPay, or has been signed out. Ask your employer for a new code.'
      using errcode = 'insufficient_privilege';
  end if;

  /* last_seen_at is the last time somebody STOOD HERE, not the last time the
     page loaded — kiosk_roster is the call the page makes after a check-in and
     when it comes back to the idle screen. It is what the employer's device
     list shows, so it had better mean the useful thing. */
  update public.attendance_devices d
     set last_seen_at = now()
   where d.id = v_dev.id;

  return query
  select
    (select e.business_name from public.employers e where e.user_id = v_dev.employer_id),
    v_dev.label,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',            emp.id,
               'name',          emp.full_name,
               'job_title',     emp.job_title,
               'contractor_id', emp.contractor_id,
               'has_pin',       emp.pin_hash is not null
             ) order by emp.full_name)
        from public.employees emp
       where emp.employer_id = v_dev.employer_id
         and emp.status = 'active'
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
        from public.contractors c
       where c.employer_id = v_dev.employer_id
         and c.status = 'active'
    ), '[]'::jsonb);
end $$;

revoke all on function public.kiosk_roster() from public;
revoke all on function public.kiosk_roster() from anon;
grant execute on function public.kiosk_roster() to authenticated;


-- ── 3d. The check-in itself ─────────────────────────────────────────────────

/* All eight checks, in the brief's order, and a day record only if every one of
   them passes.

     Employee identity + contractor assignment + personal PIN + live site code
     = a valid kiosk attendance.

   The PIN is verified through verify_attendance_pin(), which is NOT executable
   by anybody but the owner — so this function is the only door to it, and it
   opens only after the caller has been established as a linked device AND the
   named worker has been established as ours. That ordering is the difference
   between a kiosk and a PIN oracle.

   A refusal is RETURNED, like every other refusal in this system since 017, so
   that the row recording a wrong attempt is not rolled back by the failure it
   records. verify_attendance_pin writes its own counter inside this
   transaction; if this function raised instead of returning, that write would
   vanish and the PIN lockout would be as dead as the code lockout used to be. */
create or replace function public.kiosk_check_in(
  p_employee_id   uuid,
  p_contractor_id uuid,
  p_pin           text,
  p_code          text
) returns table (
  ok              boolean,
  message         text,
  full_name       text,
  work_date       date,
  kind            text,
  contractor_name text,
  method          text,
  already         boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  v_dev     public.attendance_devices%rowtype;
  v_emp     public.employees%rowtype;
  v_session public.attendance_sessions%rowtype;
  v_open    int;
  v_ended   int;
  v_pin     text;
  v_code    text;
  v_kind    text;
  v_row     public.day_records%rowtype;
  v_cname   text;
  v_already boolean := false;
begin
  /* ── 0. Whose machine is this? ─────────────────────────────────────────────
     Not one of the eight, but the one that makes the other eight mean
     anything: without it this function is a public PIN-and-code guessing
     service attached to every worker on DayPay. */
  select * into v_dev
    from public.attendance_devices d
   where d.device_user_id = uid
     and d.status = 'active';

  if not found then
    return query select false, 'This device is not linked to DayPay, or has been signed out. Ask your employer for a new code.'::text,
                        null::text, null::date, null::text, null::text, null::text, false;
    return;
  end if;

  v_code := trim(coalesce(p_code, ''));

  /* ── 1–4. The worker, and whether they are really on this crew ─────────────
     One query, because all four are the same question asked four ways, and
     every one of them must hold before the PIN is even looked at. */
  select * into v_emp
    from public.employees e
   where e.id = p_employee_id
     and e.employer_id = v_dev.employer_id     -- 3. belongs to this employer
     and e.status = 'active'                   -- 2. and is active
   limit 1;

  if not found then
    /* One message for "no such worker", "not ours", and "archived". Which of
       the three it was is not the kiosk's information to give, and the person
       standing there needs the same next step in all three cases. */
    return query select false, 'That worker is not on this site''s active roster. Ask your employer.'::text,
                        null::text, null::date, null::text, null::text, null::text, false;
    return;
  end if;

  /* ── 4. The contractor ─────────────────────────────────────────────────────
     The kiosk passes the contractor the worker CHOSE on screen; the truth is
     employees.contractor_id, which only the employer can change. So this single
     comparison is what stops "pick a different contractor so I can check in":
     the choice has to agree with the assignment. A NULL on both sides is a
     match — an unassigned worker at a site-wide session is a legitimate case,
     not a loophole. */
  if v_emp.contractor_id is distinct from p_contractor_id then
    return query select false, 'You are not listed under that contractor. Check with your supervisor.'::text,
                        null::text, null::date, null::text, null::text, null::text, false;
    return;
  end if;

  /* ── 5. The PIN ────────────────────────────────────────────────────────────
     Before the site code, per the brief's order — and the safer way round:
     the code is shared by everyone on the crew, so guessing it must never be
     enough to learn anything about a PIN. */
  v_pin := public.verify_attendance_pin(v_emp.id, p_pin);

  if v_pin = 'locked' then
    return query select false, 'Too many wrong PINs. Try again in a few minutes.'::text,
                        null::text, null::date, null::text, null::text, null::text, false;
    return;
  end if;

  if v_pin = 'not_set' then
    return query select false, 'No PIN has been set for you yet. Ask your employer for one.'::text,
                        null::text, null::date, null::text, null::text, null::text, false;
    return;
  end if;

  if v_pin <> 'ok' then
    return query select false, 'That PIN is not correct.'::text,
                        null::text, null::date, null::text, null::text, null::text, false;
    return;
  end if;

  /* ── 7. Is attendance open at all? ─────────────────────────────────────────
     Asked before the code, so that "the code is wrong" and "there is nothing
     open" are never confused — one sends you to your supervisor, the other to
     the office. */
  select count(*) into v_open
    from public.attendance_sessions s
   where s.employer_id = v_dev.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at;

  if v_open = 0 then
    select count(*) into v_ended
      from public.attendance_sessions s
     where s.employer_id = v_dev.employer_id
       and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
       and (s.status = 'closed' or now() >= s.expires_at)
       and s.work_date >= current_date - 1;

    if v_ended > 0 then
      return query select false, 'Attendance is closed for today.'::text,
                          null::text, null::date, null::text, null::text, null::text, false;
      return;
    end if;

    return query select false, 'Attendance is not open yet. Ask your employer to open it.'::text,
                        null::text, null::date, null::text, null::text, null::text, false;
    return;
  end if;

  /* ── 6. The site code ──────────────────────────────────────────────────────
     Matched against a session that is open NOW and covers this worker, using
     the same deterministic order as the mobile path, so the two routes cannot
     disagree about which session a code belongs to. */
  select * into v_session
    from public.attendance_sessions s
   where s.employer_id = v_dev.employer_id
     and (s.contractor_id is null or s.contractor_id = v_emp.contractor_id)
     and s.status = 'open'
     and now() < s.expires_at
     and s.code = v_code
   order by (s.contractor_id is null), s.work_date desc, s.id
   limit 1;

  if not found then
    /* One sentence for a code from yesterday, a code belonging to another crew
       and a code that never existed. Distinguishing them would turn the kiosk
       into a way of asking which codes are real, which is exactly what a
       four-digit code cannot afford. Nothing is recorded against the worker's
       PIN for this: a shared code mistyped by the whole queue must not lock
       anybody out. */
    return query select false, 'That site code is not valid now. Ask for today''s code.'::text,
                        null::text, null::date, null::text, null::text, null::text, false;
    return;
  end if;

  /* ── 8. Already recorded? ──────────────────────────────────────────────────
     The unique index on (employee_id, work_date) is the real guard — this
     INSERT cannot create a second row for the same day even under a race. The
     check below exists to say so in words instead of reporting a conflict. */
  v_kind := case
              when extract(isodow from v_session.work_date) >= 6 then 'weekend'
              else 'work'
            end;

  insert into public.day_records
    (employee_id, work_date, kind, status, source, session_id, checked_in_at,
     attendance_method)
  values
    (v_emp.id, v_session.work_date, v_kind, 'claimed', 'check_in', v_session.id,
     now(), 'kiosk')
  on conflict on constraint day_records_employee_id_work_date_key do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
      from public.day_records d
     where d.employee_id = v_emp.id and d.work_date = v_session.work_date;
    v_already := true;
  end if;

  select c.name into v_cname
    from public.contractors c where c.id = v_emp.contractor_id;

  /* `method` reports what is actually ON the row, which for an existing day may
     be 'mobile' — the person who already checked in on their phone, now
     standing at the kiosk. The screen says "already recorded" either way, and
     the employer's audit view keeps the truth about how it arrived. */
  return query
    select true, null::text, v_emp.full_name, v_row.work_date, v_row.kind,
           v_cname, coalesce(v_row.attendance_method, 'employer'), v_already;
end $$;

revoke all on function public.kiosk_check_in(uuid, uuid, text, text) from public;
revoke all on function public.kiosk_check_in(uuid, uuid, text, text) from anon;
grant execute on function public.kiosk_check_in(uuid, uuid, text, text) to authenticated;


-- ── Proof ───────────────────────────────────────────────────────────────────
do $$
declare
  i int;
  a boolean;
begin
  -- (1) The table, the column, and the three functions.
  if to_regclass('public.attendance_devices') is null then
    raise exception 'attendance_devices was not created. Tell me.';
  end if;

  select count(*) into i
    from information_schema.columns
   where table_schema = 'public' and table_name = 'day_records'
     and column_name = 'attendance_method';
  if i <> 1 then
    raise exception 'day_records.attendance_method is missing. Tell me.';
  end if;

  -- (2) The method column is a closed set, and NULL is allowed on purpose.
  if not exists (
    select 1 from pg_constraint
     where conname like '%attendance_method%'
       and pg_get_constraintdef(oid) like '%mobile%'
       and pg_get_constraintdef(oid) like '%kiosk%'
  ) then
    raise exception 'attendance_method has no check constraint limiting it to mobile/kiosk. Tell me.';
  end if;

  -- (3) The mobile route now records its method.
  if position('''mobile''' in pg_get_functiondef(
       (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'check_in_with_code'))) = 0 then
    raise exception 'check_in_with_code does not record attendance_method = mobile. Tell me.';
  end if;

  -- (4) 017's refund contract survived the replacement. If either half of this
  --     is gone, the code lockout is dead again.
  if position('''Code not correct, visit the site.''' in pg_get_functiondef(
       (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'check_in_with_code'))) = 0 then
    raise exception 'The wrong-code sentence went missing in the rewrite. Tell me.';
  end if;

  if position('raise exception' in pg_get_functiondef(
       (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'check_in_with_code'))) > 0 then
    raise exception 'check_in_with_code raises again, which erases its own attempt record. Tell me.';
  end if;

  -- (5) The kiosk records 'kiosk' and nothing else.
  if position('''kiosk''' in pg_get_functiondef(
       (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'kiosk_check_in'))) = 0 then
    raise exception 'kiosk_check_in does not record attendance_method = kiosk. Tell me.';
  end if;

  -- (6) A kiosk function must never raise for a refusal. Same reasoning as 017.
  if position('raise exception' in pg_get_functiondef(
       (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'kiosk_check_in'))) > 0 then
    raise exception 'kiosk_check_in raises somewhere. A refusal that raises rolls back the attempt it just wrote. Tell me.';
  end if;

  -- (7) Nobody anonymous can touch the kiosk.
  select has_function_privilege('anon', 'public.kiosk_check_in(uuid, uuid, text, text)', 'execute') into a;
  if a then raise exception 'anon can call kiosk_check_in. Tell me.'; end if;

  select has_function_privilege('anon', 'public.kiosk_roster()', 'execute') into a;
  if a then raise exception 'anon can call kiosk_roster. Tell me.'; end if;

  select has_function_privilege('anon', 'public.claim_attendance_device(text)', 'execute') into a;
  if a then raise exception 'anon can claim a device. Tell me.'; end if;

  -- (8) A linked device must be able to do its job.
  if not has_function_privilege('authenticated', 'public.kiosk_check_in(uuid, uuid, text, text)', 'execute') then
    raise exception 'authenticated cannot call kiosk_check_in, so no kiosk could record anything. Tell me.';
  end if;

  if not has_function_privilege('authenticated', 'public.kiosk_roster()', 'execute') then
    raise exception 'authenticated cannot call kiosk_roster. Tell me.';
  end if;

  -- (9) The PIN verifier stays owner-only — the kiosk reaches it through
  --     kiosk_check_in, which checks the device first. If this ever becomes
  --     callable again, every worker's PIN is guessable by every other worker.
  select has_function_privilege('authenticated', 'public.verify_attendance_pin(uuid, text)', 'execute') into a;
  if a then raise exception 'verify_attendance_pin became callable by authenticated: that is a PIN oracle. Tell me.'; end if;

  -- (10) RLS is on the new table.
  if not (select relrowsecurity from pg_class where relname = 'attendance_devices') then
    raise exception 'attendance_devices has RLS disabled. Tell me.';
  end if;

  raise notice '019 applied: a site device can be linked, revoked, and used to record attendance with a PIN and the live site code.';
end $$;

commit;


-- ── Verify afterwards ───────────────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'day_records'
--      and column_name = 'attendance_method';
--     -> 1 row
--
--   select attendance_method, count(*) from public.day_records
--    group by attendance_method order by 1 nulls last;
--     -> mobile | however many check-ins exist; NULL | employer-marked days
--
--   select id, label, status, link_code is not null as awaiting_link
--     from public.attendance_devices order by created_at desc;
--     -> empty until the employer creates one

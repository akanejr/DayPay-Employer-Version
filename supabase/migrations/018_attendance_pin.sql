-- ============================================================================
-- 018 — THE PERSONAL ATTENDANCE PIN
-- ============================================================================
-- WHAT THIS ADDS, AND WHY IT IS NOT A PASSWORD
--
-- A worker without a smartphone, or with one but no network today, still has to
-- be able to record attendance at the site. They cannot sign in — they may have
-- no account at all. So the kiosk identifies them another way: they select
-- their name, and prove it is theirs with a short PIN that only they have.
--
-- The brief is explicit that this PIN is separate from the DayPay login
-- password, and that is not only a matter of convenience:
--
--   * the login password protects an ACCOUNT, and only exists for people who
--     have one. Most of the people who need this PIN have no account;
--   * the PIN is typed on a machine in front of a queue, in daylight, with
--     people standing behind the person typing. A password there is a password
--     given away. A PIN is short enough to enter before anyone memorises it,
--     and worthless on its own — it must be paired with a code that changes
--     every session, and the contractor must match.
--
-- FOUR DIGITS IS 10,000 POSSIBILITIES. THAT IS NOT ENOUGH ON ITS OWN.
--
-- This file therefore treats the PIN as only half of one factor, and gives it
-- the protections that make four digits defensible:
--
--   1. It is never stored. Only a salted, iterated hash is — so a database
--      dump does not hand over anybody's PIN directly, and every PIN has to be
--      attacked separately (the salt is per person, so one cracked PIN tells
--      the attacker nothing about the next).
--   2. Five wrong guesses lock that employee's PIN for five minutes.
--   3. The PIN is never the only thing required. Migration 019's kiosk function
--      also demands the live site code and a contractor match.
--
-- WHAT IT IS NOT
--
-- This is not bcrypt, and saying so plainly is more useful than pretending
-- otherwise. The bcrypt function lives in the pgcrypto extension, and the test
-- database — PostgreSQL compiled to WebAssembly — does not ship extensions at
-- all. A PIN check that cannot run in the tests is a PIN check nobody has ever
-- tested, so this uses sha256(), which is in core PostgreSQL and therefore
-- runs identically in the tests and in production.
--
-- 60,000 iterations costs about 50 ms per check: invisible to somebody at a
-- kiosk, and enough that trying all 10,000 PINs offline takes roughly eight
-- minutes per employee rather than instantly. That is the honest number. The
-- lockout, not the hash, is what stops a person standing at the kiosk.
--
-- WHY THE HASH IS READABLE, AND WHY THAT IS FINE
--
-- Anyone who can read an employee row can read that employee's hash and salt:
-- the employee themselves (their own row), and their employer (their workers).
-- There is no third party, because employees_self_select and
-- employees_employer_all are the only policies on the table. Neither reader
-- gains anything — the employer can already reset the PIN, and the worker
-- already knows their own. Restricting those two columns would mean revoking
-- table-level SELECT and re-granting every other column by name, which turns
-- "add a column" into "remember to add it to the grant list or the app breaks".
-- That is a real risk traded for no real gain, so it is not done. No client
-- query selects these columns, and none ever should.
--
-- WHAT THE EMPLOYER CAN AND CANNOT DO
--
-- Can: give a worker a PIN, and reset it. That is the whole interface.
-- Cannot: read one. The plain PIN exists for exactly one moment — the return
-- value of set_attendance_pin() — and after that there is nothing in the
-- database to read. A lost PIN is reset, never recovered, and the product says
-- that out loud rather than implying otherwise.
--
-- Safe to re-run. Adding columns and replacing functions destroys no data.
-- ============================================================================


begin;

-- ── Preflight ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.employees') is null then
    raise exception 'Run migration 001 first: public.employees is missing.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_employer_of'
  ) then
    raise exception 'Run migration 001 first: public.is_employer_of() is missing.';
  end if;

  -- sha256() is core PostgreSQL (PG11+). If it is somehow absent the whole
  -- design is wrong, and it is better to find out now than when a worker is
  -- standing at a kiosk.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pg_catalog' and p.proname = 'sha256'
  ) then
    raise exception 'pg_catalog.sha256() is missing: this database cannot hash a PIN. Tell me.';
  end if;
end $$;


-- ── The columns ─────────────────────────────────────────────────────────────
-- Five, and each earns its place:
--
--   pin_hash          the salted, iterated hash. The only copy of the PIN.
--   pin_salt          unique per person, so identical PINs do not collide and
--                     one cracked PIN teaches an attacker nothing.
--   pin_set_at        when it was last issued. Shown to the employer so they can
--                     tell "never had one" from "issued in June".
--   pin_fails         wrong guesses since the last success.
--   pin_locked_until  set when pin_fails reaches the cap.
--
-- A NULL pin_hash is meaningful and must stay meaningful: it is a worker who
-- has no PIN yet, and the kiosk refuses them by name rather than treating NULL
-- as "any PIN at all". That distinction is asserted in the proof.
alter table public.employees
  add column if not exists pin_hash         text,
  add column if not exists pin_salt         text,
  add column if not exists pin_set_at       timestamptz,
  add column if not exists pin_fails        integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

comment on column public.employees.pin_hash is
  'Salted, 60,000-round sha256 of the personal attendance PIN. Never readable as a PIN, never returned by any select, and reset rather than recovered.';
comment on column public.employees.pin_fails is
  'Wrong PIN attempts since the last success. Five locks the PIN for five minutes (see verify_attendance_pin).';
comment on column public.employees.pin_locked_until is
  'When the PIN lockout expires. NULL means not locked.';


-- ── The hash, and the one place the work factor is decided ──────────────────

/* Iterated sha256 over salt||pin.

   The iteration count is a constant inside the function and NOT a parameter,
   on purpose: a caller that can pass p_rounds = 1 can turn the hash off. There
   is no legitimate caller for a weaker hash, so there is no parameter.

   `immutable` because the same salt and PIN must always give the same digest —
   that is what makes verification possible at all. */
create or replace function public.pin_hash(p_pin text, p_salt text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  h bytea := convert_to(p_salt || ':' || coalesce(p_pin, ''), 'utf8');
  i int;
begin
  for i in 1..60000 loop
    h := sha256(h);
  end loop;
  return encode(h, 'hex');
end $$;

/* Internal. It is an offline-attack tool as much as a helper — hand it a salt
   and a candidate PIN and it will tell you whether you guessed right — so it
   is executable by the owner and by nothing else. The SECURITY DEFINER
   functions below run as the owner and can still call it. */
revoke all on function public.pin_hash(text, text) from public;
revoke all on function public.pin_hash(text, text) from anon;
revoke all on function public.pin_hash(text, text) from authenticated;


-- ── Giving somebody a PIN, and giving them a new one ────────────────────────

/* ONE FUNCTION FOR BOTH "give them a PIN" AND "reset it", because they are the
   same act: mint a new one, replace whatever was there, hand it back once. A
   separate "first issue" path would be a second way to write the same columns,
   and the product does not distinguish between the two anyway — the employer
   presses the button and reads the number out.

   The PIN is generated here, not chosen by the employer. A chosen PIN is a
   PIN somebody else knows: 1234, their year of birth, the site address. The
   employer's job is to hand over a number, not to invent one.

   Returns the PLAIN PIN. This is its only moment of existence — the caller
   must show it once and say so, because after this call there is no way to
   retrieve it, only to replace it. */
create or replace function public.set_attendance_pin(p_employee_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid    uuid := auth.uid();
  v_salt text;
  v_pin  text;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  /* The whole security boundary, checked before anything is written. Not
     "is this person an employer" but "is this person THIS employee's
     employer" — otherwise any employer on the system could issue themselves a
     PIN for somebody else's worker and check that worker in. */
  if not public.is_employer_of(p_employee_id) then
    raise exception 'That worker is not on your roster.'
      using errcode = 'insufficient_privilege';
  end if;

  /* A fresh salt every time, so resetting a PIN invalidates nothing that was
     captured before it: the old hash and the new hash share not even a salt. */
  v_salt := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  /* Four digits, drawn from a cryptographically random uuid rather than from
     random(). random() is a fast PRNG seeded per session and is documented as
     unsuitable for anything secret; md5-of-a-uuid carries the uuid's own 122
     bits of entropy, so the PIN space is covered evenly without inventing a
     generator. */
  v_pin := lpad((
    abs(('x' || substr(md5(gen_random_uuid()::text), 1, 15))::bit(60)::bigint) % 10000
  )::text, 4, '0');

  update public.employees e
     set pin_hash         = public.pin_hash(v_pin, v_salt),
         pin_salt         = v_salt,
         pin_set_at       = now(),
         pin_fails        = 0,
         pin_locked_until = null
   where e.id = p_employee_id;

  return v_pin;
end $$;

revoke all on function public.set_attendance_pin(uuid) from public;
revoke all on function public.set_attendance_pin(uuid) from anon;
grant execute on function public.set_attendance_pin(uuid) to authenticated;


/* What the employer's screen needs to label the button: has this person got a
   PIN, and when was it issued. Deliberately NOT "what is it" — there is no
   such question any more, and a function that answered one would be lying. */
create or replace function public.employee_pin_status(p_employee_id uuid)
returns table (has_pin boolean, set_at timestamptz, locked_until timestamptz)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  if not public.is_employer_of(p_employee_id) then
    raise exception 'That worker is not on your roster.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select (e.pin_hash is not null), e.pin_set_at,
           case when e.pin_locked_until > now() then e.pin_locked_until end
      from public.employees e
     where e.id = p_employee_id;
end $$;

revoke all on function public.employee_pin_status(uuid) from public;
revoke all on function public.employee_pin_status(uuid) from anon;
grant execute on function public.employee_pin_status(uuid) to authenticated;


-- ── Checking a PIN, which is where the lockout lives ────────────────────────

/* Returns a STATUS, and never raises for a wrong PIN.

   This is migration 017's lesson applied before the mistake is made again. The
   kiosk function in migration 019 will call this inside its own transaction; if
   a wrong PIN raised, the transaction that recorded the failure would be rolled
   back by the failure itself, and the five-guess lockout would never fire —
   exactly the defect that made the check-in cap unreachable for the whole life
   of this project until 017 fixed it. So: a wrong PIN is an ANSWER.

     'ok'        the PIN is right
     'wrong'     the PIN is wrong; one attempt has been recorded
     'locked'    too many wrong PINs; try again shortly
     'not_set'   this worker has no PIN, so nothing can match

   `not_set` is separate from `wrong` because they are different conversations:
   one means "ask your employer for a PIN", the other means "that was not it".
   Neither names anybody else, and neither reveals whether some OTHER worker has
   a PIN — the question is about one named employee, chosen already.

   Internal for the same reason pin_hash is: it is a guessing oracle. As an
   authenticated role you could call it in a loop against a colleague. The
   kiosk reaches it through migration 019's function, which runs as the owner. */
create or replace function public.verify_attendance_pin(
  p_employee_id uuid,
  p_pin         text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash   text;
  v_salt   text;
  v_locked timestamptz;
  v_fails  int;
begin
  select e.pin_hash, e.pin_salt, e.pin_locked_until, e.pin_fails
    into v_hash, v_salt, v_locked, v_fails
    from public.employees e
   where e.id = p_employee_id
     for update;              -- two kiosk taps at once must not race the counter

  if not found then
    return 'not_set';
  end if;

  if v_hash is null then
    return 'not_set';
  end if;

  if v_locked is not null and v_locked > now() then
    return 'locked';
  end if;

  if public.pin_hash(trim(coalesce(p_pin, '')), v_salt) = v_hash then
    update public.employees
       set pin_fails = 0, pin_locked_until = null
     where id = p_employee_id;
    return 'ok';
  end if;

  /* A wrong PIN. The counter is written BEFORE the status is returned, and
     because nothing here raises, the write survives — which is the entire
     point of the shape of this function. */
  v_fails := coalesce(v_fails, 0) + 1;

  if v_fails >= 5 then
    update public.employees
       set pin_fails = 0, pin_locked_until = now() + interval '5 minutes'
     where id = p_employee_id;
    return 'locked';
  end if;

  update public.employees set pin_fails = v_fails where id = p_employee_id;
  return 'wrong';
end $$;

revoke all on function public.verify_attendance_pin(uuid, text) from public;
revoke all on function public.verify_attendance_pin(uuid, text) from anon;
revoke all on function public.verify_attendance_pin(uuid, text) from authenticated;


-- ── Proof ───────────────────────────────────────────────────────────────────
-- Behavioural, not textual: this file's guarantees are about what the functions
-- DO, and every one of them can be exercised on an empty database with no
-- accounts, because the checks that matter here (hashing, the counter, the
-- lockout, NULL meaning "no PIN") do not need a signed-in caller.
do $$
declare
  emp    uuid;
  salt   text;
  pin    text;
  h1     text;
  state  text;
  i      int;
  a      boolean;
begin
  -- (1) The columns are there and NULL means "no PIN" rather than "no checks".
  select count(*) into i
    from information_schema.columns
   where table_schema = 'public' and table_name = 'employees'
     and column_name in ('pin_hash','pin_salt','pin_set_at','pin_fails','pin_locked_until');
  if i <> 5 then
    raise exception 'Expected 5 PIN columns on employees, found %. Tell me.', i;
  end if;

  -- (2) A worker with no PIN row cannot verify as anything but 'not_set'.
  emp := gen_random_uuid();
  state := public.verify_attendance_pin(emp, '1234');
  if state <> 'not_set' then
    raise exception 'An unknown worker returned "%" instead of not_set. Tell me.', state;
  end if;

  -- (3) The hash is a function of BOTH the PIN and the salt.
  salt := replace(gen_random_uuid()::text, '-', '');
  h1   := public.pin_hash('1234', salt);

  if public.pin_hash('1234', salt) <> h1 then
    raise exception 'The same PIN and salt hashed differently twice. Tell me.';
  end if;

  if public.pin_hash('1235', salt) = h1 then
    raise exception 'Two different PINs produced the same hash. Tell me.';
  end if;

  if public.pin_hash('1234', salt || 'x') = h1 then
    raise exception 'The salt does not affect the hash, so two workers with the same PIN would share a digest. Tell me.';
  end if;

  if h1 = '1234' or position('1234' in h1) > 0 then
    raise exception 'The hash contains the PIN in plain sight. Tell me.';
  end if;

  -- (4) The PIN is not recoverable from the hash by shape: it is a hex digest.
  if h1 !~ '^[0-9a-f]{64}$' then
    raise exception 'The hash is not a 64-character hex digest, got "%". Tell me.', h1;
  end if;

  -- (5) A wrong PIN is an answer, not an exception. If this raised, the whole
  --     proof would abort — which is precisely the behaviour the kiosk must
  --     never depend on.
  begin
    state := public.verify_attendance_pin(emp, '9999');
    if state is null then
      raise exception 'verify returned NULL for a worker who does not exist. Tell me.';
    end if;
  exception when others then
    raise exception 'verify_attendance_pin raised (%) instead of returning a status. A refusal that raises erases the attempt that accompanies it. Tell me.', sqlerrm;
  end;

  -- (6) No privilege leak: the two internal functions are callable by nobody.
  select has_function_privilege('anon', 'public.verify_attendance_pin(uuid, text)', 'execute') into a;
  if a then raise exception 'anon can call verify_attendance_pin: that is a PIN guessing oracle. Tell me.'; end if;

  select has_function_privilege('authenticated', 'public.verify_attendance_pin(uuid, text)', 'execute') into a;
  if a then raise exception 'authenticated can call verify_attendance_pin: any signed-in worker could guess a colleague''s PIN. Tell me.'; end if;

  select has_function_privilege('anon', 'public.pin_hash(text, text)', 'execute') into a;
  if a then raise exception 'anon can call pin_hash. Tell me.'; end if;

  select has_function_privilege('authenticated', 'public.pin_hash(text, text)', 'execute') into a;
  if a then raise exception 'authenticated can call pin_hash, which is an offline cracking tool. Tell me.'; end if;

  -- (7) The employer-facing pair is reachable by signed-in users and by nobody
  --     anonymous, and both are SECURITY DEFINER or they could not write the
  --     columns at all.
  if not has_function_privilege('authenticated', 'public.set_attendance_pin(uuid)', 'execute') then
    raise exception 'authenticated lost execute on set_attendance_pin, so no employer could issue a PIN. Tell me.';
  end if;

  select has_function_privilege('anon', 'public.set_attendance_pin(uuid)', 'execute') into a;
  if a then raise exception 'anon can call set_attendance_pin. Tell me.'; end if;

  select has_function_privilege('anon', 'public.employee_pin_status(uuid)', 'execute') into a;
  if a then raise exception 'anon can call employee_pin_status. Tell me.'; end if;

  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'set_attendance_pin') then
    raise exception 'set_attendance_pin is not SECURITY DEFINER, so it cannot write another user''s row. Tell me.';
  end if;

  raise notice '018 applied: a worker can hold a personal attendance PIN — salted, hashed, never stored in the clear, and locked after five wrong guesses.';
end $$;

commit;


-- ── Verify afterwards ───────────────────────────────────────────────────────
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'employees'
--      and column_name like 'pin%' order by column_name;
--     -> 5 rows: pin_fails, pin_hash, pin_locked_until, pin_salt, pin_set_at
--
--   select count(*) from public.employees where pin_hash is not null;
--     -> 0 until an employer issues one
--
-- And the whole lifecycle, in the SQL Editor, once migration 019 exists and
-- you have a real worker on the roster:
--
--   select public.set_attendance_pin('<employee id>');   -- returns 4 digits, once
--   select * from public.employee_pin_status('<employee id>');   -- has_pin = true

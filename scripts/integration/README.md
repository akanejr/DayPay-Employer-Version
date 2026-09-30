# Cross-layer proofs

These are not unit tests. `tests/` runs the pure logic in microseconds and
should stay that way. What these add is the layer underneath it: a real
PostgreSQL — the same seventeen migrations the live project has — so that a
question like *"does the number on the invoice equal the number in the ledger"*
gets an answer from the database rather than from a fixture someone wrote by
hand.

They use [PGlite](https://github.com/electric-sql/pglite), which is PostgreSQL
compiled to WebAssembly — it is a devDependency, so `npm install` is all the
setup there is. (It was fetched with `--no-save` at first, which meant the next
`npm install` silently pruned it and the proofs stopped running. An artefact
that disappears is not evidence.) No Docker, no server, no connection string. The two
Supabase pieces the migrations assume — the `anon`/`authenticated` roles and
`auth.uid()` reading the JWT claims — are created by the runners themselves.

```bash
npm install     # @electric-sql/pglite and jsdom are devDependencies
npm run prove
```

`npm run prove` runs all four and exits non-zero if any of them fails. Each can
also be run alone:

| File | The question it answers |
| --- | --- |
| `migrations.mjs` | Does 001→017 apply to an empty database, and is what comes out the shape the app expects? |
| `e2e.mjs` | Does one day of work end up as the *same money* on every screen? |
| `harness.mjs` | Can an employee see another employee's wages? |
| `lockout-probe.mjs` | Does the five-attempt lockout actually lock anybody out? (It did not. 017 fixed it — see below.) |

## The one file to paste into Supabase

`supabase/harness/verify_installed.sql` is not part of `npm run prove` as a
question — it is the answer to one a human asks: *what is actually installed in
this project?* Paste it into the Supabase SQL Editor and it returns eleven rows,
each PASS or FAIL, covering 012, 016 and 017: whether a refusal has somewhere to
travel, whether the attempt is written before the refusal, whether the cap
exists, whether the tie-break is in place, whether corrections are installed and
whether anybody can delete them. It changes nothing and needs no fixture, no
signed-in user and no second account, so it is safe to run before a batch, after
one, or a year later on a project nobody remembers the history of.

It is tested anyway, by `migrations.mjs`, against a database the test has just
built: a report that throws on a valid database, or returns no rows at all,
answers "is it installed?" with something that looks like an answer, and that is
worse than having no report.

## Why they live in the repository

Phase 6 and Phase 7 both proved their work with scripts written into `/tmp`, and
that survived exactly as long as the sandbox did. The claims are permanent, so
the evidence has to be. `migrations.mjs` is the reconstruction of the one that
kept getting thrown away.

## What each one cost to learn

Recorded because these mistakes are easy to make twice.

**`e2e.mjs` — the test must not measure the test harness.** PGlite hands `date`
columns back as JavaScript `Date` objects; PostgREST hands back `'YYYY-MM-DD'`.
Without `new PGlite({ parsers: { 1082: (v) => v } })` every string comparison
fails and the dashboard looks like it can see nobody. The same run taught that a
fixture with a hardcoded day can collide with today (a rate change on the 15th
leaves only one rate in a month when today is the 30th), and that an RLS-blocked
`UPDATE` fails *silently* — zero rows, no error — so a permission check has to
read the row back afterwards and prove it did not move.

**`migrations.mjs` — assert the shape, never the wording.** Migration 010
asserted a literal string that was legitimately different and could never
install; nobody found out until Phase 7. The checks here ask the catalogue what
exists, not what a document says it should say. Two of them were wrong when
first written, in the same direction: *"the ledger has no DELETE policy"* is
false — a worker may withdraw a claim the employer has not confirmed, and that
policy is the product working correctly — and *"clients cannot write
`day_record_events`"* is true by policy rather than by privilege. The harness
proves both behaviourally; these checks now read the actual conditions.

**`harness.mjs` — a harness is code, and sliced code cannot check itself.**
Phases 6 and 7 verified their sections of `rls_test.sql` by running those
sections. A slice brings its own fixtures, so it cannot see that
`grant select on _ids` sat eight lines above `create temp table _ids` — the file
died on its first statement and had never once run end to end. Three more faults
of the same kind surfaced behind it: a session fixture with an impossible
window, and two checks that inherited the employee's role and therefore could
not see the rows they counted. One of those two reported "refused" for three
phases while proving the opposite of what it claimed.


## The lockout probe, and what it found

This is the one defect in the project that was found by an instrument rather
than by a user, and the instrument is why it was found at all.

`lockout-probe.mjs` began as a diagnostic. It measured one claim — that five
wrong codes lock a worker out — and reported that it was false, on every
database this project had ever run against. `check_in_with_code()` wrote the
attempt row and then raised the refusal; an exception aborts the transaction
that wrote it, so every wrong code **erased its own evidence**. Six wrong codes
left `check_in_attempts` empty, the count never reached five, and the cap was
unreachable. The probe also showed the other half, which is what made the
diagnosis certain rather than plausible: insert five rows by hand, committed,
and the sixth call *is* refused. The counter was always correct. The
transaction was the problem.

That behaviour was too precisely known to be dropped, so it was never deleted
from the suite. `e2e.mjs` recorded it as `KNOWN GAP` checks — the suite stayed
honest about the defect, and would fail the moment anything changed.

Migration 017 changed it. A refusal is now **returned** as a value rather than
raised, so nothing is aborted and the attempt row stands. `lockout-probe.mjs`
was rewritten to assert the fix instead of the defect, and it is now part of
`npm run prove` — it exits non-zero if any of its four properties breaks:

1. five wrong codes leave **five** recorded attempts (not zero);
2. every refusal is byte-identical — a code belonging to nobody, a code from
   yesterday, and the contractor next door all read the same, and none of them
   names anybody;
3. the sixth call is refused for the cap, with the agreed sentence;
4. no refusal sentence discloses whose code it was.

`e2e.mjs` carries the same behaviour with real accounts: five committed wrong
codes leave five rows, counted as the **owner** — `check_in_attempts` has no
SELECT policy for either role, so a worker or employer reading it gets zero, and
that is a permission rather than a fact. `KNOWN GAP` appears nowhere in this
repository now, which is the point of keeping the probe: a file that once
described a defect and now asserts its absence is a stronger record than one
that has simply been edited.

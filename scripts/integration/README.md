# Cross-layer proofs

These are not unit tests. `tests/` runs the pure logic in microseconds and
should stay that way. What these add is the layer underneath it: a real
PostgreSQL — the same thirteen migrations the live project has — so that a
question like *"does the number on the invoice equal the number in the ledger"*
gets an answer from the database rather than from a fixture someone wrote by
hand.

They use [PGlite](https://github.com/electric-sql/pglite), which is PostgreSQL
compiled to WebAssembly. No Docker, no server, no connection string. The two
Supabase pieces the migrations assume — the `anon`/`authenticated` roles and
`auth.uid()` reading the JWT claims — are created by the runners themselves.

```bash
npm install --no-save @electric-sql/pglite
npm run prove
```

`npm run prove` runs all three and exits non-zero if any of them fails. Each can
also be run alone:

| File | The question it answers |
| --- | --- |
| `migrations.mjs` | Does 001→013 apply to an empty database, and is what comes out the shape the app expects? |
| `e2e.mjs` | Does one day of work end up as the *same money* on every screen? |
| `harness.mjs` | Can an employee see another employee's wages? |

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

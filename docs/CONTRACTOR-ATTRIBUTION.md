# Which contractor a recorded day belongs to

Written in Phase 5. **This document changes nothing.** It records how the
product behaves today, what that costs, and what a correct fix would have to
do. The database schema was deliberately **not** modified: attribution is a
financial-accuracy question, and it deserves its own planned change rather than
a column added in passing during a regression pass.

---

## 1. The short version

A recorded day does not know which contractor it was recorded under. The link
is derived, every time it is read, from the contractor the worker is on **now**.

- Already-issued invoices are frozen documents and do not move. That guarantee
  is **structural**.
- Live reports, and any invoice issued *after* a worker is moved, attribute that
  worker's historical days to their **new** contractor. That is the exposure.

---

## 2. What the schema actually says

Verified by reading the migrations, not inferred.

| Fact | Where |
|---|---|
| `day_records` has no `contractor_id` column | `001_employer_schema.sql:89–126` |
| …and none was ever added by any later migration | grepping every migration for `day_records` + `contractor` returns nothing |
| One row per person per day | `001_employer_schema.sql:119` — `unique (employee_id, work_date)` |
| The contractor link lives on the worker | `007_contractors.sql:61–63` — `alter table employees add column contractor_id … on delete set null` |
| A day is never joined to a contractor directly | no query anywhere joins `day_records` to `contractors` |

So the only path from a day to a contractor is
`day_records.employee_id → employees.contractor_id`, and that second hop is
mutable: moving a worker between contractors rewrites it for **every** day they
have ever recorded.

### Invoices are the exception, by construction

`issue_invoice()` (`013_invoices.sql:266`) copies figures into `invoice_lines`
at the moment of issue:

```sql
from public.day_records d
join public.employees e on e.id = d.employee_id
where e.employer_id = uid
  and ( (p_contractor_id is null and e.contractor_id is null)
        or e.contractor_id = p_contractor_id )
  and d.work_date between p_from and p_to
```

Note what that predicate reads: **`e.contractor_id`**, the worker's contractor
at issue time. The row it produces then stores `employee_name`, `job_title`,
`days`, `worked`, `amount` and the confirmed/claimed/disputed counts as plain
values (`013_invoices.sql:163–181`), and `invoices` stores `contractor_name`
and frozen totals beside it (`:100`, `:117–128`). The migration's own comment
says why: *"the document must not change when somebody is renamed or leaves."*

That is the whole mechanism. An issued invoice stops reading the ledger, so a
later move cannot touch it — but **only because the copy already happened.**

---

## 3. Behaviour today, surface by surface

| Surface | After a worker is moved from A to B | Why |
|---|---|---|
| The day row itself | **Unchanged** — amount, kind, multiplier, rate, status, method, date all byte-identical | nothing writes back to `day_records` on a move |
| A second day appearing | **Impossible** | `unique (employee_id, work_date)` |
| An invoice issued **before** the move | **Does not move** | `invoice_lines` holds copied values, not a query |
| The record's own detail screen | Unchanged | it reads the stored row |
| Dashboard / month / year rollups | The historical day now counts under **B** | `groupByContractor(contractors, employees)` (`employerLogic.js:540`) groups *workers*, then `contractorRollup` (`:617`) sums their days |
| An invoice issued **after** the move, for a period that spans it | Those days bill to **B** | the predicate above reads `e.contractor_id` now |
| The kiosk's contractor check | Refuses A, accepts B, from the moment of the move | `019_site_kiosk.sql:605`, checked *before* the PIN |

---

## 4. What §4 H requires, and what is actually proved

`docs/SITE-ATTENDANCE.md` §4 H asks for three things. All three pass, and
`npm run prove` prints the observed value for each:

| Requirement | Assertion | Observed |
|---|---|---|
| the day already recorded is not changed | `e2e.mjs:999` | `₦12,000 · work · kiosk` |
| (and no second day appeared) | `e2e.mjs:1002` | `1 row(s)` |
| an issued invoice does not move | after `:1002` | `INV-0002 · ₦148,000` |
| the old contractor is refused | `e2e.mjs:986` | `You are not listed under that contractor. Check with your supervisor.` |
| the new one works | `e2e.mjs:994` | `ok=true already=true · Eddimore Crew II` |

**§4 H does not require that a historical day keep its original contractor**,
and nothing asserts it. So this is not a failing check or a broken requirement —
it is a gap between what the document promises and what a reader would probably
assume it promises.

---

## 5. What it costs

Concretely: worker James records 1–15 October under Contractor A. On 16 October
the employer moves him to B. Nobody issues an invoice for October.

- The **October rollup now shows all 15 days under B**, and A shows none.
- Issuing October's invoice bills **all 15 days to B**.
- A's October is silently short; B's is silently long. The **total** is right —
  every day is billed exactly once, and `unique (employee_id, work_date)` plus
  the `period` guard mean no day can be billed twice. The **split between
  contractors** is wrong.

For an employer who bills each contractor separately, that is a real money
problem. It is also invisible: nothing warns, because from the ledger's point of
view nothing is inconsistent.

The exposure narrows to one condition — **the period was not invoiced before the
move.** Once invoiced, the figures are frozen and correct as of issue time.

---

## 6. Recommended change (separate, planned, not done here)

The fix is to make the day remember, which means **adding a column, not
rewriting history**.

**Shape of it**

1. New migration (next free number) — `alter table public.day_records add column
   if not exists contractor_id uuid references public.contractors(id) on delete
   set null`, matching how `007` did it for `employees`. Additive and idempotent,
   per this repo's migration conventions.
2. Write it at record time, in the paths that already know the contractor:
   `kiosk_check_in` already validates `p_contractor_id` (`019_site_kiosk.sql:605`)
   and `check_in_with_code` resolves one. A trigger must not guess.
3. Read it with a fallback: `coalesce(d.contractor_id, e.contractor_id)`. History
   keeps today's behaviour exactly; new days are pinned.
4. Point `issue_invoice()`'s predicate and the rollup grouping at the same
   `coalesce`, so a report and an invoice can never disagree.

**Decisions that must be made before writing it** — each is a product decision,
not an implementation detail:

- **Backfill.** Leave historical rows `NULL` (they keep being attributed by the
  worker's current contractor, exactly as today), or backfill them from the
  current contractor (which freezes today's possibly-wrong interpretation
  permanently)? `NULL` is the honest default: it says "not recorded", and the
  `coalesce` makes that visible rather than pretending.
- **Already-invoiced periods.** Must stay untouched. A backfill that changes an
  issued invoice's meaning would break the one guarantee that currently holds.
- **Locked months and confirmed days.** Confirming a day already freezes its
  money; decide whether it should also freeze its contractor.
- **A worker moved twice in one period.** `NULL` history cannot be
  reconstructed. Accept that, or record moves as effective-dated rows the way
  rate changes already are (rates are effective-dated precisely so that history
  is never rewritten — the same argument applies here).

**Proof it would need**

An e2e scenario alongside §4 H: *record a day, move the worker, issue the period,
and assert the day billed to the contractor it was recorded under* — plus the
inverse for historical `NULL` rows, asserting they still bill to the current
contractor so the fallback is proven rather than assumed. The migration chain
check (`scripts/integration/migrations.mjs`) must also run the new migration
against a project stopped at 019.

**Why it is not in this phase:** it changes how money is attributed between two
parties. That is not a usability defect, and Phase 5's instruction was explicit
that the schema must not be modified for it.

---

## 7. Status

- Current behaviour: **documented above, unchanged, all existing checks green.**
- Schema change: **not made.**
- Decision required from the product owner on the four questions in §6 before any
  migration is written.

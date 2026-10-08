# §40 — does it feel obvious?

*The closing review of the DayPay 2.0 brief. Written 3 October 2026, after §39's six
findings were closed the same day. It is a judgement, not a build: nothing in this
document changed the product, and nothing in it should be read as a score.*

---

## What the question is actually asking

The brief's last paragraph does not ask whether the product is prettier, or whether
every screen is standards-compliant. It asks whether a person who has never been
taught DayPay can open it and do the obvious thing without being told. So this review
was made by asking four questions of the running product, each one a test a person
would apply in their first minute — and by writing down the answers, including the
ones I did not like.

---

## Test 1 — "What is this, and what does it want from me?"

**Open the app, look, and stop.**

Today answers first. It says how many people are on the roster and how many are
recorded, names the ones who are not, and holds **one filled button** — *Record
today's work* — which is the only thing an employer has to do most mornings. Nothing
on that screen is a statistic offered for its own sake: the figures that remain are
the two that decide something (who is missing, and what this month has cost so far).
The four stat cards the old dashboard carried are gone, and their numbers were not
lost — they are the month header and the worker's own screen, where somebody asks
for them.

**Verdict: yes.** The first screen answers a question an employer already has before
they open the app in the morning.

## Test 2 — "Do the words mean what I mean?"

**Read every label as a business owner would, without a glossary.**

This is where the product failed worst in §39, and the failure is now closed. Nothing
an employer reads names a database, a file, or a vendor: *"Contractors aren't switched
on yet. Everything else on the roster still works. Whoever set up DayPay can switch
them on."* The exact file name is still there, one tap away, behind **Technical
detail** — which is where the one person who can act on it will look. The kiosk code
is entered "on the site machine when it asks", not "at `/kiosk.html`".

Status words are the product's own and they are used consistently: **Awaiting
confirmation · Confirmed · Disputed**, and **Not registered** never means "not
employed" anywhere in the product. A worker who is not on a contractor is "Not
assigned", not "Unassigned worker" in a table heading.

**Verdict: yes, with one honest wart.** A worker's request can still be summarised in
the awkward case as *"Says they worked this day and it is not recorded."* — true, but
a sentence that only makes sense once you know the correction flow exists. It is
understandable in context, and it is not wrong.

## Test 3 — "Will it let me break something without noticing?"

**Try the dangerous things: a wrong code, a double tap, a back button, a lost
signal.**

This is the test the product passes most convincingly, and almost none of it is
visible when everything is fine:

- a wrong check-in code says **"Code not correct, visit the site."** and names nobody,
  so the endpoint cannot be used to guess whose code was real;
- five wrong codes are **recorded**, and the sixth is refused in the words already
  agreed with the owner — and the lockout does not send anybody to a contractor;
- a confirmed day's money is frozen by the database: the screen offers no edit, and
  pressing anyway writes nothing (checked, both);
- recording the same person twice is an undo, not a second day;
- whatever the phone says, the kiosk and the app write **one** row per person per day;
- every screen that cannot read the data **says so** instead of drawing an empty one,
  and every failure offers the way back — 28 checks in the states suite alone;
- and nothing invented can reach the ledger: the mock data layer lives only in the
  test harness.

**Verdict: yes.** A user would have to work hard to do damage, and when something
fails the product tells them what happened in a sentence they can act on.

## Test 4 — "Could I explain this to somebody in a minute?"

**Take each of the ten journeys and say it out loud.**

- *Who is working today?* → open it; Today says it. One screen, no taps.
- *Somebody is not recorded.* → their row says **Record**, and it takes you to the day.
- *They will record it themselves.* → Today shows the day's code.
- *They have no smartphone.* → More → Site kiosk → a code for the machine; the worker
  needs no account and no email.
- *Who is this person, and what do they earn?* → People → the row opens the person.
- *Something is wrong about a day.* → they ask, you answer, the ledger records it as a
  correction.
- *What do I owe?* → More → Billing: the period, the figure, the invoice.
- *What happened this month?* → More → Reports: the total first, the raw days as a CSV.

Every one of those is a sentence with one verb and no conditions, which is the test
the old taxonomy failed: **Mark days · Roster · Summary · Billing** described the
database's shape, not the employer's questions.

**Verdict: yes.** The structure survived contact with the names: this is the same
taxonomy a person would invent if they had never seen the product.

---

## Where it still does not feel obvious — honestly

1. **The personal tracker rides inside the employer's app.** For an employer with a
   business account, "Your own tracker" in Settings is a second product that happens
   to share a shell. §39's Finding 6 named it; the label is now there, and the
   confusion is reduced rather than removed. This is a product question — should an
   employer see a personal tracker at all — and it is the one thing in the review I
   would put in front of the owner rather than fix.
2. **Attendance has no search until the roster is long.** Deliberate: search over
   three names is furniture. It appears at seven. The judgement that "six is the
   threshold" is mine, made without a real 60-person roster in front of me.
3. **Nothing here has been used on a phone, in daylight, by a person holding it.**
   The tap targets clear 44px, the copy is short, and the layout is one column — all
   verified in a DOM, none of it verified by a thumb. The browser run in
   `SITE-ATTENDANCE.md` §4 is the outstanding item, and it is the only one that could
   change a conclusion in this document.
4. **Two behaviour questions remain the owner's**, unchanged by this review: a
   recorded day is attributed to the contractor a worker is on **now** (scenario H),
   and both agreed variants of the code refusal stay live.

---

## The judgement

**It feels obvious.** Not because every screen is beautiful — some are plain — but
because the product now does the same thing a competent person would do in the same
situation, and says so in the words they would use. The redesign moved the questions
to the surface and the machinery underneath, and §39 found the last places where the
machinery was still showing: a sentence that contradicted itself, a second green
button, four sentences written for whoever runs the database, a file path, a missing
search, and one unlabelled half of Settings. All six are closed, each with a check
that fails if it comes back.

The evidence behind that judgement, in numbers, on 3 October 2026:

| | |
|---|---|
| Unit tests | **503**, 0 failures |
| Screen checks (15 suites, driven in a real DOM) | **589**, all green |
| Database migration chain | **36/36** |
| End-to-end reconciliation (ledger · screens · invoice) | **115/115** |
| Permissions (RLS) | **78/78** |
| Lockout probe | **PASS** |
| Lint | 0 errors, 8 pre-existing warnings |
| Builds | `build` · `build:site` · `build:specimen` clean |

**What I would do next, in one line each:** run the browser scenarios on a real phone
in daylight; deploy (the two decisions are the Production Branch and Supabase's Auth
URLs); put the personal-tracker question to the owner; and leave the payroll engine,
the refusal wording and the ledger exactly where they are.

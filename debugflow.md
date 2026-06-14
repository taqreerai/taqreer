# debugflow.md , how to debug (root cause before fix)

The one rule: **never ship a fix you cannot prove.** Find the exact mechanism,
confirm it with evidence (logs, traces, real data , not reasoning), then fix the
root cause. A fix you can't explain with receipts is a guess, and a guess on a
live system is how you make things worse. No half-baked fixes.

This file exists because of a real incident: new users were getting 0 signup
credits. The first instinct was a "self-healing retry" on the grant. That was a
band-aid , it treated the symptom (grant didn't run) without knowing why. The
actual cause was a race: the dashboard server component upserts the `User` row on
render, so by the time `user-sync` runs its `if (!existing)` grant, the user
already exists and the grant is skipped. No amount of "retry" describes that.
Symptom-patching hides architecture bugs.

## The anti-pattern to catch in yourself

If you are about to propose "make it more resilient / add a retry / handle the
edge case / it was probably a transient" BEFORE you can point at the exact failing
line and prove it ran (or didn't), STOP. You do not understand the bug yet. That
sentence is the tell that you are guessing.

## The flow

1. **Reproduce on a controlled state.** Get a deterministic or live repro with
   clean, known inputs. Strip confounds. In the incident, a fresh never-seen email
   on a healthy DB removed the noise (residual auth accounts, a one-off empty-DB
   transient) and exposed the real bug cleanly. A repro full of confounds teaches
   you nothing.

2. **Observe, do not theorize.** The moment you hear yourself say "this is
   impossible" or "contradiction," that is the sound of a wrong ASSUMPTION, not a
   paradox. Stop reasoning in circles and go get ground truth:
   - Read the FULL error, not the summary. A blank log message hid a Prisma P2021;
     the full text was "table public.User does not exist."
   - Arm a watcher. Turn on logging that records what actually happened and let the
     bug recur with it armed: DB connection logging (which database each connection
     hit), statement logging (the exact SQL), verbose errors, timestamps.
   - Inspect real state , the rows, the counts, the timeline , not what the code
     "should" do.

3. **Separate correlation from causation.** The first loud signal is often a red
   herring. An empty-schema error burst LOOKED like the cause; effort went into
   making it fit. It was an unrelated one-off. The real bug reproduced on a
   perfectly healthy DB with zero errors. If your theory needs the stars to align
   ("a transient during a deploy") and the facts contradict it ("no deploy, stable
   box, an hour later"), the theory is wrong. Drop it. Do not defend it.

4. **Pin the timeline first.** Settle clocks before correlating events. Confirm
   timezones explicitly , `SELECT now(); SHOW timezone;` vs `date -u`. A 3-hour
   UTC/local offset sent one theory down the wrong path until the clock was proven.
   Put every event (row createdAt, deploy/swap mtime, process start, log line) on
   ONE clock before reasoning about order.

5. **Trace what the code REALLY did.** Do not trust your read of the source. Trust
   the execution. The query trace showed `INSERT User: 1`, `INSERT CreditAccount:
   0`, zero grant queries , which proved the grant code never ran, something
   source-reading could not (the code "looked correct").

6. **Check EVERY path, not the obvious one.** The bug was a second place doing the
   same write. `grep` for every caller / every place that performs the operation.
   Here, 4 code paths upsert the `User`; the grant lived in only 1. The wrong
   assumption , "user-sync is the only thing that creates a user" , was the root
   error. Always ask: "what ELSE does this?"

7. **Confirm the exact mechanism with receipts.** Before declaring root cause, be
   able to say: this line, in this file, runs in this order, producing this
   observed effect , and show the log/trace/row that proves it. "Probably a
   transient" is not a root cause.

8. **Only then, fix the root cause , and explain it.** The fix targets the
   mechanism, not the symptom. Here: the grant must not depend on "user-sync
   created the row" (a false assumption); gate it on the real state
   (`signupGrantedAt` is null) so it fires once regardless of which path created
   the user. You must be able to explain both why the fix works AND why the bug
   happened.

## Be honest about limits

If you cannot prove something, say so and say WHY (e.g., "the exact trigger is not
recorded because connection logging was off"). Do not paper over a gap with a
confident-sounding guess. A wrong "100% sure" is worse than an honest "here is what
I can and cannot prove yet." Stating the limit usually points at the next data you
need to collect.

## Definition of done for a debug

- Reproduced, ideally on a controlled state.
- Root cause identified to the exact line / mechanism / order.
- Confirmed with evidence you can point to (a log line, a query trace, a data row,
  a timeline).
- The fix addresses the root cause, not the symptom; you can explain why it works
  and why the bug happened.
- Regression scope understood: who else is affected, what data needs backfilling.

## Toolbox (proven in this repo)

- **Arm a DB watcher:** `ALTER SYSTEM SET log_connections=on; ALTER SYSTEM SET
  log_statement='all'; ALTER SYSTEM SET log_min_error_statement='error'; ALTER
  SYSTEM SET log_error_verbosity='verbose'; SELECT pg_reload_conf();` then read
  `/var/log/postgresql/`. Reload, no restart. DISARM it when done (it is verbose).
- **Settle the clock:** `SELECT now(); SHOW timezone;` vs `date -u`.
- **Find every path:** `grep -rn` for every place that performs the operation in
  question , the bug is often the path you did not know existed.
- **Read real state:** query the actual rows and the timeline (createdAt vs related
  events), do not trust intent.
- **Mark a baseline:** record a log line count before the repro, then read only
  what is new.
- **Trace, do not infer:** count the writes that should have happened
  (`INSERT X: 0`) , absence is proof a code path never ran.

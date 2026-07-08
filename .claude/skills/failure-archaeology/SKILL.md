---
name: failure-archaeology
description: Case files of Anchor's costliest past failures — what broke, why it stayed hidden, the fix now in code, and the regression check to run — load BEFORE touching logging, calibration, graduation, or schedule/date math.
---

# Failure archaeology

Anchor's worst bugs never threw. They corrupted training data, over-promised,
or punished the user — all while every screen looked fine. This file is the
case record. Before changing anything near `appendLog`, `stepToward`,
`scorableLogs`, or timeline/date math, read the matching case and run its
regression check. For the invariants themselves see `architecture-contract`;
for symptom-driven diagnosis see `debugging-playbook`. Where a check says
"seed" (logs, levels, trip state), use the localStorage fixture cookbook in
the `validation-and-qa` skill.

## Mine the history yourself

```bash
git log --format="%h %s" origin/main
git show d1028f0 --stat        # the goldmine: read the full commit message
git show c3ec224 -- src/lib/engine.ts
```

| Commit | PR | Contents |
|---|---|---|
| `4fe0883` | #3 | Core loop (plan/lock/execute/debrief) |
| `0fbcbe8` | #4 | Graduation automation, cues, Web Push |
| `c3ec224` | #6 | Walking mode + the drive-taskId fix |
| `e2cb264` | #10 | Replan, armed starts, loop-closing pushes |
| `d1028f0` | #11 | 26-agent audit batch — most fixes below land here |
| `055b144` | #12 | Projected-arrival copy when behind |

Commit messages are claims, not ground truth — two claims in `d1028f0` are
false at HEAD (see Meta-lessons). Always confirm against the code.

## Class 1 — silent training-data corruption

The product's value IS the data record (`anchor:logs` medians and
calibration). These bugs wrote lies into it with zero visible symptoms.

### 1.1 Drive times never measured (3 PRs, #3–#5)
- **What**: the Drive block in `travelChain()` (`src/lib/engine.ts`) carried
  no `taskId`, and `finish()` in `src/app/execute/page.tsx` only logs when
  `current.taskId` is set — so drive durations were never logged, per-route
  medians never learned, the plan-step history hint never appeared.
- **Why hidden**: absence of data has no error state. The screen worked;
  only the silent measurement path was dead.
- **Fix** (`c3ec224`): `travelChain()` tags drive/walk blocks with
  `taskId: "drive"`/`"walk"`; `lock()` in `src/app/plan/page.tsx` rewrites
  them to `drive:<slug>`/`walk:<slug>` for per-route learning. `guessFor()`
  in execute resolves those prefixes to the transit guess fields.
- **Regression check**: drive a full driving trip (see the `verify` skill),
  then confirm `anchor:logs` contains a `drive:<destination-slug>` entry.

### 1.2 Replan re-logged a running block as ~2 minutes
- **What**: replan (introduced `e2cb264`) rebuilt remaining steps and reset
  the in-flight block's `startedAt`; finishing a 15-min shower after a
  replan logged it as ~2 min, biasing that median short.
- **Why hidden**: one bad log per replan, absorbed by a 5-log median window.
- **Fix** (`d1028f0`): `rebuildRemaining()` (`src/lib/engine.ts`) keeps
  `startedAt` only when the first remaining block is kept
  (`kept[i] === remaining[0]`); a running block that is CUT advances
  unlogged (`confirmReplan()` in execute).
- **Regression check**: start a block, replan keeping it, finish — the
  logged `actualMinutes` must span the ORIGINAL start.

### 1.3 Sub-15-second tap-throughs logged as real reps
- **What**: Start→Done in a few seconds logged a 1-minute "actual" —
  clicking through, not doing the task.
- **Fix** (`d1028f0`): `finish()` logs only when
  `current.startedAt && current.taskId && elapsedSec >= 15`. The paired
  fix for the opposite error (late Start tap under-counting) is the
  `start(backdateMinutes)` "Already doing it — started ~2/5m ago" buttons.
- **Regression check**: tap Start then Done immediately; `anchor:logs`
  must not grow.

### 1.4 Whole-minute quantization drowned the score
- **What**: a 2-min task measured at 1:20 rounds to ±50% error — pure
  quantization noise dominating `calibrationScore`, which gates levels.
- **Fix** (`d1028f0`): `scorableLogs()` (`src/lib/calibration.ts`) keeps
  only logs with `guessMinutes > 0` AND
  `Math.max(guessMinutes, actualMinutes) >= 5`; `DurationLog` gained
  optional `actualSeconds` (`src/lib/types.ts`).
- **Regression check**: seed short-task logs; `calibrationScore()` must
  ignore them. Note medians still learn from ALL logs — only scoring
  filters.

## Class 2 — dishonest promises

### 2.1 "You can close the app" before push was verified
- **What**: the armed waiting room promised wake-ups unconditionally. With
  notifications denied or VAPID unset, no cue ever fires — the user sleeps
  through the start believing Anchor has their back.
- **Fix** (`d1028f0`): `arm()` in `src/app/lock/page.tsx` sets
  `pushOk = granted && (await syncPushSchedule(...))`; the armed copy
  branches on `pushOk === false` to "Keep this screen open, or set a phone
  alarm".
- **Known residue at HEAD**: `pushOk` is component state, not persisted.
  Reopening an armed trip (`trip.armedAt` set) resets it to `null`, and
  `null` renders the promise copy without re-verification. If you touch
  the armed screen, close this gap.
- **Regression check**: deny notifications, arm — the alarm-fallback copy
  must show, not the promise.

### 2.2 Honor-system debrief defaulted to "on time"
- **What**: the debrief delta dial started at 0; one Save tap recorded an
  on-time arrival regardless of reality. Streaks and levels — the product's
  proof — rested on a wishful default.
- **Fix** (`d1028f0`): `toDebrief()` in execute stamps
  `arrivedAt: new Date().toISOString()`; the debrief mount effect
  (`src/app/debrief/page.tsx`) prefills `delta` from `arrivedAt` vs
  `arrivalTime` when `|measured| <= 120` min. Still editable ("adjust if
  you tapped late") — measurement first, honesty hatch second.
- **Regression check**: arrive late (fast-forward the fake clock), open
  debrief — delta must prefill positive, not 0. Deltas beyond ±120 min
  silently fall back to 0 (known limit).

## Class 3 — punishment spirals

### 3.1 The 4→1 demotion cascade from one late day
- **What**: `earnedLevel()` keys on `onTimeStreak()`, and one late arrival
  zeroes the streak, dropping `earned` to 1. Before the gate, EVERY
  subsequent debrief stepped one level down — so a level-4 graduate who was
  late once fell 4→3→2→1 across the next debriefs even when those arrivals
  were on time. Exactly the punishment spiral that makes this population
  abandon tools.
- **Fix** (`d1028f0`): `stepToward(current, earned, wasLate)` in
  `src/lib/graduation.ts` demotes only when `earned < current && wasLate`;
  the debrief passes `delta > 0`. That comparison must stay strictly `>`
  — `delta === 0` is on time.
- **Regression check**: seed level 4, save one late debrief (drops to 3),
  then save on-time debriefs — the level must not fall further.

### 3.2 Shaming copy
- **What**: cue and failure copy read as punishment ("plan is dead" etc.).
- **Fix** (`d1028f0`): copy sweep to urgency-without-shame; no-blame
  discard on execute and skip-with-no-data on debrief (both log nothing).
- **Known residue at HEAD**: the sweep missed notification bodies —
  `cueForStep()` in `src/lib/notify.ts` still says "Chop chop." in the
  missed-start nag, despite `d1028f0`'s message claiming it was replaced.
  If you edit `notify.ts` copy, fix it under the same rule.

## Class 4 — schedule math

### 4.1 Midnight anchor: the 23:45 bus a day late
- **What**: transit/pickup times are "HH:mm" parsed onto the ARRIVAL's
  calendar day (`timeOnSameDay()`). Planning for a 00:30 arrival with a
  23:45 bus put the bus a full day late — timeline, wake-up, and every cue
  silently wrong.
- **Fix** (`d1028f0`): `rollBeforeArrival()` (`src/lib/engine.ts`) forces
  the anchor within 24h BEFORE the arrival; `anchorTime()` applies it to
  both transit departures and pickup times.
- **Regression check**: drive a transit plan with arrival 00:30 and a
  23:45 departure time (see "Midnight anchors roll back" under the `verify`
  skill's Audit-round behaviors) — the departure step must land on the
  previous calendar day. There is no way to call `buildTimeline` directly
  (no test runner, by design) — driving is the check.

### 4.2 DST: +24h of milliseconds is not "tomorrow"
- **What**: rolling a past arrival time to tomorrow by adding 86,400,000 ms
  lands an armed airport run an hour off across a DST weekend.
- **Fix** (`d1028f0`): calendar-day roll via `d.setDate(d.getDate() + 1)` —
  in the plan page's arrival memo (`src/app/plan/page.tsx`) and solo's
  `begin()`. Never add day-sized millisecond constants to wall-clock dates;
  `rollBeforeArrival()` also steps by `setDate`.
- **Regression check**: grep new code for `24 * 3600` / `86400` applied to
  Dates.

### 4.3 Drift pill flipped to "ahead" on a late start
- **What**: drift was measured instantaneously, so tapping Start on an
  already-late block showed "ahead of plan" — rewarding lateness.
- **Fix** (`d1028f0`): in `src/app/execute/page.tsx`, drift while running =
  `max(now, startedAt + plannedMinutes)` minus `step.endsAt` (projected
  finish, can only improve by finishing early, never by starting late).
  Pending drift = `-minutesUntil(startsAt)`; ≤ −120 min shows the neutral
  "Starts much later" pill.
- **Regression check**: start a block 10 min late — the pill must stay
  "behind".

## Meta-lessons

1. **Works-when-watched is not enough.** Every Class 1 bug produced a
   perfectly working screen; the lie was only in `anchor:logs`. After
   driving any flow, inspect localStorage — assert on the DATA, not the UI.
2. **The audit lenses that caught these** (`d1028f0`, 26 agents, 25
   actions): correctness (clock-math edges: midnight, DST), training
   validity ("what does this write into logs/debriefs, and can it lie?"),
   honesty (does copy promise more than the code verifies?), recovery
   (does failure route back into the loop?). Apply the training-validity
   lens to every diff near execute/debrief.
3. **Audits lie too.** `d1028f0` claims "chop chop" was replaced (it
   wasn't — see 3.2) and "69/69 headless checks" (those scripts were
   session-ephemeral and never committed; only
   `.claude/skills/verify/SKILL.md` landed). Verify against code, always.
4. **Standing rule**: any change near logging (`start`/`finish`/
   `confirmReplan` in execute), calibration or graduation math, or
   schedule/date math (engine, plan/solo date rolls) must re-run the
   relevant drives from the `verify` skill — especially its "Audit-round
   behaviors" section, which encodes these exact regressions — before
   merge. There is no unit-test framework by design; driving IS the test.

## Provenance & maintenance

- **Distilled from**: `src/lib/engine.ts`, `src/lib/calibration.ts`,
  `src/lib/graduation.ts`, `src/lib/notify.ts`, `src/lib/types.ts`,
  `src/app/execute/page.tsx`, `src/app/debrief/page.tsx`,
  `src/app/lock/page.tsx`, `src/app/plan/page.tsx`; commits `c3ec224`,
  `e2cb264`, `d1028f0` (read its full message), `055b144`.
- **Authored** 2026-07-07, verified against HEAD `055b144`.
- **Update this skill when**: any listed fix symbol changes
  (`rebuildRemaining`, `rollBeforeArrival`, `stepToward`, `scorableLogs`,
  `finish`, `arm`), a new logging path is added, either residue (2.1
  pushOk persistence, 3.2 "Chop chop.") is fixed, or a new
  silent-corruption/honesty bug is found and fixed — add it as a case.
- **Re-verify core claims**:
  1. `git show d1028f0 --stat` — the audit commit message matches the cases.
  2. `grep -n "Chop chop" src/lib/notify.ts` — residue 3.2 still present
     (empty result means it was fixed; update 3.2).
  3. `grep -n "wasLate\|>= 15\|rollBeforeArrival\|remaining\[0\]" src/lib/graduation.ts src/app/execute/page.tsx src/lib/engine.ts` — the four load-bearing guards exist.

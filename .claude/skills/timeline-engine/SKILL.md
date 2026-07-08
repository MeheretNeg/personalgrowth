---
name: timeline-engine
description: Deep runbook for the backward-planning math in src/lib/engine.ts and src/lib/priors.ts — anchors, per-mode travel chains, buffers, replan, and how to extend (new transit mode, live-API injection) without breaking invariants; load before touching engine.ts, priors.ts, or any code that builds or rebuilds a timeline.
---

# Timeline engine

`src/lib/engine.ts` is the app's core math: it turns "arrive at X by HH:mm"
into a backward-planned, forward-executed timeline. It is deliberately pure —
no UI, no storage, no network, no `Date.now()` — so it can be exercised in
isolation and so a live traffic/transit API can be injected upstream later.
Read `anchor-orientation` first if you don't know what Anchor is; check every
change against `architecture-contract` before committing.

## Core model

Inputs/outputs (`src/lib/engine.ts`, shapes in `src/lib/types.ts`):

- `TimelineInput`: `{ arrival: Date; earlyBufferMinutes: number; transit: TransitDetails; tasks: PlannedTask[] }`.
- `TimelineResult`: `{ steps: TimelineStep[]; startAt: Date; leaveDoorAt: Date; targetArrival: Date }`.

`buildTimeline()` works like this:

1. `targetArrival = arrival − earlyBufferMinutes` ("early is the new on time"
   — all math targets the buffered time, never the required arrival).
2. Compute the mode's anchor via `anchorTime()` (next section).
3. Build a block list: one `prep` block per `PlannedTask` (in given order,
   using `plannedMinutes`), then the mode's `travelChain()` blocks.
4. Walk the list BACKWARD from the anchor, assigning each block
   `start = end − minutes`, then reverse into forward order. Steps are
   therefore gapless: each step's `endsAt` equals the next step's `startsAt`.
5. Per step it generates: `id: "step-<i>"` (i = chronological block index),
   ISO `startsAt`/`endsAt`, and the implementation-intention string
   `ifThen: 'When the <h:mm> alert fires, then I <verb>.'` from each block's
   `ifThenVerb`.
6. `startAt` = first step's start. `leaveDoorAt` = start of the FIRST step
   whose `kind !== "prep"` (i.e. the staging block), falling back to the
   anchor if no travel block exists.

`minutesUntil(iso, now)` is the shared signed-minutes helper (negative =
behind); Execute's drift math builds on it.

## Anchors per mode — `anchorTime()`

The anchor is the moment the user stops controlling time. The chain must END
exactly there.

| Mode | Anchor |
|---|---|
| `driving`, `walking`, `pickingUp` | `targetArrival` |
| `transit` (with `transitDepartureTime`) | the vehicle's departure clock-time |
| `pickup` (with `pickupTime`) | the driver's arrival clock-time |

For the clock-time modes, the HH:mm string is parsed onto the arrival's
calendar day via `timeOnSameDay()`, then passed through `rollBeforeArrival()`,
which shifts by whole calendar days (`setDate`, never ±24h of ms — DST) until
the anchor lands in the window `(arrival − 24h, arrival]`. This fixed a real
bug: planning at 23:00 for a 00:30 arrival (tomorrow) parsed the 23:45 bus
onto tomorrow's date — a full day late — making the timeline, wake-up, and
every cue silently wrong. If `transit`/`pickup` lacks its clock-time, the
anchor falls back to `targetArrival` (the Plan wizard's `stepValid` normally
prevents that state).

Note: for transit/pickup the engine does NOT verify you'll arrive on time —
arrival math is the schedule's/driver's job. The Plan preview (step 3 of
`src/app/plan/page.tsx`) shows a `surface-alert` warning when the chain's last
`endsAt` is after `targetArrival`.

## Travel chains and BUFFERS

`travelChain()` returns the forward-ordered blocks between "out the door" and
the anchor. Constants are `BUFFERS` in `src/lib/priors.ts` (minutes):

| Constant | Min | Meaning |
|---|---|---|
| `doorstepStaging` | 5 | Fully-ready pause at the door before leaving under your own power |
| `walkToCar` | 3 | Home door to sitting in the car |
| `parking` | 10 | Find parking + walk in, after the drive |
| `walkArrival` | 3 | Walking mode: lights, crossings, finding the entrance |
| `platform` | 3 | Be AT the stop before the bus/train arrives |
| `curbside` | 3 | Pull-up buffer when picking someone up (no parking hunt) |
| `pickupStaging` | 10 | Waiting at the door BEFORE a driver arrives — never make them wait |

Chains (staging block first, then travel):

| Mode | Chain (label · minutes · taskId) |
|---|---|
| `driving` | Staged at the door · 5 → Walk to car · 3 → Drive · `driveMinutes ?? 0` · `taskId:"drive"` → Park + walk in · 10 |
| `walking` | Staged at the door · 5 → Walk · `walkMinutes ?? 0` · `taskId:"walk"` → Cross + find the door · 3 |
| `pickingUp` | Staged at the door · 5 → Walk to car · 3 → Drive · `driveMinutes ?? 0` · `taskId:"drive"` → Pull up curbside · 3 |
| `transit` | Staged at the door · 5 → Walk to stop · `walkToStopMinutes ?? 10` → Wait at stop · 3 |
| `pickup` | Wait at the door, ready · 10 (single block — `pickupStaging`) |

These buffers exist because they are "the minutes time blindness always
steals" (the Plan copy quotes them). Do not fold them into the drive/walk
estimate and do not delete them to make timelines look shorter.

### taskId tagging and the per-destination slug rewrite

The engine emits BARE `taskId: "drive"` / `"walk"` on the measurable travel
block. `lock()` in `src/app/plan/page.tsx` rewrites those steps to
`drive:<slug>` / `walk:<slug>` (`slug` = destination trimmed, lowercased,
whitespace→dashes) before persisting the Trip, so "work" and "gym" learn
separate travel medians. Execute's `finish()` logs durations against that
namespaced id, and Plan's step-1 record lookup reads
`personalMedian(logs, "drive:" + slug(destination))`. If you add a new
measurable travel block, tag it in `travelChain()` AND extend the rewrite in
`lock()` — an untagged block is never measured (this exact drive-taskId bug
was fixed in PR #6: the Drive block shipped without a `taskId`, so the slug
rewrite never ran); an unrewritten one pools all destinations into one median.

## Replan — `rebuildRemaining(timeline, fromIndex, keepTaskIds)`

Called by Execute's `confirmReplan()` (and live for the dialog preview) when
the user is ≥3 min behind with prep remaining. Behavior:

1. Slices `timeline` from `fromIndex` (the current step).
2. Keeps every non-prep step unconditionally; keeps a prep step only if its
   `taskId` is in `keepTaskIds`. Travel/staging blocks can never be cut.
3. **The anchor is immovable**: it walks backward from the ORIGINAL last
   step's `endsAt`. Replanning compresses the start, never the arrival.
4. The step that was `remaining[0]` (the one in flight, if kept) keeps its
   real `startedAt`; resetting it would re-log a 15-minute shower as 2
   minutes and bias the medians short. Every other rebuilt step gets
   `startedAt: undefined`. All rebuilt steps get `finishedAt: undefined`.
5. `ifThen` is regenerated with the new times. Known quirk: the regenerated
   phrasing uses the prep template (`start "<label>" — nothing else first`)
   for ALL kept steps, including travel — mode-specific verbs are lost after
   a replan. Original step `id`s are preserved (dropped steps just vanish).

Returns the full stitched timeline (`slice(0, fromIndex)` + rebuilt) plus the
new `startAt`. After calling it, Execute clears its `firedCues` dedup set and
re-syncs the push schedule — do the same in any new caller (see
`notification-pipeline`).

## Day math — who rolls what

Responsibility is split; keep it that way:

- **Engine**: `timeOnSameDay(hhmm, reference)` only parses onto the
  reference's calendar day. `rollBeforeArrival()` handles the
  departure/pickup 24h window internally.
- **Pages**: rolling "that time already passed today" to tomorrow is page
  code — Plan's `arrivalDate` memo and Solo's `begin()` both do
  `if (d < now) d.setDate(d.getDate() + 1)`.

Every roll everywhere is `setDate(±1)`, never `±24 * 3600_000` ms: across a
DST weekend +24h of milliseconds lands an armed airport run a full hour off.
This is a repo-wide invariant (see `failure-archaeology`).

## TASK_PRIORS — and why planning uses p75

`TASK_PRIORS` in `src/lib/priors.ts`: 12 entries, each
`{ id, label, p50, p75 }` — population medians and generous 75th percentiles
from time-use surveys (Nielsen grooming, UnitedHealthcare/hygiene, BLS ATUS;
see the file's doc comment). Examples: shower 9/15, wash-hair 12/25,
brush-teeth 2/4, kids-ready 20/35, other 10/20. `getPrior(taskId)` looks up
by id.

Rule: **planning numbers are p75; medians are display/calibration only.**
Durations are right-skewed, so planning at p50 means ~50% overrun odds per
task — the planning fallacy this app exists to fix. Concretely:

- Plan's `standardFor()` / `standardMinutes()` use
  `planningMinutes(logs, taskId) ?? getPrior(taskId).p75` — personal ~p75 of
  the last 8 actuals (`planningMinutes()` in `src/lib/calibration.ts`) once
  ≥5 logs exist, else the population p75.
- p50 appears only as the "Typical person" line in the L1 compare card and
  as Level 2's `COACH_FLAG_THRESHOLD` reference.

Priors must never enter the DOM before the user's blind guess is locked at
levels 1–2 (guess-first training — see `architecture-contract`).

## Extension guide

### Adding a transit mode (end-to-end)

1. `src/lib/types.ts`: add the literal to the `TransitMode` union; add any
   new optional fields to `TransitDetails` (follow the pattern: planned
   minutes + separate blind-guess field where the leg is estimable).
2. `src/lib/engine.ts` `travelChain()`: add the switch arm. The switch has no
   default and the result is spread in `buildTimeline()`, so under `strict`
   TS `npm run build` fails until every union member returns a chain — rely
   on that. Decide the anchor: arrival-anchored modes need nothing more;
   a clock-time anchor needs an `anchorTime()` branch using
   `timeOnSameDay` + `rollBeforeArrival` (never skip the roll).
3. If a leg is measurable, give its block a bare `taskId` and extend the
   `lock()` slug rewrite in `src/app/plan/page.tsx` (see above). Check the
   level-gated record reveal pattern in Plan step 1 (record only after a
   guess exists, `level < 3` only).
4. `src/app/plan/page.tsx`: add to `MODES` (label + honest hint), a step-1
   details section, a branch in the `transit` useMemo, and a `stepValid`
   step-1 branch. Accepting a suggested value must zero the corresponding
   `*GuessMinutes` field — 0 is the "unscored, not a calibration rep"
   sentinel.
5. Verify by driving per the `verify` skill (no unit tests, by doctrine):
   plan a trip in the new mode with a controlled clock, assert the step list,
   `leaveDoorAt`, and the anchor time; include a near-midnight case.

### Injecting a live traffic/transit API

The seam is upstream of the engine — **do not add fetch/async to
engine.ts**. Compute `driveMinutes` (or a departure time) in page/lib code
and pass it through `TransitDetails`; `buildTimeline()` stays untouched and
synchronous. Two rules: (a) an API-supplied number is planning data, not the
user's estimate — set the matching `*GuessMinutes` to 0 exactly like the
"Plan with N min" suggestion buttons do, or calibration scores a copied
answer as a perfect rep; (b) at levels 1–2 the API value must not render
before the blind guess is locked. This app currently has no external data
APIs and no third-party API keys — the only server code is the Web Push sync
route (`src/app/api/push/sync/route.ts`, see `notification-pipeline`). Adding
a live traffic/transit API is a Phase-3-scale change — read `change-control`
first.

## Invariants — re-verify after ANY engine change

1. **Anchor immobility**: `rebuildRemaining` output's last `endsAt` equals
   the input's last `endsAt`, byte for byte.
2. **Arrival anchoring**: for driving/walking/pickingUp the last step's
   `endsAt === targetArrival`; for transit/pickup the anchor is within 24h
   BEFORE `arrival` (`rollBeforeArrival` window), including a
   plan-at-23:00-arrive-00:30 case.
3. **Continuity/ordering**: steps are chronological and gapless — step i's
   `endsAt` === step i+1's `startsAt`; `startAt` === step 0's `startsAt`.
4. **`leaveDoorAt`** is the start of the first non-prep step (the staging
   block), for every mode.
5. **DST**: all day rolls are `setDate`; ±24h of ms may appear only as a
   comparison bound, never as date arithmetic (grep for `3600_000` and
   `86_400` when in doubt — the single expected hit is `rollBeforeArrival()`'s
   window comparison in `src/lib/engine.ts`; any other hit is a violation).
6. **Purity**: engine.ts imports only `./priors` and `./types`; no
   `Date.now()`, `window`, fetch, or storage.
7. **Running-block honesty**: after replan, only the in-flight step retains
   `startedAt`; every rebuilt step has `finishedAt === undefined`.
8. **Guess sentinels**: `guessMinutes`/`driveGuessMinutes`/`walkGuessMinutes`
   of 0 stay unscored end-to-end.

Check 1–4 with a small Node script against the built functions, or by driving
the app per the `verify` skill; the invariant list in `architecture-contract`
is the superset that reviews check against.

## Provenance & maintenance

- Distilled from: `src/lib/engine.ts`, `src/lib/priors.ts`,
  `src/lib/types.ts`, `src/app/plan/page.tsx`,
  `src/app/execute/page.tsx` (replan call sites),
  `src/lib/calibration.ts` (`planningMinutes`), plus PR history #5–#11
  (midnight rollover, drive-taskId scoping, p75 planning numbers).
- Authored 2026-07-07, verified against HEAD `055b144`.
- Update this skill when: `TransitMode`/`TransitDetails` gains a member,
  `BUFFERS` or `TASK_PRIORS` values change, `anchorTime`/`rollBeforeArrival`
  or `rebuildRemaining` semantics change, the `lock()` slug rewrite moves,
  or a live API lands upstream of the engine.
- Re-verify core claims: (1) `npm run build` (type-level truth of the
  unions/switch); (2) read `travelChain()` + `BUFFERS` side by side against
  the tables above; (3) drive one transit-mode trip planned at 23:00 for a
  00:30 arrival per the `verify` skill and confirm the departure anchors
  tonight, not tomorrow.

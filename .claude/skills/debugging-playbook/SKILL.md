---
name: debugging-playbook
description: Symptom → diagnosis → fix runbook for Anchor's recurring failure classes (blank pages, silent cues, missing pushes, skewed medians, stuck levels, wrong times, stale deploys) — load when something is broken and you need to find out why.
---

# Debugging playbook

Read `anchor-orientation` first if you don't know what Anchor is. Before any fix, check the invariants in `architecture-contract`; before merging, run `validation-and-qa`.

## Method: reproduce before you touch code

There is no unit-test framework, on purpose. Correctness is proven by driving the real app headlessly with a controlled clock — the `verify` skill is the canonical harness (Playwright, `/opt/pw-browsers/chromium`, `page.clock.install`). Reproduce the symptom there first; a bug you can't reproduce under a controlled clock is usually a timezone/DST assumption or a stale-state artifact.

Where each subsystem keeps its state:

| Subsystem | State | Location |
|---|---|---|
| Trip / logs / debriefs / settings / solo | localStorage keys `anchor:trip`, `anchor:logs`, `anchor:debriefs`, `anchor:settings`, `anchor:lastTasks`, `anchor:solo` | `src/lib/store.ts` (KEYS) |
| In-page cue dedup | page-lifetime `firedCues` ref Set | `src/app/execute/page.tsx` |
| Push schedule (server) | `globalThis.__anchorPush` Map, persisted to `.data/push.json` | `src/lib/push-server.ts` |
| Offline shell | Cache Storage `anchor-v1` | `public/sw.js` |

Nothing logs to a backend. `console.warn("[push] send failed", …)` in `push-server.ts tick()` is the only server-side trace.

## Debugging on a real Android device

Headless repro is the first step, but several behaviors are
installed-PWA-specific and cannot be observed headlessly (`new
Notification()` throwing, vibration, wake lock, install banner). When the
report is "works on desktop, broken on my phone":

1. Enable Developer options → USB debugging on the phone; connect via USB.
2. On desktop Chrome open `chrome://inspect#devices`, find the installed
   PWA's window (it lists as a Chrome tab/WebView), click **inspect**.
3. You now have full DevTools against the live app: read the `anchor:*`
   localStorage keys, watch the console, check the service worker state —
   exactly as in §9 below.
4. Notification behavior differs installed-vs-tab (§2 item 4): a phone
   repro is mandatory before declaring any notification bug fixed. See
   `release-and-deploy` §6 for the platform matrix (iOS is unvalidated).

## 1. Blank page or hydration mismatch on load

**Symptom**: a route renders nothing, or React logs a hydration error.

Ranked causes:
1. **A ready/trip sentinel was removed.** Pages are prerendered client components; they render `null` until a mount effect loads localStorage (`if (!ready) return null` in `src/app/page.tsx` `Pulse`; `if (!trip) return null` in `src/app/execute/page.tsx`). Removing the sentinel makes the server render real content against empty state → mismatch.
2. **A `useState` initializer reads localStorage without the guard.** The pattern is `useState(() => typeof window === "undefined" ? fallback : loadSettings().…)` (see `checklist` and `level` in execute page). A bare `loadSettings()` initializer breaks the server render.
3. **Legit null, not a bug**: the phase guard bounced you (see §9) — the page rendered `null` then `router.replace("/")` ran.

`src/lib/store.ts` `read()` already guards `typeof window` and try/catches `JSON.parse` — corrupted localStorage falls back to defaults, it does not blank the page. Fix must preserve both hydration patterns; note `react-hooks/set-state-in-effect` is intentionally OFF for this (see `nextjs-16-contract`).

## 2. Cues not firing while the app is open

**Symptom**: no notification/vibration on `/execute` when a step is due.

Check in order (`src/lib/notify.ts` + `src/app/execute/page.tsx`):
1. **Level fading — by design.** `cueForStep()` returns `null` at level ≥ 4, and at level 3 for everything except the final staging step. Check `anchor:settings`.level before suspecting a bug.
2. **Permission.** `fireCue()` silently no-ops unless `Notification.permission === "granted"` (vibration still fires — a buzz without a banner means permission, not logic).
3. **Dedup.** The execute page fires each `cue.key` once per page lifetime via the `firedCues` ref. Keys encode the nag rung (`missed-<stepId>-<nag>`, `NAG_EVERY_MIN = 3`), so escalation still climbs. `confirmReplan()` calls `firedCues.current.clear()` — any NEW code path that rewrites the timeline must also clear it, or rebuilt steps reuse fired keys and stay silent. Conversely the Set dies on reload, so a refresh re-fires the current cue — expected.
4. **Android delivery path.** On installed Android PWAs `new Notification()` THROWS; `fireCue()` prefers `serviceWorker.getRegistration().showNotification()` and falls back to the constructor only when no registration exists (desktop tab). If notifications work on desktop but not installed-Android, suspect the SW registration (§8), not `notify.ts`.

Headless repro: verify skill "Notifications" — `grantPermissions(["notifications"])`, stub BOTH `ServiceWorkerRegistration.prototype.showNotification` and `window.Notification` via `addInitScript`. `cueForStep` is pure — you can also call it directly with a synthetic `now`/`level`.

## 3. Push cues not arriving with the app closed

**Symptom**: no wake-up notification after closing the app. Walk the pipeline (full map: `notification-pipeline`):

1. **VAPID env.** `pushEnabled()` (`src/lib/push-server.ts`) requires BOTH `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`; without them `/api/push/sync` returns 503 `{enabled:false}` and the client (`src/lib/push-client.ts`) no-ops entirely. This is the designed degraded mode — UI must not promise wake-ups (`syncPushSchedule` returns false; Lock's armed copy keys off it).
2. **Hosting.** The 30s send loop (`ensurePushLoop`, booted by `src/instrumentation.ts` only when `NEXT_RUNTIME === "nodejs"`) runs inside the Next server process. On serverless (Vercel) it only runs while an instance is warm and `.data/push.json` is not durable — closed-app cues need a persistent `next start` host. This is a platform limit, not a bug to "fix" with hacks.
3. **Cue built at all?** `buildPushCues()` returns `[]` at level ≥ 4 or when `trip.phase` is not `"executing"`/`"locked"`, and drops anything ≤ `now + 5s`. Client caps at 55 soonest, server (`src/app/api/push/sync/route.ts`, `MAX_CUES = 60`) at 60 — on long plans far-future nag rungs are silently dropped, soonest kept.
4. **Sent but dropped.** `tick()` drops cues older than 10 min (`STALE_MS` — a pre-restart "leave now" must never fire mid-afternoon) and sends with `TTL: 180` — a device offline > 3 min at send time never sees it. A 404/410 from the push service deletes the whole entry (expired subscription). Recovery is NOT guaranteed: `getSubscription(true)` (`src/lib/push-client.ts`) reuses whatever subscription the browser returns and only subscribes anew when the browser reports none — a browser that keeps handing back a dead subscription re-posts it and gets 410-dropped again (there is no `unsubscribe()` or `pushsubscriptionchange` handler).
5. **Schedule cleared.** Every trip mutation re-posts the full schedule replace-not-merge; `toDebrief()`/discards call `clearPushSchedule()` (empty list clears). Inspect `.data/push.json` to see what the server actually holds.

Headless repro without a real push service: verify skill "Web push" (fake subscription + local HTTP listener + `PUSH_TICK_MS=1000`). Any fix must keep the tag namespace shared with in-page cue keys — that is what lets the OS collapse duplicates when both paths fire.

## 4. Medians or clock score look wrong

**Symptom**: `/stats` score implausible, or a task median obviously skewed.

The honesty of calibration rests on four interlocking guards — check which one leaked:
1. **Guess-0 sentinel.** `guessMinutes: 0` means "no blind guess" (quick plan, standard-times hatch, accepted travel suggestion). `guessFor()` in `src/app/execute/page.tsx` returns null for 0; `scorableLogs()` in `src/lib/calibration.ts` excludes them from scoring; `guessedReps()` in `src/lib/graduation.ts` excludes them from level reps. A leak (0 treated as a real guess, or a real guess stored as 0) skews score AND levels.
2. **Sub-15s guard.** `finish()` only `appendLog`s when `elapsedSec >= 15` — click-throughs must never become training data. Headless drivers must `fastForward("00:20")` inside each block or nothing logs.
3. **Quantization rule.** `scorableLogs()` also requires `max(guessMinutes, actualMinutes) >= 5` — a 2-min task measured at 1:20 is ±50% pure rounding noise. Don't "fix" a low score by scoring short tasks.
4. **Actual-start preservation.** `rebuildRemaining()` (`src/lib/engine.ts`) keeps `startedAt` on the block already in flight (`kept[i] === remaining[0]`) — resetting it would re-log a 15-min shower as 2 min. The `start(backdateMinutes)` buttons ("Already doing it — ~2/5m ago") exist for the same reason: a late Start tap under-counts actuals and biases medians optimistic.

Note `personalMedian()` uses the last 5 logs (`WINDOW`) after `MIN_LOGS_FOR_HISTORY = 5`, on `actualMinutes`; `planningMinutes()` is p75 of the last 8 — median is display/calibration, p75 is what plans are filled with. Both learning from actuals regardless of guess is correct behavior. Deeper math: `calibration-and-graduation`.

## 5. Level stuck, or dropped unexpectedly

**Symptom**: user meets the visible score but never promotes; or a level fell after an on-time day.

- **Stuck**: `earnedLevel()` (`src/lib/graduation.ts`) is a three-gate AND — `calibrationScore ≥ minScore` AND `guessedReps ≥ minLogs` AND `onTimeStreak ≥ minStreak` (L2: 65/10/3, L3: 80/25/5, L4: 90/50/10). The usual culprit is reps: `guessedReps()` counts only logs with `guessMinutes > 0`, so a quick-plan-heavy user accumulates raw logs but no reps. `/stats` `levelProgress` shows have/need per gate — check there first. Also: `stepToward()` moves ONE step per debrief; a user earning L3 from L1 needs two debriefs.
- **Dropped**: demotion requires `earned < current` AND `wasLate`; the debrief page passes `wasLate = delta > 0` (`src/app/debrief/page.tsx` `save()`). If an on-time arrival ever costs a level, someone changed `>` to `>=` or broke the gate — this is the anti-punishment-spiral invariant (one late day must not cascade 4→1); restore it, don't work around it.
- Only two mutators of `settings.level` exist: Debrief `save()` and Solo `arrived()`. Any other writer is a bug.

Repro: seed `anchor:logs`/`anchor:debriefs` in localStorage per the verify skill "Graduation" section.

## 6. Timeline times wrong (wrong day, wrong start)

**Symptom**: a step starts a day off, or the whole plan is shifted.

- **Day rollover**: `/plan` builds `arrivalDate` with `timeOnSameDay(arrivalTime, now)` then rolls past times to tomorrow via `d.setDate(d.getDate() + 1)` — calendar day, NOT `+24h` of ms (a DST weekend would land an armed airport run an hour off). `/solo` `begin()` rolls the same way. Any new rollover code must use `setDate`.
- **Transit/pickup anchors**: `rollBeforeArrival()` (`src/lib/engine.ts`) forces a departure/pickup clock-time within 24h BEFORE the arrival — without it, planning at 23:00 for a 00:30 arrival puts the 23:45 bus a day late.
- **"Everything is N minutes early"**: not a bug — `buildTimeline()` anchors on `targetArrival = arrival − earlyBufferMinutes` (default 10, `anchor:settings`). "Early is the new on time."
- **Fixed offsets you don't recognize**: the `BUFFERS` table in `src/lib/priors.ts` (parking 10, walkToCar 3, doorstepStaging 5, pickupStaging 10, platform 3, walkArrival 3, curbside 3) is injected by `travelChain()` per mode.
- Replans keep the anchor: `rebuildRemaining()` walks backward from the ORIGINAL chain end. If a replan moved the arrival, that's the bug. Full engine walkthrough: `timeline-engine`.

## 7. Drift pill wrong on /execute

**Symptom**: pill says "ahead" right after starting a late block, or screams "behind" for tomorrow's plan.

The math lives inline in `src/app/execute/page.tsx`:
- **Running**: `driftMin = max(now, startedAt + plannedMinutes) − endsAt`. Projected finish, deliberately — tapping Start on a late block must never flip the pill to "ahead". If it does, someone replaced the projection with instantaneous `now − startsAt`.
- **Pending**: `driftMin = −minutesUntil(step.startsAt, now)`; `behind` at ≥ 1, `ahead` at ≤ −1.
- **Neutral far-future**: `!running && driftMin <= −120` → "Starts much later" pill (an armed next-morning plan is not "1000 min ahead").
- "Replan from now" appears only when `canReplan` = behind ≥ 3 min AND prep steps remain.

## 8. Stale app after deploy

**Symptom**: users see the old UI after a release.

The design is: navigations are network-first with cache fallback, `/_next/static/` is cache-first (hashed, immutable), the SW file itself is never cached — so a deploy propagates on the next online navigation. Check, in order:
1. `public/sw.js` fetch handler still network-first for `request.mode === "navigate"`.
2. `next.config.ts` `headers()` still serves `/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` — lose this and browsers pin the old worker for a day.
3. `src/components/sw-register.tsx` still registers with `updateViaCache: "none"`.
4. If you changed cached-asset semantics, bump `CACHE = "anchor-v1"` in `sw.js` — `activate` deletes all caches with other names, which is the only purge mechanism.

Deploy checklist: `release-and-deploy`.

## 9. State machine stuck (page keeps bouncing to /)

**Symptom**: every route redirects home, or a page redirects away instantly.

`src/app/page.tsx` (`Pulse`) is the dispatcher: its mount effect `router.replace()`s into `PHASE_ROUTE[trip.phase]` for any non-done trip. Each consumer page enforces its own guard and bounces to `/` on mismatch (e.g. execute requires `phase === "executing"`). Note `PHASE_ROUTE` has no `"done"` entry — a done trip rests on Pulse until the next plan.

A bounce loop means `anchor:trip` holds a phase the target page rejects (usually a hand-edited or half-migrated trip). To inspect/reset safely in DevTools → Application → Local Storage:
- Read `anchor:trip` and check `.phase` against `"locked" | "executing" | "debrief" | "done"` (a persisted trip is never written as `"planning"`).
- To reset: `localStorage.removeItem("anchor:trip")` (exactly what `clearTrip()` does). NEVER touch `anchor:logs` or `anchor:debriefs` — they are the append-only training record; the app itself has no code path that clears them.
- A hand-cleared trip skips `clearPushSchedule()` — the server keeps the full remaining schedule (up to 55 cues) and each still fires at its scheduled time. The 10-min stale drop only discards cues already past due (the post-restart case), not future ones. So after a hand-reset, also clear the schedule: call `clearPushSchedule()` from the app (or delete `.data/push.json` with the server stopped — on a running server the in-memory Map just rewrites it); the next trip's sync replaces it in any case. Same applies to any new exit path you add: call `clearPushSchedule()`.
- `anchor:solo` is a parallel machine; clearing the trip does not touch it.

## 10. Build or lint fails in ways your training data won't explain

This repo is Next.js 16 — several failures look like environment problems but are version semantics (full contract: `nextjs-16-contract`; docs bundled at `node_modules/next/dist/docs/`, changelog `01-app/02-guides/upgrading/version-16.md`):
- **`next build` fails after touching `next.config.ts`**: Turbopack is the default builder; a `webpack:` block breaks the build. Turbopack config is top-level `turbopack: {}`.
- **`next lint` not found**: removed in 16. `npm run lint` runs `eslint` directly against flat-config `eslint.config.mjs`. Do NOT add `.eslintrc*` or `extends: "next/core-web-vitals"` strings.
- **Build passed but code is unlinted**: `next build` no longer lints; run `npm run lint` separately. It does still type-check.
- **`react-hooks/set-state-in-effect` errors on your new page**: the rule is OFF in `eslint.config.mjs` on purpose (mount-effect localStorage hydration). Follow the existing pattern instead of re-enabling it.

## Provenance & maintenance

- Distilled from: `src/lib/notify.ts`, `src/lib/push-client.ts`, `src/lib/push-server.ts`, `src/lib/engine.ts`, `src/lib/calibration.ts`, `src/lib/graduation.ts`, `src/lib/store.ts`, `src/lib/priors.ts`, `src/app/page.tsx`, `src/app/execute/page.tsx`, `src/app/plan/page.tsx`, `src/app/debrief/page.tsx`, `src/app/api/push/sync/route.ts`, `src/instrumentation.ts`, `public/sw.js`, `next.config.ts`, `src/components/sw-register.tsx`.
- Authored 2026-07-07, verified against HEAD `055b144`.
- Update this skill when: cue keys/tags or level-fading rules change (`notify.ts`, `push-client.ts`); logging guards or `scorableLogs` thresholds change (`calibration.ts`, execute `finish()`); graduation gates or `stepToward` change; the phase machine or localStorage keys change (`store.ts`, `types.ts`); the SW cache name or `/sw.js` headers change; Next.js is upgraded.
- Re-verify core claims: (1) `npm run build && npm run lint` both pass; (2) `grep -n "STALE_MS\|TTL: 180\|MAX_CUES\|slice(0, 55)" src/lib/push-server.ts src/app/api/push/sync/route.ts src/lib/push-client.ts` still shows 10-min drop, TTL 180, caps 60/55; (3) `grep -n "elapsedSec >= 15\|>= 5\|guessMinutes > 0" src/app/execute/page.tsx src/lib/calibration.ts src/lib/graduation.ts` still shows the honesty guards.

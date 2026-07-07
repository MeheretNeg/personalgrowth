---
name: notification-pipeline
description: Runbook for Anchor's two-path cue system — the in-page escalation ladder, the Web Push path, and the service worker; load before changing any cue, notification, escalation timing, or exit path so you don't break level fading, dedup, or the honesty rules.
---

# Notification pipeline

Two cue engines run in parallel and are BOTH required:

1. **In-page ladder** — `src/lib/notify.ts` driven by a 1-second tick on
   `src/app/execute/page.tsx`. Works only while the page is open: the OS
   suspends page timers when the app is closed.
2. **Web Push** — `src/lib/push-client.ts` → `POST /api/push/sync`
   (`src/app/api/push/sync/route.ts`) → `src/lib/push-server.ts` send loop →
   `public/sw.js` `push` handler. Covers the closed-app case.

They deliberately share one key/tag namespace (`headsup-<stepId>`,
`missed-<stepId>-<n>`, `overtime-<stepId>-<n>`): the in-page `Cue.key`
becomes the notification `tag`, and push cues reuse the same tags, so when
both paths fire the OS collapses them into ONE notification. Any new cue
type MUST keep this property — same tag string from both engines for the
same semantic moment.

Both engines implement the same graduation fade (see the
`calibration-and-graduation` skill): level ≥ 4 → no cues at all; level 3 →
only the final-staging ("out the door") cues; levels 1–2 → full ladder.
The fade is doctrine (the app must do less as the user improves) — never
"fix" a missing cue by removing the level check.

## In-page ladder (`src/lib/notify.ts`)

`cueForStep({step, running, isFinalStaging, now, level})` is pure — returns
the single `Cue | null` due right now. The execute page calls it every
second and dedupes on `cue.key` via `firedCues` (a `useRef<Set<string>>`,
execute page ~line 55) before calling `fireCue`.

Tiers (time math via `minutesUntil()` in `src/lib/engine.ts` — pure epoch
difference, timezone-safe):

| State | Condition | Key | Urgency |
|---|---|---|---|
| Heads-up | not running, `0 < until ≤ 2` min before `step.startsAt` | `headsup-<stepId>` | info |
| It's time / missed | not running, `until ≤ 0`; `nag = floor(lateBy/3)` (`NAG_EVERY_MIN = 3`) | `missed-<stepId>-<nag>` | critical if `isFinalStaging \|\| nag ≥ 2`, else warn |
| Overtime | running, past planned end | `overtime-<stepId>-<nag>` | critical if `nag ≥ 1`, else warn |
| Door-critical | running + `isFinalStaging`, past planned end | `overtime-<stepId>-<nag>` ("OUT THE DOOR") | always critical |

The nag counter inside the key is what makes escalation re-fire: each
3-minute rung is a new key, so the dedup Set lets it through.

**Overtime is anchored to the ACTUAL start**: planned end =
`step.startedAt + step.plannedMinutes`, falling back to `step.endsAt` only
when `startedAt` is absent. This matches the decay bar — an early starter
who runs long still gets nagged. Do not switch it to schedule time.

**Dedup lifetime**: `firedCues` is page-lifetime — a reload can re-fire a
cue (the OS tag then collapses the duplicate). `confirmReplan()` on the
execute page calls `firedCues.current.clear()` because a replan mints new
step IDs/times; keep that clear if you touch replan.

`fireCue(cue)` delivery, in order:
1. `navigator.vibrate` per urgency: info `[80]`, warn `[150,80,150]`,
   critical `[250,100,250,100,500]`. Best-effort, fires even without
   notification permission.
2. No-op unless `Notification.permission === "granted"`.
3. Prefers `serviceWorker.getRegistration().then(reg => reg.showNotification(...))`.
   **This ordering is load-bearing: on installed Android PWAs
   `new Notification()` THROWS** — only the SW path shows anything there.
   The constructor is the fallback for desktop tabs before the SW is ready,
   and it is itself wrapped in try/catch.
4. `requireInteraction: true` when urgency is critical; `tag: cue.key`.

`requestNotifyPermission()` returns a boolean and never throws; `denied`
short-circuits to `false` without prompting.

## Push path (client)

`buildPushCues(trip, level, now)` in `src/lib/push-client.ts` is pure and
**schedule-anchored** (locked `startsAt`, not Start taps — nobody taps with
the app closed). Rules:

- Returns `[]` when `level ≥ 4` or `trip.phase` is not `"executing"` or
  `"locked"` (`"locked"` covers armed starts — the first push IS the
  wake-up call).
- Horizon = `now + 5s`; nothing is ever scheduled into the past.
- Debrief loop-closers "Did you make it?" at `trip.arrivalTime` +5 and
  +25 min, tags `debrief-<tripId>-<i>`. These survive going out the door
  and close the learning loop if the app never reopens; they are cleared
  by `clearPushSchedule()` on debrief entry.
- For the currently running step (`startedAt` set): `NAG_RUNGS = 3`
  overtime rungs spaced `NAG_EVERY_MIN = 3` min from the actual start.
- For future steps: heads-up at `startsAt − 2 min` + 3 "it's time" rungs
  at `startsAt + n*3 min`. Level-3 final-only fade mirrored via `continue`.
- Sorted by `at`, then `slice(0, 55)` — the SOONEST cues win; far-future
  nag rungs are silently dropped on long plans. Stay under the server's
  cap of 60 if you add cue types.

**Sync contract** (`src/app/api/push/sync/route.ts`, `runtime = "nodejs"`,
`MAX_CUES = 60`):
- No VAPID key pair on the server → `503 {enabled:false}`.
- Bad JSON, missing `subscription.endpoint`, non-array `cues`, or any cue
  missing `at`/`title`/`tag` (or unparseable `at`) → `400`. `body` is NOT
  validated.
- Valid → **replace-not-merge**: the posted list becomes the whole schedule
  for that subscription endpoint; an empty list clears it. Server re-sorts
  and caps at 60, returns `200 {enabled:true, scheduled:n}`.

Replace-not-merge keeps the server dumb and the client authoritative — the
client re-posts the full remaining schedule on every transition, so cues
the user already handled disappear. Never add a merge/append mode.

**Call-site map** (verify with grep before trusting):

| Where | Call | When |
|---|---|---|
| `src/app/lock/page.tsx` `begin()` | `requestNotifyPermission().then(() => syncPushSchedule(next, level))` | Timeline locked → begin |
| `src/app/lock/page.tsx` `arm()` | `requestNotifyPermission()` then `syncPushSchedule`; result stored as `pushOk` | Arming a delayed start |
| `src/app/lock/page.tsx` `discard()` | `clearPushSchedule()` | Plan discarded from lock |
| `src/app/execute/page.tsx` `update()` | `syncPushSchedule(next, level)` | EVERY trip save (start, finish, replan) |
| `src/app/execute/page.tsx` `toDebrief()` / `discardTrip()` | `clearPushSchedule()` | Arrival / discard |
| `src/app/debrief/page.tsx` `save()` | `syncCues([planNudgeCue(new Date())])` | Debrief saved |

`planNudgeCue` schedules ONE evening nudge at **20:30 device-local time**
(`setHours(20,30,0,0)`, rolled to tomorrow if already past), tag
`plan-nudge`. This is the only local-time computation in the pipeline —
every other `at`/key is an absolute ISO instant.

**Honesty contract**: `syncPushSchedule` returns `false` whenever no
closed-app path exists (no `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, no SW/PushManager
support, permission not granted, or the server rejected the POST). Callers
MUST NOT promise wake-ups unless it returned `true` — the armed screen in
`lock/page.tsx` shows "You can close the app" only when `pushOk` is truthy,
otherwise "Keep this screen open, or set a phone alarm". If you add UI that
mentions closed-app behavior, gate the copy the same way. This is the
"honest copy" principle (see `architecture-contract`).

`getSubscription(create)` subscribes with `userVisibleOnly: true` and
`urlBase64ToUint8Array(NEXT_PUBLIC_VAPID_PUBLIC_KEY)`; `syncPushSchedule`
creates a subscription if needed, `syncCues`/`clearPushSchedule` only reuse
an existing one.

## Push path (server loop, `src/lib/push-server.ts`)

- State lives in `globalThis.__anchorPush` (`{entries: Map<endpoint,
  {subscription, cues}>, timer, ready}`) — survives dev route-module
  reloads and multiple importers. Persisted to `.data/push.json` on every
  dirty tick and on `setSchedule`.
- `pushEnabled()` = BOTH `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and
  `VAPID_PRIVATE_KEY` set (see `.env.example`). Everything no-ops without
  them.
- `ensurePushLoop()` is idempotent: sets VAPID details (subject defaults to
  `mailto:anchor@localhost`, override via `VAPID_SUBJECT`), loads the JSON
  file once, starts `setInterval(tick, TICK_MS)` and `unref()`s it.
  `TICK_MS = Number(process.env.PUSH_TICK_MS) || 30_000`.
- `tick()`: first drops cues older than 10 min (`STALE_MS`) — a "leave now"
  from before a server restart must never fire mid-afternoon. Then sends
  due cues via `webpush.sendNotification(sub, JSON.stringify(cue),
  {TTL: 180, urgency: "high"})`. Sent cues are removed whether or not the
  send succeeded. HTTP 404/410 from the push service → the whole entry is
  deleted (expired subscription; the client re-subscribes on its next
  `syncPushSchedule`). Empty entries are deleted.
- TTL 180s means a device offline for >3 min when the push is sent never
  receives it — by design (stale "leave now" is noise).
- Boot: `src/instrumentation.ts` `register()` calls `ensurePushLoop()` only
  when `NEXT_RUNTIME === "nodejs"` — so cues scheduled before a restart
  fire without waiting for an incoming request.
- **Serverless caveat**: the loop runs only while an instance is warm and
  `.data/push.json` is not durable there. Closed-app cues need a
  persistent `next start` host. In-page cues are unaffected.

## Service worker (`public/sw.js`)

- Cache name `anchor-v1`; `OFFLINE_URLS = ["/"]`. `install` pre-caches "/"
  and `skipWaiting()`; `activate` deletes any cache ≠ `anchor-v1` and
  `clients.claim()`. If you change cached asset shapes, bump the cache name.
- `fetch`: same-origin GET only. Navigations are **network-first** with
  cache fallback then "/" offline shell — never serves a stale app after a
  deploy. `/_next/static/` is cache-first (content-hashed, immutable).
  Everything else passes through.
- `message` `{type:"notify"}` → `registration.showNotification` (the page's
  fallback message path into the SW).
- `push` → `event.data.json()` → `showNotification(data.title ?? "Anchor",
  {body, tag, requireInteraction})`. The push payload IS the `PushCue` JSON.
- `notificationclick` → focus an existing window, else
  `openWindow("/execute")`.
- Registered by `src/components/sw-register.tsx`:
  `register("/sw.js", {scope: "/", updateViaCache: "none"})`.
- `next.config.ts` `headers()` serves `/sw.js` with
  `Cache-Control: no-cache, no-store, must-revalidate` plus a
  `default-src 'self'` CSP. The worker file itself must never be cached or
  users stick on an old SW after a deploy — do not remove these headers.

## Modification recipes

**Add a new cue type**
1. Pick ONE tag/key scheme and use it in BOTH engines (`cueForStep` key =
   push cue `tag`) so the OS dedups when both fire. Include a rung counter
   in the key if it should re-fire on escalation.
2. Apply the level fade in both places (`level >= 4` → nothing; `level ===
   3` → final-staging only) unless the owner explicitly exempts it.
3. In `buildPushCues`, respect the `horizon` guard and remember the 55/60
   caps keep the soonest — a low-priority far-future cue may get dropped.
4. Route sends through `fireCue` (in-page) — never call `new Notification()`
   directly (Android PWA throw).
5. Cue copy is subject to the no-shame/honest-copy review — see
   `change-control`.

**Change escalation timing**: `NAG_EVERY_MIN` exists in TWO files
(`src/lib/notify.ts` and `src/lib/push-client.ts`) and must stay equal, or
the two ladders desync and tags stop collapsing. `NAG_RUNGS` (push only)
bounds how many rungs get scheduled closed-app.

**Add a new exit path** (any way a trip stops being live — discard, arrive,
new-plan-overwrites): it MUST call `clearPushSchedule()`, or the user gets
"OUT THE DOOR" pushes for a dead plan. Check both existing discard sites
(lock + execute) as templates. This is the most common regression.

**Touching `/sw.js`**: keep it dependency-free plain JS (it is served
statically from `public/`), and keep the `next.config.ts` no-store headers.

## Testing each layer

No unit-test framework exists ON PURPOSE — verify by driving (see the
`verify` skill, which is canonical; `validation-and-qa` has the fixture
cookbook).

- Pure layer: `cueForStep` and `buildPushCues` are pure — exercise them by
  controlling `now` and `level` through the app with Playwright's fake
  clock.
- In-page cues headless: stub BOTH
  `ServiceWorkerRegistration.prototype.showNotification` and
  `window.Notification` via `addInitScript`, and
  `grantPermissions(["notifications"])` — recipe in the `verify` skill.
- API: `POST /api/push/sync` without VAPID env → 503; with keys, malformed
  bodies → 400; valid → `{enabled:true, scheduled:n}`.
- Full send path without a real browser push service: the fake-endpoint
  recipe (generateVAPIDKeys, `PUSH_TICK_MS=1000`, fake P-256 subscription,
  local HTTP listener receiving the aes128gcm POST) lives in the `verify`
  skill's "Web push" section — do not duplicate it here.
- Debugging silent cues or missing pushes: `debugging-playbook`.

## Provenance & maintenance

- Distilled from: `src/lib/notify.ts`, `src/lib/push-client.ts`,
  `src/lib/push-server.ts`, `src/app/api/push/sync/route.ts`,
  `public/sw.js`, `src/instrumentation.ts`,
  `src/components/sw-register.tsx`, `next.config.ts`, plus the call sites
  in `src/app/{lock,execute,debrief}/page.tsx`.
- Authored 2026-07-07, verified against HEAD `055b144`.
- Update this skill when: cue keys/tags or `NAG_EVERY_MIN`/`NAG_RUNGS`
  change; the sync API contract (status codes, caps, replace semantics)
  changes; level-fade thresholds move; a trip exit path is added; the SW
  cache name or fetch strategy changes; push hosting moves off a
  persistent Node process.
- Re-verify core claims:
  1. `grep -n "NAG_EVERY_MIN\|slice(0, 55)\|MAX_CUES" src/lib/notify.ts src/lib/push-client.ts src/app/api/push/sync/route.ts`
  2. `grep -rn "clearPushSchedule\|syncPushSchedule\|syncCues" src/app`
  3. `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3100/api/push/sync` after `npm run build && npm run start -- --port 3100` (expect 503 without VAPID keys).

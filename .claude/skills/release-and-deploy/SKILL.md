---
name: release-and-deploy
description: Ship-it runbook — Vercel deploy mechanics, PWA/service-worker update behavior, VAPID/env configuration, and the platform caveats that determine what actually works in production; load before deploying, changing sw.js/next.config.ts headers, or debugging "users see the old app / no push in prod".
---

# Release & deploy

Anchor is a Next.js 16 PWA deployed on Vercel. There is no CI, no staging
environment, and no test runner — the pre-push gate IS the release gate.
Read `anchor-orientation` first if you don't know what the app is.

## 1. Deploy path

Every push to `main` auto-deploys via Vercel (repo `MeheretNeg/personalgrowth`,
imported at vercel.com/new — see `README.md` "Deploy on Vercel"). There is no
`.github/` directory and no other pipeline: **whatever you push to `main` is
production within minutes.**

Before pushing, run the full gate (details and per-area checklists in the
`change-control` skill; headless-drive recipes in the `verify` skill):

1. `npm run build` — Turbopack build + TypeScript check. Must pass.
2. `npm run lint` — flat-config ESLint (`next lint` is removed in Next 16;
   see `nextjs-16-contract`).
3. Headless-drive the flows your diff touches per the `verify` skill
   (`npm run start -- --port 3100`, Playwright against the production build).

## 1b. When a deploy goes bad

There is no staging — assume you will ship a bad build eventually. The
runbook for the minutes after:

1. **Fastest rollback:** Vercel dashboard → the project → Deployments →
   pick the last good deployment → **Instant Rollback** (or "Promote to
   Production"). Env vars are unaffected. Production is back before you
   have diagnosed anything.
2. **Durable fix:** `git revert <bad-sha> && git push origin main` — never
   force-push `main`; installed PWAs and the Vercel deploy history both
   assume forward-only history.
3. **Where to look:** Vercel deploy logs for build failures that did not
   reproduce locally (env differences, missing vars); Functions logs for
   `/api/push/sync` 500s. Locally, reproduce with `npm run build &&
   npm run start` — not `npm run dev`.
4. **Propagation:** once production serves the good build again, the SW
   update mechanics (section 2) deliver it to installed PWAs on their next
   online open — no user action needed. If the bad deploy changed
   `public/sw.js` caching behavior itself, re-read section 2 before
   assuming recovery is automatic.

## 2. How users get the new app (PWA update mechanics)

Four mechanisms combine so an installed user gets the new build on next open,
with no "clear your cache" support burden. Breaking any one of them strands
users on stale code:

| Mechanism | Where | What it does |
|---|---|---|
| `/sw.js` served `Cache-Control: no-cache, no-store, must-revalidate` | `next.config.ts` `headers()` | Browser refetches the worker bytes on every registration check — a changed sw.js is seen immediately |
| `updateViaCache: "none"` | `src/components/sw-register.tsx` `SwRegister` (mounted in `src/app/layout.tsx`) | HTTP cache is bypassed for worker script fetches |
| `skipWaiting()` (install) + `clients.claim()` (activate) | `public/sw.js` | New worker takes over open pages immediately instead of waiting for all tabs to close |
| Network-first for `request.mode === "navigate"` | `public/sw.js` fetch handler | Page HTML is always fetched fresh when online; the cache is only an offline fallback (then `/` as offline shell) |

Only same-origin GETs are handled. `/_next/static/` assets are cache-first —
safe because their URLs are content-hashed per build. Everything else passes
through untouched (API POSTs are never intercepted).

**The `anchor-v1` cache name** (`CACHE` constant in `public/sw.js`): the
activate handler deletes every cache whose name ≠ `CACHE`. Normal app deploys
do NOT require a bump — navigations are network-first and new static assets
have new hashed URLs (old ones just sit unused). Bump the name (`anchor-v2`)
when you change what or how the worker caches (fetch-handler logic,
`OFFLINE_URLS`, response formats) or need to force-purge everything cached on
every device. Never rename it casually: the bump discards every previously
cached navigation and static asset; the new worker's install re-caches only
`/` (`OFFLINE_URLS`), so any other cached page is unavailable offline until
revisited online.

**Never add a webpack block to `next.config.ts`** — it makes `next build`
fail under Turbopack (see `nextjs-16-contract`). The `headers()` function is
the correct place for the sw.js headers; do not move them to a proxy/middleware.

## 3. Environment configuration

All env vars, verified against `.env.example` and `src/lib/push-server.ts`:

| Var | Required? | Used by |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Only for Web Push | `push-client.ts` (subscribe) + `push-server.ts` `pushEnabled()` |
| `VAPID_PRIVATE_KEY` | Only for Web Push | `push-server.ts` `pushEnabled()` / `setVapidDetails` |
| `VAPID_SUBJECT` | Optional (`mailto:` or `https:` URL) | `ensurePushLoop()`; defaults to `mailto:anchor@localhost` — set a real contact for production push services |
| `PUSH_TICK_MS` | Optional, testing only | `push-server.ts` `TICK_MS` — send-loop interval, default 30 000 ms. Not in `.env.example`; used by the `verify` skill's fake-push recipe |

Local setup (from `README.md`):

```bash
npx web-push generate-vapid-keys
cp .env.example .env.local   # paste the keys in
```

On Vercel, set the same vars in Project Settings → Environment Variables.
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined into the client bundle at build
time — changing it requires a redeploy. **Rotating the keypair breaks push
for every existing install, with no automatic recovery in the code:**
`getSubscription(true)` (`src/lib/push-client.ts`) returns the browser's
existing old-key subscription as-is — no unsubscribe/re-subscribe path exists
anywhere in `src/` — and the server's `tick()` (`src/lib/push-server.ts`)
drops an entry only on a 404/410 send failure; any other rejection is logged
and the stale entry kept. Affected users regain push only after the browser
invalidates the old subscription or they clear site data. Treat rotation as
a breaking change.

**Keyless deploys are safe.** Without both keys: `POST /api/push/sync`
returns `503 {enabled:false}` (`pushEnabled()` check in
`src/app/api/push/sync/route.ts`), `ensurePushLoop()` returns immediately,
and the client no-ops (`push-client.ts` `getSubscription` returns null
without `NEXT_PUBLIC_VAPID_PUBLIC_KEY`). In-page cues, vibration, and the
execution wake lock still work. `syncPushSchedule()` returns `false` so the
UI never promises closed-app wake-ups it can't deliver — do not change that
contract (see `notification-pipeline`).

## 4. The serverless caveat — state it honestly

The push send loop (`src/lib/push-server.ts` `ensurePushLoop()` →
`setInterval(tick, TICK_MS)`, booted by `src/instrumentation.ts` `register()`
under `NEXT_RUNTIME === "nodejs"`) assumes a long-lived Node process:

- **Persistent host (any `next start` box):** loop runs continuously; state
  in `.data/push.json` survives restarts; `tick()` drops cues >10 min stale
  (`STALE_MS`) so a pre-restart "leave now" never fires mid-afternoon.
  Closed-app cues work as designed here.
- **Vercel serverless:** the loop only runs while an instance is warm, and
  the instance filesystem is not durable — `.data/push.json` does not
  reliably persist between invocations. Closed-app cues are **best-effort**:
  they fire while traffic keeps an instance alive and are silently lost when
  it recycles. In-page cues are unaffected (they run in the browser).

Do not "fix" this by claiming reliability in copy, and do not add a database
without owner sign-off — the no-backend posture is an established design
principle. If reliable closed-app cues become a requirement, the honest
options are a persistent Node host or an external scheduler; label any such
plan as a proposal.

## 5. Production smoke checklist

Run after every deploy (substitute the production origin; locally use
`npm run start -- --port 3100`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://HOST/                       # 200
curl -s https://HOST/manifest.webmanifest                                    # JSON below
curl -s -o /dev/null -w "%{http_code}\n" https://HOST/sw.js                  # 200
curl -sI https://HOST/sw.js | grep -i cache-control                          # no-cache, no-store, must-revalidate
curl -s -X POST https://HOST/api/push/sync -H 'Content-Type: application/json' -d '{}' \
  -o /dev/null -w "%{http_code}\n"   # 503 if keyless (expected), 400 if keys are set
```

Checklist:

1. `/` returns 200 and renders the Pulse dashboard.
2. `/manifest.webmanifest` (generated from `src/app/manifest.ts`) returns
   `"display": "standalone"` and exactly 3 icons: `/icon-192.png`,
   `/icon-512.png`, `/icon-512-maskable.png` (all exist in `public/`).
3. `/sw.js` returns 200 with the no-store Cache-Control header and CSP
   `default-src 'self'; script-src 'self'`.
4. `POST /api/push/sync` matches configuration: **503** `{enabled:false}`
   keyless; with keys set, a `{}` body gets **400** (`subscription and cues
   required`) — proving `pushEnabled()` passed. Either is a healthy deploy;
   a 500 is not.
5. In a browser DevTools → Application → Service Workers: sw.js **activated**
   with scope `/`, cache storage shows `anchor-v1`.
6. On an Android phone: open the URL in Chrome → menu → **Add to Home
   screen** → launches standalone with the `#101423` theme color.

## 6. Platform reality — Android yes, iOS unvalidated

- **Installed Android PWAs cannot use `new Notification()` — it throws.**
  All system cues go through `registration.showNotification`: `fireCue` in
  `src/lib/notify.ts` prefers the service-worker path and falls back to the
  constructor only where it works (e.g. a desktop tab before the SW is
  ready); `public/sw.js` also accepts `{type:"notify"}` messages and handles
  `push` events the same way. Never "simplify" to the constructor.
- Vibration patterns fire per urgency in `fireCue` (`navigator.vibrate`,
  best-effort try/catch).
- The execute page requests a screen wake lock
  (`navigator.wakeLock.request("screen")`, `src/app/execute/page.tsx`) so
  time stays visible during execution while the page is visible.
- **iOS has not been validated.** The README and manifest target Android;
  the only iOS-specific code is the `appleWebApp` metadata block in
  `src/app/layout.tsx` (home-screen meta tags) — nothing iOS-specific exists
  in the notification or service-worker paths. Do not claim iOS support in
  copy or docs until someone actually tests it.

## 7. Known gaps before public release

The owner is aiming for a public release. These are the known gaps between
HEAD and strangers' devices; each row points at the skill that owns the
detail. Remove a row when it ships fixed; if one ships broken,
`failure-archaeology` gains a case.

| Gap | Detail lives in |
|---|---|
| iOS entirely unvalidated | this skill, §6 |
| Closed-app push is best-effort on Vercel serverless | this skill, §4 |
| Armed-screen promise gated only on `pushOk === false` (null on reopen) | `notification-pipeline` (honesty contract), `architecture-contract` |
| "Chop chop." urgency copy still present in `src/lib/notify.ts` | `failure-archaeology` (shame-copy case) |
| `/solo` route not level-gated (home entry card only) | `architecture-contract` |
| No user-facing export/backup — clearing site data destroys the whole training record | `data-model-and-storage`; export recipe in `research-frontier` |

## 8. Never commit

Verified against `.gitignore`:

- `.env*` (only `.env.example` is whitelisted via `!.env.example`) —
  `VAPID_PRIVATE_KEY` in a public repo means anyone can push notifications
  to your users.
- `/.data/` — server-local push schedule state (`push.json` contains live
  subscription endpoints and keys).
- Also ignored: `/.next/`, `/node_modules`, `*.pem`, `.vercel`.

If a private key ever lands in history, rotate the VAPID pair (regenerate,
update Vercel env, redeploy) — do not just delete the commit. Rotation
silently breaks push for all existing subscribers — see section 3.

## Provenance & maintenance

- Distilled from: `README.md`, `next.config.ts`, `public/sw.js`,
  `src/components/sw-register.tsx`, `src/app/manifest.ts`, `.env.example`,
  `.gitignore`, `src/instrumentation.ts`, `src/lib/push-server.ts`,
  `src/lib/push-client.ts`, `src/app/api/push/sync/route.ts`,
  `src/lib/notify.ts`, `package.json`.
- Authored 2026-07-07, verified against HEAD `055b144`.
- Update this skill when any of these change: `next.config.ts` `headers()`,
  the `CACHE` name or fetch strategy in `public/sw.js`, env vars read by
  `push-server.ts`/`push-client.ts`, the 503/400 contract of
  `/api/push/sync`, the deploy target (anything other than Vercel-from-main),
  or first successful iOS validation.
- Re-verify core claims:
  1. `npm run build && npm run lint`
  2. `npm run start -- --port 3100 &` then curl `/`, `/manifest.webmanifest`,
     `/sw.js` (check Cache-Control), and `POST /api/push/sync` with `{}`
     (503 keyless / 400 with keys).
  3. `grep -n "anchor-v1\|skipWaiting\|clients.claim" public/sw.js` and
     `grep -n "PUSH_TICK_MS\|STALE_MS\|pushEnabled" src/lib/push-server.ts`.

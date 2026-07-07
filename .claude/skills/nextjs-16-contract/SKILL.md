---
name: nextjs-16-contract
description: The framework contract — how Next.js 16.2.10 differs from the Next.js in your training data, what this repo already relies on, and which bundled doc to read per task type; load BEFORE writing or reviewing any framework-touching code (pages, routes, config, metadata, instrumentation).
---

# Next.js 16 contract

This repo pins `next` **16.2.10** (`package.json`). Next 16 breaks many
conventions a model learned from Next 13/14/15 code. Confident-but-wrong
framework code is the failure mode this skill prevents. The rule from
`AGENTS.md` is binding:

> Read the relevant guide in `node_modules/next/dist/docs/` before writing
> any code. Heed deprecation notices.

The docs ship inside the package — run `npm install` first or the directory
will not exist. The authoritative diff against your training data is
`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.

## Already live in this repo — do not "fix" any of these

| Fact | Where it lives | What NOT to do |
|---|---|---|
| Turbopack is the default for `next dev` AND `next build`; no `--turbopack` flag | `package.json` scripts | Never add a `webpack: () => {}` block to `next.config.ts` — a custom webpack config makes `next build` **fail** by design. Turbopack config is top-level `turbopack: {}`, not `experimental.turbopack`. |
| `next dev` writes to `.next/dev` (separate from build output) | `tsconfig.json` `include` lists both `.next/types/**/*.ts` and `.next/dev/types/**/*.ts` | Do not remove either glob; dev and build can run concurrently. |
| `next lint` is REMOVED; `next build` no longer lints | `package.json` `"lint": "eslint"` | Never run or script `next lint`. Lint is `npm run lint`, and a passing build does not imply a passing lint. |
| Flat ESLint config only | `eslint.config.mjs`: `defineConfig` + `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript` imports | Do not create `.eslintrc.json` or `extends: "next/core-web-vitals"`. Do not re-enable `react-hooks/set-state-in-effect` — it is off on purpose (mount-effect localStorage hydration; see `ui-conventions`). |
| `instrumentation.ts` `register()` runs once at server boot in ALL runtimes | `src/instrumentation.ts` gates the push-loop import on `process.env.NEXT_RUNTIME === "nodejs"` | Keep node-only imports behind that gate (dynamic `await import`). There is no `experimental.instrumentationHook` flag anymore — do not add one. |
| Metadata/viewport split | `src/app/layout.tsx` exports `metadata: Metadata` AND `viewport: Viewport` separately; `themeColor` lives in `viewport` | Do not put `themeColor`/`viewport` keys inside `metadata` — that is the deprecated pre-15 shape. |
| PWA manifest as a route | `src/app/manifest.ts` returns `MetadataRoute.Manifest`; static (cached) by default | Do not add a `public/manifest.json`; edit `manifest.ts`. |
| Non-GET route handlers are never cached | `src/app/api/push/sync/route.ts` `POST()` (with `export const runtime = "nodejs"`) | Do not add `export const dynamic = 'force-dynamic'` to POST handlers — it is noise. |
| `next.config.ts` typed with `import type { NextConfig }` | `next.config.ts` (also sets `/sw.js` no-cache headers via `headers()` — see `notification-pipeline`) | This is the current form; TypeScript config files are fully supported. |

## Latent traps — patterns not yet used in this repo, get them right the first time

The repo currently has no dynamic routes, no `fetch` calls to external APIs
in server code, no `proxy.ts`, no `next/image`. The first person to add one
of these hits a v16 breaking change. Correct forms:

**1. `params` and `searchParams` are Promises — sync access is fully removed.**
```tsx
// src/app/trip/[id]/page.tsx
export default async function Page(props: PageProps<'/trip/[id]'>) {
  const { id } = await props.params
  const { tab } = await props.searchParams
}
```
`PageProps` / `LayoutProps` / `RouteContext` are globally available type
helpers — generate them with `npx next typegen` (also produced by
`npm run build`). Same applies to `cookies()` / `headers()` from
`next/headers`: always `await` them.

**2. `middleware.ts` is deprecated — the file and export are named `proxy`.**
```ts
// proxy.ts (repo root or src/)
import type { NextRequest } from 'next/server'
export function proxy(request: NextRequest) { /* ... */ }
```
`proxy` runs on the Node runtime only; the `edge` runtime is not supported
in it. Before reaching for proxy at all, note this repo sets response
headers (e.g. for `/sw.js`) via `headers()` in `next.config.ts` — prefer
that for static header needs.

**3. `fetch` is NOT cached by default** (the reverse of Next 13/14 doctrine).
Opt in per call: `fetch(url, { cache: 'force-cache' })`. Plain GET route
handlers are also uncached by default; opt in with
`export const dynamic = 'force-static'`.

**4. `revalidateTag` requires a second argument** (a `cacheLife` profile);
the one-arg form is deprecated and a TypeScript error:
`revalidateTag('trips', 'max')`. `updateTag` and `refresh` exist for
read-your-own-writes semantics.

**5. `cacheComponents: true`** is the top-level flag that replaces
`experimental.ppr` / `experimental.dynamicIO` / `experimental.useCache`.
This repo does NOT enable it — and enabling it flips caching semantics
repo-wide (uncached async access must sit under `Suspense` or the build
throws). Do not turn it on casually; if a doc page assumes Cache
Components, check whether it applies to the non-enabled world first
(`02-guides/caching-without-cache-components.md` is the one that matches
this repo).

**6. `next/image` defaults hardened**: `images.minimumCacheTTL` default is
now 4 hours, `images.qualities` default is `[75]` only, `images.domains`
is deprecated in favor of `remotePatterns`. Repo uses no `next/image`
today; if you introduce it, read the image config docs first.

Also true in v16: the App Router bundles its own React canary regardless of
the `react` in `package.json`; parallel route slots need an explicit
`default.js` or the build fails; Node 20.9+ and TS 5.1+ are required.

## Doc routing table

All paths relative to `node_modules/next/dist/docs/`. Open the doc BEFORE
writing the code.

| Task | Read |
|---|---|
| New page / dynamic route | `01-app/01-getting-started/03-layouts-and-pages.md`; `01-app/03-api-reference/03-file-conventions/page.md`; async-params section of `01-app/02-guides/upgrading/version-16.md` |
| New API route handler | `01-app/01-getting-started/15-route-handlers.md` |
| `next.config.ts` change | per-option file under `01-app/03-api-reference/05-config/01-next-config-js/` (e.g. `headers.md`, `turbopack.md`) |
| Metadata / icons / PWA | `01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`; `01-app/01-getting-started/14-metadata-and-og-images.md`; `01-app/02-guides/progressive-web-apps.md` |
| Instrumentation / boot hooks | `01-app/02-guides/instrumentation.md` |
| Request interception (proxy) | `01-app/01-getting-started/16-proxy.md` |
| Deploy / self-host | `01-app/01-getting-started/17-deploying.md`; `01-app/02-guides/self-hosting.md` (see `release-and-deploy`) |
| Caching behavior | `01-app/02-guides/caching-without-cache-components.md` (matches this repo); `01-app/01-getting-started/08-caching.md` only if `cacheComponents` were ever enabled |
| Upgrading Next itself | `01-app/02-guides/upgrading/version-16.md`; `01-app/02-guides/upgrading/codemods.md` |

## Verification habit

1. Before using any Next.js API you have not already used **in this repo**,
   open its doc file from the table above and confirm the exact signature
   and defaults. Your training-data memory of Next.js is presumed stale.
2. After framework-touching changes, run `npm run build` (Turbopack +
   TypeScript check) and `npm run lint`. Neither implies the other.
3. Prove behavior by driving the built app — see the `verify` skill. There
   is no unit-test framework in this repo, on purpose (see
   `anchor-orientation`).

## Provenance & maintenance

- Distilled from: `AGENTS.md`, `package.json`, `next.config.ts`,
  `eslint.config.mjs`, `tsconfig.json`, `src/instrumentation.ts`,
  `src/app/layout.tsx`, `src/app/manifest.ts`,
  `src/app/api/push/sync/route.ts`, and the bundled docs at
  `node_modules/next/dist/docs/` — primarily
  `01-app/02-guides/upgrading/version-16.md`,
  `01-app/01-getting-started/15-route-handlers.md`,
  `01-app/01-getting-started/06-fetching-data.md`,
  `01-app/02-guides/instrumentation.md`.
- Authored 2026-07-07; verified against HEAD `055b144`.
- Update this skill when: the `next` version in `package.json` changes;
  `next.config.ts`, `eslint.config.mjs`, or `tsconfig.json` structure
  changes; the repo gains its first dynamic route, `proxy.ts`,
  `next/image` usage, or enables `cacheComponents`.
- Re-verify core claims:
  1. `grep '"next"' package.json` — still 16.2.10?
  2. `ls node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
     — docs present (run `npm install` if not)?
  3. `npm run build && npm run lint` — both pass independently.

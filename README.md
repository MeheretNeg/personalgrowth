# Personal Growth

A personal growth tracker built with [Next.js](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com), and [shadcn/ui](https://ui.shadcn.com). Define the dimensions of your life (Spiritual, Mental, Physical, Relational, …), anchor each one with a verse or guiding principle, and capture dated notes as you grow.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/MeheretNeg/personalgrowth)

To connect this repo for instant deployments (every push to `main` goes live, every branch gets a preview URL):

1. Go to [vercel.com/new](https://vercel.com/new) and sign in with your GitHub account.
2. Import the `MeheretNeg/personalgrowth` repository.
3. Vercel auto-detects Next.js — no configuration needed. Click **Deploy**.

From then on, every push deploys automatically.

## Project structure

```
src/
  app/               Next.js App Router pages and layout
  components/
    growth-tracker.tsx   Main tracker feature
    ui/                  shadcn/ui primitives
  lib/
    types.ts         Shared data types (Dimension, Note)
    storage.ts       localStorage persistence
```

Notes are currently stored in the browser's localStorage. A natural next step is wiring up a database (e.g. Vercel Postgres) and auth for sync across devices.

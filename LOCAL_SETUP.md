# Running the app locally

This project is a Vite + React frontend with a [Convex](https://convex.dev)
backend (TypeScript). Authentication is handled by
[Convex Auth](https://labs.convex.dev/auth) (email/password) — everything
runs locally with no external account or service required. See
[BACKEND.md](BACKEND.md) for the backend architecture and why it no longer
depends on Hercules.

## Prerequisites

- Node.js 20+ and pnpm (`npm i -g pnpm` if you don't have it, or
  `corepack enable pnpm`)

## First-time setup

```bash
pnpm install
```

Convex Auth needs a signing key pair and a site URL set on the deployment
before it will push functions. Generate and set them once:

```bash
npx @convex-dev/auth --web-server-url http://localhost:5173
```

This is interactive: it will offer to write `convex/auth.ts`,
`convex/auth.config.ts`, and `convex/http.ts` (already present in this repo —
say no to overwriting, or let it confirm they already match) and will run
`npx convex env set` for you to store `JWT_PRIVATE_KEY`, `JWKS`, and
`SITE_URL` on the deployment.

The first time you run `npx convex dev` (see below) with no existing
`.env.local`, Convex will auto-provision a **local, anonymous deployment** —
no `npx convex login` or Convex account needed — backed by a local binary at
`http://127.0.0.1:3210`.

## Running

In two terminals:

```bash
npx convex dev   # terminal 1 — backend: watches convex/ and pushes on save
pnpm dev          # terminal 2 — frontend: http://localhost:5173
```

Open <http://localhost:5173>, click **Create Account** on the sign-in screen,
and sign up with any email/password (min 8 characters) — this creates a user
directly in your local Convex deployment.

## Troubleshooting

**"A local backend is still running on port 3210"** — an earlier
`convex dev` process didn't get killed (common on Windows/Git Bash, where
stopping the wrapper process doesn't kill the underlying `node` /
`convex-local-backend` processes it spawned). Find and stop them:

```bash
netstat -ano | grep -E ":3210|:3211"    # note the PID in the last column
powershell -Command "Stop-Process -Id <pid> -Force"
```

Then re-run `npx convex dev`.

**Vite falls back to port 5174 (or another port)** — same cause: a stray
Vite process from an earlier run is still holding 5173. Find it with
`netstat -ano | grep :5173` and stop it the same way, or just use whatever
port Vite prints.

## Resetting the local deployment

`.env.local` and the local Convex data live only on this machine. To start
completely fresh, stop both dev servers, delete `.env.local`, and repeat the
first-time setup above — a brand-new local deployment will be provisioned.

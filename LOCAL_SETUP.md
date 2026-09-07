# Running the app locally

This project is a Vite + React frontend with a Convex backend, using
`@usehercules/auth` (OIDC) for sign-in. It was originally scaffolded on the
Hercules platform (see `index.html` — "An app made by https://hercules.app").

Below is exactly what was done to get it running on this machine on
2026-09-07, and what you still need to do to unlock real sign-in.

## Prerequisites found on this machine

- Node.js v22.14.0, npm 11.5.2
- No `pnpm` was installed, even though the project uses it
  (`pnpm-lock.yaml`, `pnpm-workspace.yaml`)
- No `node_modules`, no `.env*` files existed yet

## Steps carried out

1. **Enabled pnpm via Corepack, then installed it globally as a fallback**

   ```bash
   corepack enable pnpm   # failed with EPERM on this machine
   npm i -g pnpm          # used instead — installed pnpm 12.3.4
   ```

2. **Installed dependencies**

   ```bash
   pnpm install
   ```

   This took ~4 minutes. It's slow partly because
   `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` (pnpm checks
   each package's registry publish timestamp before allowing the
   install). This is expected/normal, not an error — just be patient
   on first install.

3. **Started the Vite dev server**

   ```bash
   pnpm dev
   ```

   Port `5173` was briefly occupied by an orphaned process from an
   earlier attempt, so Vite fell back to **`http://localhost:5174`**.
   That stray process was killed; a future `pnpm dev` should bind to
   the default `5173`.

4. **Started the Convex backend** (in a separate terminal)

   ```bash
   npx convex dev
   ```

   Since there was no existing Convex project/login configured, this
   automatically provisioned a **local, anonymous Convex deployment**
   (no `npx convex login` / Convex account needed) backed by a local
   binary at `http://127.0.0.1:3210`. It wrote a new `.env.local` with:

   ```
   CONVEX_DEPLOYMENT=anonymous:anonymous-staff-rca-calculator
   VITE_CONVEX_URL=http://127.0.0.1:3210
   VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
   ```

5. **Unblocked the Convex function push**

   `convex/auth.config.ts` requires two environment variables
   (`HERCULES_OIDC_AUTHORITY`, `HERCULES_OIDC_CLIENT_ID`) to be set on
   the deployment, or Convex refuses to push **any** function. Since
   this is a local anonymous deployment (not the real Hercules
   project), I set placeholders so the backend would come up:

   ```bash
   npx convex env set HERCULES_OIDC_AUTHORITY "https://example-placeholder.auth-provider.com"
   npx convex env set HERCULES_OIDC_CLIENT_ID "local-dev-placeholder-client-id"
   ```

   After that, Convex successfully pushed the schema/functions and
   reported `Convex functions ready!`.

6. **Added matching frontend placeholders** to `.env.local` so
   `AuthProvider` (which reads `VITE_HERCULES_OIDC_AUTHORITY!` /
   `VITE_HERCULES_OIDC_CLIENT_ID!`) doesn't crash on load:

   ```
   VITE_HERCULES_OIDC_AUTHORITY=https://example-placeholder.auth-provider.com
   VITE_HERCULES_OIDC_CLIENT_ID=local-dev-placeholder-client-id
   ```

   Vite auto-restarts on `.env.local` changes, so this took effect
   immediately with no manual restart needed.

## Update (same day): real OIDC credentials wired in

The real Hercules OIDC `authority` and `client ID` for this project
were provided and are now in place on both sides:

- `.env.local` → `VITE_HERCULES_OIDC_AUTHORITY` / `VITE_HERCULES_OIDC_CLIENT_ID`
- Convex deployment → set via `npx convex env set HERCULES_OIDC_AUTHORITY ...`
  and `npx convex env set HERCULES_OIDC_CLIENT_ID ...` (same values,
  `domain`/`applicationID` in `convex/auth.config.ts` read these)

Both dev servers were restarted to pick this up cleanly:

```bash
npx convex dev   # terminal 1 — re-pushed functions with the real auth config
pnpm dev          # terminal 2 — picked up the new .env.local
```

Note: stopping the background task wrapper on this machine did not
kill the underlying `node` processes (Windows/Git Bash orphaning), so
restarting required finding the PID with `netstat -ano` and force-
killing it (`Stop-Process -Id <pid> -Force`) before relaunching —
otherwise the old process keeps holding the port and the new one
falls back to the next port instead of actually restarting.

## Current status

| Component | URL | Status |
|---|---|---|
| Frontend (Vite) | http://localhost:5173 | ✅ Running, compiles cleanly |
| Backend (Convex, local) | http://127.0.0.1:3210 | ✅ Running, functions pushed with real OIDC config |
| Convex dashboard | run `npx convex dashboard` | Not started (optional) |

Sign-in should now work end-to-end against the real Hercules identity
provider — this hasn't been click-tested in a browser from this
session, so verify the "Sign In" flow once and report back if the
identity provider rejects the redirect URI (it defaults to
`http://localhost:5173/auth/callback`, which may need to be
allow-listed on the Hercules OIDC app's side).

## To restart everything from scratch next time

```bash
pnpm install       # if dependencies changed
npx convex dev      # terminal 1 — backend
pnpm dev             # terminal 2 — frontend
```

`.env.local` already exists after the first run, so subsequent
`npx convex dev` runs will reuse the same local deployment instead of
provisioning a new one.

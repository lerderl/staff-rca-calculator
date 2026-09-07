# Backend architecture

## Language: TypeScript, on Convex

The backend is **TypeScript**, running as serverless functions on
[Convex](https://convex.dev) — a document-database + function-execution
platform, roughly "Postgres + API layer" collapsed into one deployable unit.
All backend code lives in [convex/](convex/):

| File | Purpose |
|---|---|
| [convex/schema.ts](convex/schema.ts) | Table definitions (`personnel`, `monthlyRuns`, `runPersonnel`, plus auth tables) |
| [convex/personnel.ts](convex/personnel.ts) | CRUD + search + bulk import for the master personnel database |
| [convex/runs.ts](convex/runs.ts) | Monthly RCA processing runs: create, batch-match personnel, finalize, export tracking |
| [convex/auth.ts](convex/auth.ts) | Convex Auth configuration (email/password sign-in) |
| [convex/auth.config.ts](convex/auth.config.ts) | Tells Convex to trust its own auth tokens |
| [convex/http.ts](convex/http.ts) | HTTP routes Convex Auth needs (token refresh etc.) |
| [convex/users.ts](convex/users.ts) | Look up the signed-in user |

This did **not** need a language rewrite. Convex is an independent platform
(unrelated to Hercules), so the schema and all query/mutation logic carried
over unchanged.

## What was actually tied to Hercules, and what replaced it

This app was originally scaffolded on the [Hercules](https://hercules.app)
app builder. Of everything Hercules touched, only one piece was a hard
runtime dependency:

| Hercules piece | Was it a real dependency? | Replacement |
|---|---|---|
| `@usehercules/auth` (frontend OIDC wrapper) | Yes — talked to an OIDC identity provider hosted at `*.hercules-auth.com` | [`@convex-dev/auth`](https://labs.convex.dev/auth), self-hosted inside this app's own Convex deployment |
| The OIDC identity provider itself | Yes — this is what actually broke when Hercules access was lost | Convex Auth's `Password` provider — no external identity provider at all |
| `@usehercules/vite` (build plugin) | No — dev/build tooling only | Removed |
| `@usehercules/eslint-plugin` (lint rules) | No — lint-time only | Removed |
| Hercules branding in `index.html` | No — cosmetic | Removed |

**Everything else — the Convex database, the schema, `personnel.ts`,
`runs.ts` — was never a Hercules dependency.** Convex apps scaffolded by
Hercules deploy to a Convex account you control; Hercules just generated the
starter code.

### Auth, before and after

- **Before:** sign-in redirected to a Hercules-hosted OIDC login page. Losing
  access to the Hercules project meant losing the ability to manage that
  identity provider (redirect URIs, users, app config) — and, if the Hercules
  account itself were deactivated, likely the identity provider going away
  entirely.
- **After:** [`@convex-dev/auth`](https://labs.convex.dev/auth) with the
  `Password` provider ([convex/auth.ts](convex/auth.ts)). Users sign up with
  an email + password directly against this app's own Convex deployment —
  session tokens, password hashing, and user records all live inside Convex,
  with nothing external to lose access to. The sign-in/sign-up form is
  [src/components/ui/signin.tsx](src/components/ui/signin.tsx); the app shell
  reads the session via [src/hooks/use-auth.ts](src/hooks/use-auth.ts).

If a future requirement needs SSO against a corporate identity provider
(Entra ID, Okta, Google Workspace, etc.), swap the `Password` provider in
`convex/auth.ts` for Convex Auth's OAuth/OIDC provider — the rest of the app
(schema, `ctx.auth.getUserIdentity()` calls) doesn't need to change either
way.

## Deployment note

The Convex deployment itself doesn't have to be hosted on Convex's cloud —
Convex is open source and self-hostable
([get-convex/convex-backend](https://github.com/get-convex/convex-backend)).
Locally, `npx convex dev` already runs a fully local, anonymous deployment
with no account or external service required (see [LOCAL_SETUP.md](LOCAL_SETUP.md)).

## Running it locally

See [LOCAL_SETUP.md](LOCAL_SETUP.md).

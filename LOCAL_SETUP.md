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

## Sharing over LAN (no internet, no public domain)

Both dev servers already bind to all network interfaces (Vite's
`server.host` is `0.0.0.0` in [vite.config.ts](vite.config.ts), and the
Convex local backend binary defaults to `--interface 0.0.0.0`), so anyone
on the same network can reach them — nothing needs to be deployed anywhere.
Two things stop this from working out of the box:

1. `.env.local` points `VITE_CONVEX_URL` at `127.0.0.1`. That's baked into
   the frontend bundle the browser downloads, so a browser on a *different*
   machine would try to reach its own localhost instead of the host
   machine. Worse, `npx convex dev` rewrites `VITE_CONVEX_URL` and
   `VITE_CONVEX_SITE_URL` in `.env.local` back to `127.0.0.1` on every run
   (it treats that file as its own), so editing `.env.local` directly
   doesn't stick.

   Instead, find the host machine's LAN IP:

   ```powershell
   ipconfig   # look for the IPv4 Address on your Wi-Fi/Ethernet adapter
   ```

   and put the override in **`.env.development.local`** (create it at the
   project root — it's already covered by `.gitignore`'s `.env*` rule):

   ```env
   VITE_CONVEX_URL=http://<host-lan-ip>:3210
   VITE_CONVEX_SITE_URL=http://<host-lan-ip>:3211
   ```

   Vite's env-file precedence puts `.env.development.local` above
   `.env.local`, and `npx convex dev` never touches this filename — so the
   override wins for `pnpm dev` and survives every future `npx convex dev`
   run. It only needs to be redone if the host's IP changes (DHCP); give
   the host machine a DHCP reservation/static IP on your router to avoid
   that entirely.

2. Windows Firewall has no inbound rule for these ports by default, so
   other machines on the LAN can't reach the host until one is added.

   On the **host machine**, open an elevated PowerShell — press the
   `Win` key, type `PowerShell`, right-click **Run as administrator** —
   and run:

   ```powershell
   New-NetFirewallRule -DisplayName "Convex local backend" -Direction Inbound -Protocol TCP -LocalPort 3210,3211 -Action Allow -Profile Private
   New-NetFirewallRule -DisplayName "Vite dev server" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private
   ```

   `-Profile Private` scopes the rule to networks Windows treats as
   trusted (home/office) — it will not open these ports on a network
   marked "Public". Don't widen this to `-Profile Public` unless you
   understand the exposure.

   To confirm the rules exist:

   ```powershell
   Get-NetFirewallRule -DisplayName "Convex local backend","Vite dev server" | Select-Object DisplayName, Enabled, Profile, Action
   ```

   To remove them again later:

   ```powershell
   Remove-NetFirewallRule -DisplayName "Convex local backend","Vite dev server"
   ```

With both of those done, run `npx convex dev` and `pnpm dev` as usual on
the host machine, and anyone else on the LAN can open
`http://<host-lan-ip>:5173` in a browser — no install, no account, no
internet required on their end.

### Keeping the LAN IP from changing

DHCP-assigned IPs are usually stable in practice (a home/office router
rarely reassigns a device's lease unless it's offline for a while or the
router restarts), so it's often fine to just re-check `ipconfig` and
update `.env.development.local` on the rare occasion the IP changes.

If you want it to stop changing entirely and don't have access to the
router (so a DHCP reservation isn't an option), you can pin the IP on the
**host machine's** network adapter instead — this needs no router access,
only an elevated PowerShell on the host:

```powershell
# First, make sure nothing else is already using the IP you want to keep —
# briefly disconnect the host's Wi-Fi/Ethernet and confirm this returns False:
Test-Connection -TargetName <host-lan-ip> -Count 2 -Quiet

# Then pin it (use the adapter name from `ipconfig`, e.g. "Wi-Fi" or "Ethernet",
# and the gateway/DNS shown by `ipconfig /all` for that adapter):
New-NetIPAddress -InterfaceAlias "<adapter-name>" -IPAddress <host-lan-ip> -PrefixLength 24 -DefaultGateway <gateway-ip>
Set-DnsClientServerAddress -InterfaceAlias "<adapter-name>" -ServerAddresses <gateway-ip>
```

Picking the *same* address the adapter already has (found via `ipconfig`)
means `.env.development.local` doesn't need to change at all. The risk is
an IP conflict if the router's DHCP pool later hands that same address to
another device — routers conventionally start their DHCP pool well above
`.10` (often `.100`), so a low address is usually safer, but this can't be
guaranteed without seeing the router's DHCP settings.

To undo and go back to DHCP:

```powershell
Remove-NetIPAddress -InterfaceAlias "<adapter-name>" -IPAddress <host-lan-ip> -Confirm:$false
Set-NetIPInterface -InterfaceAlias "<adapter-name>" -Dhcp Enabled
Set-DnsClientServerAddress -InterfaceAlias "<adapter-name>" -ResetServerAddresses
```

## Resetting the local deployment

`.env.local` and the local Convex data live only on this machine. To start
completely fresh, stop both dev servers, delete `.env.local`, and repeat the
first-time setup above — a brand-new local deployment will be provisioned.

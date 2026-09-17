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

1. **No address configuration needed.** The frontend connects to the
   backend on port 3210 of *whatever host the browser used to open the
   page* ([src/components/providers/convex.tsx](src/components/providers/convex.tsx)):
   `localhost:5173` on the host machine talks to the local backend, and
   `http://<host-lan-ip>:5173` from another machine talks to the host over
   the LAN. This keeps working when the host's IP changes, even while the
   servers are running — other machines just need the new address. (It
   deliberately ignores `VITE_CONVEX_URL` in `.env.local`, which
   `npx convex dev` always resets to `127.0.0.1`.)

   To find the address other machines should use, run `ipconfig` on the
   host and look for the IPv4 Address on your Wi-Fi/Ethernet adapter. A
   DHCP reservation or static IP (below) keeps that address from changing.

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

### If you're just using the app, not hosting it

Everything above — Node.js, pnpm, `npx convex dev`, `pnpm dev`, the
firewall rules — is setup that happens **once, on one machine** (the
"host"). Everyone else reaching the app over the LAN needs none of it,
including someone whose device policy forbids installing Node.js or pnpm:

- No install, no build tools, no account — just a browser (Chrome, Edge,
  Firefox; whatever's already on the machine).
- Open `http://<host-lan-ip>:5173` (ask whoever runs the host machine for
  its current LAN IP — get it from that machine's `ipconfig`).
- Being on the same Wi-Fi/LAN as the host is the only real requirement.
  If the page fails to load at all, that's almost always either a
  different network, or the host hasn't run the firewall rules above yet.
- If the page loads but sign-in or data hangs, it's usually the visiting
  device's own firewall blocking the outbound WebSocket connection to
  `<host-lan-ip>:3210` — check that before assuming the host is
  misconfigured.

The host machine has to keep both `npx convex dev` and `pnpm dev` running
for the whole time anyone else wants to use the app — closing either
terminal on the host takes it down for everyone.

### Keeping the LAN IP from changing

DHCP-assigned IPs are usually stable in practice (a home/office router
rarely reassigns a device's lease unless it's offline for a while or the
router restarts). The app itself doesn't care if the IP changes — only the
people on other machines need to be told the new address.

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
means nobody has to learn a new address. The risk is
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

## Auto-starting the servers at logon

On the **host machine**, both dev servers can be set to start automatically
whenever you sign into Windows, instead of running `npx convex dev` and
`pnpm dev` by hand each time.

[scripts/start-dev-servers.ps1](scripts/start-dev-servers.ps1) starts both
servers **in the background, with no windows**, so there's no terminal on
screen for anyone to close by accident. Their output goes to
`logs\backend.log` and `logs\frontend.log`. It runs at logon via a Scheduled
Task named **StaffRCACalculator-DevServers**.

Since there are no windows to close, use these instead (double-click them):

| Script | What it does |
| --- | --- |
| [scripts/stop-dev-servers.cmd](scripts/stop-dev-servers.cmd) | Stops both background servers |
| [scripts/start-dev-servers.cmd](scripts/start-dev-servers.cmd) | Starts them again now, without signing out |

Starting when the servers are already running is harmless — the launcher
sees them and doesn't start a second copy.

### Setting it up on a host machine

The task is tied to one machine, one Windows account, and the folder the
project lives in — so it has to be set up **on each host machine**, signed
in as the account that will host the app. Copying the project folder to
another PC does not carry the task with it.

1. Make sure the app already runs by hand on that machine (`pnpm install`,
   then `npx convex dev` and `pnpm dev` from the
   [First-time setup](#first-time-setup) and [Running](#running) steps).
   The auto-start only starts what already works.
2. Double-click [scripts/install-autostart.cmd](scripts/install-autostart.cmd)
   (no admin rights needed). It registers the task for the signed-in user,
   pointing at wherever the project folder is on that machine. If the
   project folder is ever moved, run it again.
3. Sign out and back in (or restart) to test it.

This triggers **at logon**, not at power-on before anyone signs in — if you
want it running the instant the PC boots with nobody at the keyboard, the
machine would also need to be configured to auto-login, which is a separate
(and more sensitive, since it bypasses the login screen) setup not covered
here.

### If it doesn't start

Every run writes a timestamped log to `logs\autostart.log` in the project
folder: when the launcher started, the LAN IP and internet status it
detected, and each server it started. If nothing appears after logging in:

- **No log file at all** — the task never ran. Check it exists with
  `Get-ScheduledTask -TaskName "StaffRCACalculator-DevServers"`, and re-run
  `install-autostart.cmd` while signed in as the hosting account.
- **Log ends at "launcher finished" but the app doesn't load** — the
  launcher did its job; check `logs\backend.log` and `logs\frontend.log`
  for the server's own error (for example, `node_modules` missing because
  `pnpm install` was never run on that machine).

### How the launcher behaves

**Task priority:** the installer sets the task to normal priority (4).
Task Scheduler's default (7) runs tasks at below-normal CPU and very-low
disk priority — right after a restart that made the launcher take 20+
minutes to even get going, and the servers inherited that low priority too.

**Waiting for the network:** "At logon" can fire before Wi-Fi has finished
reconnecting. The Convex CLI needs to reach `version.convex.dev` at
startup and fails with `Failed to fetch latest backend version` if it
can't. So the launcher waits up to 60s for a LAN IP and a connection to
that host (each check is hard-limited to a few seconds, so a half-up
network can't hang it) before deciding which mode to start in.

**What happens with no internet at all:** the CLI's version check is
mandatory as far as it's concerned — it fails the same way whether the
network is 5 seconds from being ready or never coming back, even though the
backend binary is already downloaded and cached locally and doesn't
actually need that check to run. So if the 60s wait above times out, the
script falls back to launching the cached `convex-local-backend.exe`
directly (same ports and deployment credentials the CLI would use, read
from `.convex/local/default/config.json`), bypassing the CLI wrapper and
its internet-dependent preflight check entirely — `logs\autostart.log`
records when this offline mode was used. The trade-off: it comes up with
whatever functions were last successfully pushed — edits made to `convex/`
while offline won't take effect until you run `npx convex dev` normally
once you're back online. The frontend (`pnpm dev`) has no such dependency
and starts the same way regardless of network state.

To stop this from happening automatically, disable or remove the task:

```powershell
Disable-ScheduledTask -TaskName "StaffRCACalculator-DevServers"   # keep it, just stop auto-running
Unregister-ScheduledTask -TaskName "StaffRCACalculator-DevServers" -Confirm:$false   # remove entirely
```

## Resetting the local deployment

`.env.local` and the local Convex data live only on a host machine. To start
completely fresh, stop both dev servers, delete `.env.local`, and repeat the
first-time setup above — a brand-new local deployment will be provisioned.

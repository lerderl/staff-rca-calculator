# Starts the Convex backend and Vite frontend dev servers, each in its own
# visible terminal window. Registered to run automatically at logon by the
# "StaffRCACalculator-DevServers" Scheduled Task — see README.md.

$ProjectDir = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectDir ".convex\local\default\config.json"
$EnvOverridePath = Join-Path $ProjectDir ".env.development.local"

# DHCP can hand this machine a different LAN IP after any reboot/reconnect,
# which would otherwise silently strand .env.development.local on a stale
# address (the frontend bundle would keep trying to reach a host that no
# longer exists, and the app would just hang on "Verifying auth..." with no
# obvious error). So re-detect the current LAN IP and rewrite the file fresh
# on every startup instead of trusting whatever was written last time.
# The active internet-facing adapter is identified via the default route,
# rather than by adapter name, so this works regardless of Wi-Fi vs Ethernet
# and ignores virtual adapters (WSL, Hyper-V) that don't carry a default route.
function Get-LanIPv4 {
    try {
        $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
            Where-Object { $_.NextHop -ne "0.0.0.0" } |
            Sort-Object -Property RouteMetric |
            Select-Object -First 1
        if ($route) {
            $ip = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop |
                Where-Object { $_.IPAddress -notlike "169.254.*" } |
                Select-Object -First 1
            if ($ip) { return $ip.IPAddress }
        }
    } catch {}
    return $null
}

$LanIP = Get-LanIPv4
if ($LanIP) {
    $envLines = @(
        "# LAN override for 'npx convex dev', which rewrites VITE_CONVEX_URL/VITE_CONVEX_SITE_URL"
        "# in .env.local back to 127.0.0.1 on every run. Vite's env precedence puts"
        "# .env.development.local above .env.local, so these values win for 'pnpm dev'"
        "# without fighting the Convex CLI. Auto-regenerated on every startup by"
        "# start-dev-servers.ps1 with the current LAN IP - see README.md."
        "VITE_CONVEX_URL=http://${LanIP}:3210"
        ""
        "VITE_CONVEX_SITE_URL=http://${LanIP}:3211"
    )
    # Windows PowerShell's "-Encoding utf8" always writes a BOM, which the
    # dotenv parser Vite/Convex use does NOT handle the same way across all
    # of a project's env files — a BOM here while .env.local has none was
    # observed to silently corrupt parsing of the first key in this file.
    # Write plain UTF-8 without a BOM to match .env.local exactly.
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($EnvOverridePath, ($envLines -join "`n") + "`n", $utf8NoBom)
}

# Each server runs inside a PowerShell host (not cmd.exe) so its window title
# stays exactly as set. cmd.exe re-decorates its own title with " - <running
# command>" for as long as any foreground child process is active — this is
# default cmd.exe/conhost behaviour (confirmed with plain builtins like
# `timeout`, nothing to do with npm or pnpm specifically) and it re-applies
# far too often to reliably override from outside. PowerShell's own console
# host has no such behaviour, so setting $host.UI.RawUI.WindowTitle there
# just sticks for the life of the window.
#
# Separately, `npx`/`npm exec` itself calls the Windows console-title API to
# show "npm exec <command>" — confirmed present even under the PowerShell
# host above, so it's npm's own doing, not a shell decoration. The backend
# is launched via `node node_modules/convex/bin/main.js dev` instead of
# `npx convex dev` specifically to route around npm's wrapper entirely —
# npx only resolves and forwards to that exact file, so this is otherwise
# identical, just without npm's title override.
function Start-TitledProcess {
    param([string]$Title, [string]$Command)
    Start-Process powershell.exe -WorkingDirectory $ProjectDir -WindowStyle Normal -ArgumentList @(
        '-NoExit',
        '-Command',
        "`$host.UI.RawUI.WindowTitle = '$Title'; $Command"
    )
}

function Test-ConvexVersionEndpoint {
    try {
        Invoke-WebRequest -Uri "https://version.convex.dev/v1/local_backend_version" -TimeoutSec 3 -UseBasicParsing | Out-Null
        return $true
    } catch {
        return $false
    }
}

# "At logon" can fire before Wi-Fi/DHCP has actually finished reconnecting.
# `npx convex dev` needs to reach version.convex.dev to check for backend
# updates and fails with "Failed to fetch latest backend version" if it
# can't — so give the network a short window to come up before deciding
# there's genuinely no connection.
$online = $false
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
    if (Test-ConvexVersionEndpoint) { $online = $true; break }
    Start-Sleep -Seconds 2
}

if ($online) {
    Start-TitledProcess -Title "staff-rca-calculator (backend)" -Command "node `"node_modules/convex/bin/main.js`" dev"
} else {
    # Genuinely offline: `npx convex dev` will keep failing no matter how long
    # we wait, because the CLI treats that version check as mandatory even
    # though the backend binary is already downloaded and cached locally and
    # doesn't actually need it to run. Work around this by launching the
    # cached binary directly, using the same deployment credentials and ports
    # the CLI itself would use (from .convex/local/default/config.json).
    #
    # Trade-off: this brings the backend up with whatever functions were last
    # successfully pushed — edits made to convex/ while offline will NOT be
    # picked up. Run `npx convex dev` once you're back online to resume the
    # normal watch-and-push loop.
    $started = $false
    if (Test-Path $ConfigPath) {
        try {
            $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            $binaryPath = Join-Path $env:LOCALAPPDATA "convex\binaries\$($config.backendVersion)\convex-local-backend.exe"
            $deploymentDir = Split-Path -Parent $ConfigPath
            $storageDir = Join-Path $deploymentDir "convex_local_storage"
            $dbFile = Join-Path $deploymentDir "convex_local_backend.sqlite3"

            if (Test-Path $binaryPath) {
                $backendArgs = @(
                    "--port", $config.ports.cloud,
                    "--site-proxy-port", $config.ports.site,
                    "--instance-name", $config.deploymentName,
                    "--instance-secret", $config.instanceSecret,
                    "--local-storage", $storageDir,
                    "--disable-beacon",
                    $dbFile
                )
                $quotedArgs = ($backendArgs | ForEach-Object { "`"$_`"" }) -join " "
                $offlineCommand = "Write-Host 'No internet detected - running the already-downloaded backend directly.'; " +
                    "Write-Host 'Run npx convex dev manually once online to resume auto-pushing convex/ changes.'; " +
                    "& `"$binaryPath`" $quotedArgs"
                Start-TitledProcess -Title "staff-rca-calculator (backend - OFFLINE, convex/ changes not auto-pushed)" -Command $offlineCommand
                $started = $true
            }
        } catch {
            $started = $false
        }
    }

    if (-not $started) {
        # No cached binary/config to fall back on (e.g. this machine has never
        # provisioned the local deployment) — nothing offline-safe to run, so
        # just attempt the normal path and let it report the real error.
        Start-TitledProcess -Title "staff-rca-calculator (backend)" -Command "node `"node_modules/convex/bin/main.js`" dev"
    }
}

Start-Sleep -Seconds 2

Start-TitledProcess -Title "staff-rca-calculator (frontend)" -Command "pnpm dev"

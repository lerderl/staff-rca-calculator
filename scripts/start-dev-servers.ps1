# Starts the Convex backend and Vite frontend dev servers, each in its own
# visible terminal window. Registered to run automatically at logon by
# install-autostart.ps1 — see README.md.
#
# Every step is time-bounded and logged to logs\autostart.log, because this
# runs unattended right after boot, when the network and WMI are often not
# ready yet. An unbounded step here previously hung the launcher for 20+
# minutes with no indication of why.

$ProjectDir = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectDir ".convex\local\default\config.json"
$EnvOverridePath = Join-Path $ProjectDir ".env.development.local"
$LogDir = Join-Path $ProjectDir "logs"
$LogPath = Join-Path $LogDir "autostart.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
function Write-Log([string]$Message) {
    Add-Content -Path $LogPath -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

Write-Log "---- launcher started (user $env:USERNAME, project $ProjectDir)"

# Uses .NET directly rather than Get-NetRoute/Get-NetIPAddress: those go
# through WMI, which can block for many minutes right after boot. The
# LAN-facing adapter is the one that's up and has an IPv4 default gateway,
# which also skips virtual adapters (WSL, Hyper-V) that have none.
function Get-LanIPv4 {
    try {
        foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
            $props = $nic.GetIPProperties()
            $gateway = $props.GatewayAddresses | Where-Object {
                $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0'
            }
            if (-not $gateway) { continue }
            $addr = $props.UnicastAddresses | Where-Object {
                $_.Address.AddressFamily -eq 'InterNetwork' -and -not $_.Address.ToString().StartsWith('169.254.')
            } | Select-Object -First 1
            if ($addr) { return $addr.Address.ToString() }
        }
    } catch {}
    return $null
}

# Invoke-WebRequest's -TimeoutSec doesn't cover DNS resolution, so it can
# hang well past its timeout on a half-up network. DNS + TCP connect via
# async calls with Wait() is hard-bounded.
function Test-ConvexReachable([int]$TimeoutMs = 3000) {
    $client = $null
    try {
        $dns = [System.Net.Dns]::GetHostAddressesAsync("version.convex.dev")
        if (-not $dns.Wait($TimeoutMs)) { return $false }
        $client = New-Object System.Net.Sockets.TcpClient
        $connect = $client.ConnectAsync($dns.Result[0], 443)
        return ($connect.Wait($TimeoutMs) -and $client.Connected)
    } catch {
        return $false
    } finally {
        if ($client) { $client.Close() }
    }
}

# Give Wi-Fi/DHCP up to 60s after logon to come up before deciding what
# network state we're in.
$LanIP = $null
$online = $false
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    if (-not $LanIP) { $LanIP = Get-LanIPv4 }
    if ($LanIP -and (Test-ConvexReachable)) { $online = $true; break }
    Start-Sleep -Seconds 2
}
Write-Log "network: LAN IP = $(if ($LanIP) { $LanIP } else { 'none' }), internet = $online"

# DHCP can hand out a different IP after any reboot, so rewrite the
# frontend's Convex URL every startup. With no LAN at all, only this machine
# can use the app anyway, so point it at loopback.
$ConvexHost = if ($LanIP) { $LanIP } else { "127.0.0.1" }
$envLines = @(
    "# LAN override for 'npx convex dev', which rewrites VITE_CONVEX_URL/VITE_CONVEX_SITE_URL"
    "# in .env.local back to 127.0.0.1 on every run. Vite's env precedence puts"
    "# .env.development.local above .env.local, so these values win for 'pnpm dev'"
    "# without fighting the Convex CLI. Auto-regenerated on every startup by"
    "# start-dev-servers.ps1 with the current LAN IP - see README.md."
    "VITE_CONVEX_URL=http://${ConvexHost}:3210"
    ""
    "VITE_CONVEX_SITE_URL=http://${ConvexHost}:3211"
)
# No BOM: Windows PowerShell's "-Encoding utf8" adds one, which was observed
# to corrupt parsing of the first key in this file.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($EnvOverridePath, ($envLines -join "`n") + "`n", $utf8NoBom)
Write-Log "wrote .env.development.local -> $ConvexHost"

# PowerShell hosts rather than cmd.exe: cmd.exe re-decorates its title with
# " - <running command>" for as long as a child runs. The backend runs via
# node directly rather than `npx convex dev` because npm sets its own
# "npm exec ..." console title; npx only resolves to this same file anyway.
function Start-TitledProcess([string]$Title, [string]$Command) {
    Start-Process powershell.exe -WorkingDirectory $ProjectDir -WindowStyle Normal -ArgumentList @(
        '-NoExit',
        '-Command',
        "`$host.UI.RawUI.WindowTitle = '$Title'; $Command"
    )
    Write-Log "started: $Title"
}

$ConvexEntry = "node `"node_modules/convex/bin/main.js`" dev"

if ($online) {
    Start-TitledProcess "staff-rca-calculator (backend)" $ConvexEntry
} else {
    # The Convex CLI hard-fails without internet (mandatory version check),
    # even though the backend binary is already cached. Run that binary
    # directly with the same ports/credentials the CLI would use. Functions
    # last pushed are served; edits to convex/ aren't pushed until the CLI
    # runs again with internet.
    $started = $false
    if (Test-Path $ConfigPath) {
        try {
            $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            $binaryPath = Join-Path $env:LOCALAPPDATA "convex\binaries\$($config.backendVersion)\convex-local-backend.exe"
            $deploymentDir = Split-Path -Parent $ConfigPath
            if (Test-Path $binaryPath) {
                $backendArgs = @(
                    "--port", $config.ports.cloud,
                    "--site-proxy-port", $config.ports.site,
                    "--instance-name", $config.deploymentName,
                    "--instance-secret", $config.instanceSecret,
                    "--local-storage", (Join-Path $deploymentDir "convex_local_storage"),
                    "--disable-beacon",
                    (Join-Path $deploymentDir "convex_local_backend.sqlite3")
                )
                $quotedArgs = ($backendArgs | ForEach-Object { "`"$_`"" }) -join " "
                $offlineCommand = "Write-Host 'No internet detected - running the already-downloaded backend directly.'; " +
                    "Write-Host 'Run npx convex dev manually once online to resume auto-pushing convex/ changes.'; " +
                    "& `"$binaryPath`" $quotedArgs"
                Start-TitledProcess "staff-rca-calculator (backend - OFFLINE, convex/ changes not auto-pushed)" $offlineCommand
                $started = $true
            } else {
                Write-Log "offline fallback unavailable: backend binary not found at $binaryPath"
            }
        } catch {
            Write-Log "offline fallback failed: $($_.Exception.Message)"
        }
    } else {
        Write-Log "offline fallback unavailable: $ConfigPath not found (deployment never provisioned on this machine)"
    }

    if (-not $started) {
        Start-TitledProcess "staff-rca-calculator (backend)" $ConvexEntry
    }
}

Start-Sleep -Seconds 2
Start-TitledProcess "staff-rca-calculator (frontend)" "pnpm dev"
Write-Log "---- launcher finished"

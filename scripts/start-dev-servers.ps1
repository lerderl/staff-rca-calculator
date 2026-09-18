# Starts the Convex backend and Vite frontend dev servers in the background
# (no windows). Registered to run automatically at logon by install-autostart.ps1 — see
# README.md. Stop the servers with stop-dev-servers.cmd.
#
# Every step is time-bounded and logged to logs\autostart.log, because this
# runs unattended right after boot, when the network and WMI are often not
# ready yet. An unbounded step here previously hung the launcher for 20+
# minutes with no indication of why.

$ProjectDir = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectDir ".convex\local\default\config.json"
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
# (The frontend works out the backend address from the browser's own URL,
# so nothing here needs to know or record the LAN IP beyond this log line.)

function Test-PortOpen([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.ConnectAsync("127.0.0.1", $Port)
        return ($connect.Wait(1000) -and $client.Connected)
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# Each server runs in its own headless console (no window at all), so there's
# nothing on screen for anyone to close by accident. Its output goes to
# logs\<name>.log instead. Stop them with scripts\stop-dev-servers.cmd.
# Each needs its OWN headless console that lives as long as the server: a
# console process is killed when the console it's attached to closes, so
# they can't share this launcher's console, which closes when it exits.
# Input comes from NUL so no server can ever sit waiting on a prompt nobody
# can see. The Convex CLI in particular asks "Upgrade now? (Y/n)" whenever a
# new backend version is released; with non-interactive input it instead
# takes its default automatically — upgrade and transfer the existing data.
function Start-HiddenServer([string]$Name, [string]$Command) {
    $log = Join-Path $LogDir "$Name.log"
    Start-Process conhost.exe -WorkingDirectory $ProjectDir -WindowStyle Hidden `
        -ArgumentList "--headless cmd.exe /d /s /c `"$Command < NUL > `"$log`" 2>&1`""
    Write-Log "started $Name (output: logs\$Name.log)"
}

# Run the CLI's entry file directly; `npx convex dev` only resolves to it.
$ConvexEntry = "node `"node_modules\convex\bin\main.js`" dev"
$startBackend = -not (Test-PortOpen 3210)
$startFrontend = -not (Test-PortOpen 5173)
if (-not $startBackend) { Write-Log "backend already running on :3210 - not starting another" }
if (-not $startFrontend) { Write-Log "frontend already running on :5173 - not starting another" }

if (-not $startBackend) {
    # already running
} elseif ($online) {
    Start-HiddenServer "backend" $ConvexEntry
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
                Write-Log "no internet - running the cached backend binary directly (convex/ changes won't be pushed until 'npx convex dev' runs online)"
                Start-HiddenServer "backend" "`"$binaryPath`" $quotedArgs"
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
        Start-HiddenServer "backend" $ConvexEntry
    }
}

if ($startFrontend) {
    Start-Sleep -Seconds 2
    Start-HiddenServer "frontend" "pnpm dev"
}
Write-Log "---- launcher finished"

# Starts the Convex backend and Vite frontend dev servers in the background
# (no windows), then stays running as a watchdog that restarts either server
# if it fails to come up or stops later. Registered to run automatically at
# logon by install-autostart.ps1 — see README.md. Stop everything (watchdog
# included) with stop-dev-servers.cmd.
#
# Every step is time-bounded and logged to logs\autostart.log, because this
# runs unattended right after boot, when the network and WMI are often not
# ready yet. An unbounded step here previously hung the launcher for 20+
# minutes with no indication of why.

$ProjectDir = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectDir ".convex\local\default\config.json"
$DeploymentDir = Split-Path -Parent $ConfigPath
$LogDir = Join-Path $ProjectDir "logs"
$LogPath = Join-Path $LogDir "autostart.log"

# The Convex CLI gives the local backend only 30s to start by default. Right
# after boot — especially when it has just downloaded a new backend version,
# which antivirus then scans on first run — that isn't enough, and the CLI
# gives up with "Local backend did not start on port 3210 within 30 seconds".
# An existing value (set by hand) wins. Start-HiddenServer passes this and
# the knob below on to each server's own command line.
if (-not $env:CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS) {
    $env:CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS = "300"
}
$BackendStartupTimeoutSecs = [int]$env:CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS

# Convex stops a query/mutation after 1 second of execution by default. That
# is a shared-cloud safety limit; on this single-machine deployment it only
# gets in the way. Signing in exceeds it on a busy or just-booted PC — the
# password check (scrypt, deliberately slow) runs inside the `auth:store`
# mutation, and the first call after startup also pays for loading the
# functions. The result is "Function execution timed out (maximum duration:
# 1s)" on the login screen. The backend reads this knob at startup.
if (-not $env:DATABASE_UDF_USER_TIMEOUT_SECONDS) {
    $env:DATABASE_UDF_USER_TIMEOUT_SECONDS = "10"
}
$BackendPort = 3210
$FrontendPort = 5173

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
function Write-Log([string]$Message) {
    Add-Content -Path $LogPath -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

# Only one watchdog at a time: the logon task and a manual double-click of
# start-dev-servers.cmd would otherwise fight over the same ports.
$mutex = New-Object System.Threading.Mutex($false, "Local\StaffRCACalculator-DevServers")
if (-not $mutex.WaitOne(0)) {
    Write-Log "launcher started, but another launcher is already watching the servers - exiting"
    return
}

Write-Log "---- launcher started (user $env:USERNAME, project $ProjectDir, backend startup timeout ${BackendStartupTimeoutSecs}s, function timeout $($env:DATABASE_UDF_USER_TIMEOUT_SECONDS)s)"

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

# Each server runs in its own headless console (no window at all), so there's
# nothing on screen for anyone to close by accident. Its output goes to
# logs\<name>.log instead. Stop them with scripts\stop-dev-servers.cmd.
# Each needs its OWN headless console that lives as long as the server: a
# console process is killed when the console it's attached to closes, so
# they can't share this launcher's console.
# Input comes from NUL so no server can ever sit waiting on a prompt nobody
# can see. The Convex CLI in particular asks "Upgrade now? (Y/n)" whenever a
# new backend version is released; with non-interactive input it instead
# takes its default automatically — upgrade and transfer the existing data.
function Start-HiddenServer([string]$Name, [string]$Command) {
    $log = Join-Path $LogDir "$Name.log"
    # The backend settings are set inside the command rather than inherited
    # from this process: an environment variable set here does not survive
    # the conhost/cmd hand-off, and the backend would silently keep its
    # 1-second default.
    $EnvPrefix = "set CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=$BackendStartupTimeoutSecs&& set DATABASE_UDF_USER_TIMEOUT_SECONDS=$($env:DATABASE_UDF_USER_TIMEOUT_SECONDS)&& "
    $proc = Start-Process conhost.exe -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru `
        -ArgumentList "--headless cmd.exe /d /s /c `"$EnvPrefix$Command < NUL > `"$log`" 2>&1`""
    Write-Log "started $Name (output: logs\$Name.log)"
    return $proc
}

function Stop-Server($Proc) {
    if ($Proc -and -not $Proc.HasExited) {
        taskkill.exe /PID $Proc.Id /T /F 2>&1 | Out-Null
    }
}

# When the CLI gives up it exits, but the backend binary it launched can be
# left running on its own, holding the database and (eventually) the port.
# Clear those out before starting a new backend.
function Stop-OrphanBackends {
    $dir = [regex]::Escape($DeploymentDir)
    Get-CimInstance Win32_Process -Filter "Name='convex-local-backend.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match $dir } |
        ForEach-Object {
            Write-Log "ending leftover backend process $($_.ProcessId)"
            taskkill.exe /PID $_.ProcessId /T /F 2>&1 | Out-Null
        }
}

function Write-LogTail([string]$Name) {
    $log = Join-Path $LogDir "$Name.log"
    if (Test-Path $log) {
        Get-Content $log -Tail 8 -ErrorAction SilentlyContinue |
            Where-Object { $_.Trim() } |
            ForEach-Object { Write-Log "  $Name.log: $_" }
    }
}

# Waits until the port opens (success) or the server exits / the time runs
# out (failure).
function Wait-ServerUp($Proc, [int]$Port, [int]$TimeoutSecs) {
    $deadline = (Get-Date).AddSeconds($TimeoutSecs)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortOpen $Port) { return $true }
        if ($Proc.HasExited) { return $false }
        Start-Sleep -Seconds 2
    }
    return (Test-PortOpen $Port)
}

# Run the CLI's entry file directly; `npx convex dev` only resolves to it.
$ConvexEntry = "node `"node_modules\convex\bin\main.js`" dev"

# Runs the backend binary the CLI last used, directly, with the same
# ports/credentials the CLI would use. Needs no internet, downloads nothing
# and never upgrades, so it's the dependable fallback. Functions last pushed
# are served; edits to convex/ aren't pushed until the CLI runs again.
function Get-LocalBackendCommand {
    if (-not (Test-Path $ConfigPath)) {
        Write-Log "local backend unavailable: $ConfigPath not found (deployment never provisioned on this machine)"
        return $null
    }
    try {
        $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        $binaryPath = Join-Path $env:LOCALAPPDATA "convex\binaries\$($config.backendVersion)\convex-local-backend.exe"
        if (-not (Test-Path $binaryPath)) {
            Write-Log "local backend unavailable: backend binary not found at $binaryPath"
            return $null
        }
        $backendArgs = @(
            "--port", $config.ports.cloud,
            "--site-proxy-port", $config.ports.site,
            "--instance-name", $config.deploymentName,
            "--instance-secret", $config.instanceSecret,
            "--local-storage", (Join-Path $DeploymentDir "convex_local_storage"),
            "--disable-beacon",
            (Join-Path $DeploymentDir "convex_local_backend.sqlite3")
        )
        $quotedArgs = ($backendArgs | ForEach-Object { "`"$_`"" }) -join " "
        return "`"$binaryPath`" $quotedArgs"
    } catch {
        Write-Log "local backend unavailable: $($_.Exception.Message)"
        return $null
    }
}

# An open port only means the backend is listening; the first function call
# after startup is still slow, because the backend has to load and compile
# the app's functions, and that time counts towards the function timeout.
# Making that call here, rather than leaving it to whoever logs in first,
# keeps the login screen quick. It goes over HTTP rather than through the
# Convex CLI, which crashes inside a headless console (libuv asserts on
# setting a process title there). Failure isn't fatal - the watchdog watches
# the port, and this is only about warming things up.
function Invoke-BackendWarmup {
    try {
        $body = '{"path":"auth:isAuthenticated","args":{},"format":"json"}'
        $result = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/api/query" -Method Post `
            -ContentType "application/json" -Body $body -TimeoutSec 60
        Write-Log "warm-up call to auth:isAuthenticated -> $($result.status)"
    } catch {
        Write-Log "warm-up call failed: $($_.Exception.Message)"
    }
}

# One start attempt: the Convex CLI first when online (it also pushes the
# latest convex/ functions), and if that fails or times out, the cached
# local binary. Returns the running server process, or $null.
function Start-Backend {
    Stop-OrphanBackends
    if ($online) {
        $proc = Start-HiddenServer "backend" $ConvexEntry
        # The CLI's own startup timeout, plus time for its version check and
        # any backend download before that timer starts.
        if (Wait-ServerUp $proc $BackendPort ($BackendStartupTimeoutSecs + 180)) {
            Write-Log "backend is up on :$BackendPort (Convex CLI)"
            Invoke-BackendWarmup
            return $proc
        }
        Write-Log "backend (Convex CLI) did not come up - switching to the local backend binary"
        Write-LogTail "backend"
        Stop-Server $proc
        Stop-OrphanBackends
    } else {
        Write-Log "no internet - using the local backend binary (convex/ changes won't be pushed until the CLI runs online)"
    }

    $command = Get-LocalBackendCommand
    if (-not $command) { return $null }
    $proc = Start-HiddenServer "backend" $command
    if (Wait-ServerUp $proc $BackendPort $BackendStartupTimeoutSecs) {
        Write-Log "backend is up on :$BackendPort (local binary)"
        Invoke-BackendWarmup
        return $proc
    }
    Write-Log "backend (local binary) did not come up"
    Write-LogTail "backend"
    Stop-Server $proc
    Stop-OrphanBackends
    return $null
}

function Start-Frontend {
    $proc = Start-HiddenServer "frontend" "pnpm dev"
    if (Wait-ServerUp $proc $FrontendPort 120) {
        Write-Log "frontend is up on :$FrontendPort"
        return $proc
    }
    Write-Log "frontend did not come up"
    Write-LogTail "frontend"
    Stop-Server $proc
    return $null
}

# ---- watchdog ----
# Checks both servers every 10s. A server counts as down after its port has
# been closed for 3 checks in a row (so a brief hiccup doesn't cause a
# restart); it is then restarted, with a growing pause between repeated
# failures (15s, 30s, 60s, then every 2 minutes) so a persistent problem
# doesn't spin the CPU.
$servers = @{
    backend  = @{ Port = $BackendPort;  Start = ${function:Start-Backend};  Proc = $null; Misses = 0; Failures = 0; NextTry = (Get-Date) }
    frontend = @{ Port = $FrontendPort; Start = ${function:Start-Frontend}; Proc = $null; Misses = 0; Failures = 0; NextTry = (Get-Date) }
}
foreach ($name in @("frontend", "backend")) {
    if (Test-PortOpen $servers[$name].Port) { Write-Log "$name already running on :$($servers[$name].Port) - not starting another" }
}

while ($true) {
    # Frontend first: it starts in seconds, while a backend start can take
    # minutes and blocks this loop until it finishes.
    foreach ($name in @("frontend", "backend")) {
        $s = $servers[$name]
        if (Test-PortOpen $s.Port) {
            $s.Misses = 0
            continue
        }
        $s.Misses++
        # First pass (nothing started yet) starts right away.
        if ($s.Misses -lt 3 -and $s.Proc) { continue }
        if ((Get-Date) -lt $s.NextTry) { continue }

        if ($s.Proc) {
            Write-Log "$name is down (port $($s.Port) closed) - restarting"
            Write-LogTail $name
            Stop-Server $s.Proc
        }
        # Re-check the network each time, so a backend started offline goes
        # back to the CLI once the internet returns.
        if ($name -eq "backend") { $online = Test-ConvexReachable }

        $s.Proc = & $s.Start
        $s.Misses = 0
        if ($s.Proc) {
            $s.Failures = 0
        } else {
            $s.Failures++
            $delay = [Math]::Min(120, 15 * [Math]::Pow(2, $s.Failures - 1))
            $s.NextTry = (Get-Date).AddSeconds($delay)
            Write-Log "$name failed to start ($($s.Failures) in a row) - retrying in ${delay}s"
            # Keep a placeholder so the retry isn't treated as a first start.
            $s.Proc = [pscustomobject]@{ HasExited = $true; Id = 0 }
        }
    }
    Start-Sleep -Seconds 10
}

# Stops the hidden backend and frontend servers started by
# start-dev-servers.ps1, and the watchdog launcher itself (otherwise it would
# just restart them). Only matches the processes that script launched —
# identified by the launcher's path and the log files the servers write
# inside this project — and ends each of those along with everything it
# started (node, pnpm, vite, the Convex backend binary).

$ProjectDir = Split-Path -Parent $PSScriptRoot
$launcher = [regex]::Escape((Join-Path $PSScriptRoot "start-dev-servers.ps1"))
$logDir = [regex]::Escape((Join-Path $ProjectDir "logs"))
$pattern = "$logDir\\(backend|frontend)\.log"
$deploymentDir = [regex]::Escape((Join-Path $ProjectDir ".convex\local\default"))

# The watchdog first, so it can't restart anything while the servers stop.
$watchdogs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match $launcher -and $_.ProcessId -ne $PID }
foreach ($proc in $watchdogs) {
    taskkill.exe /PID $proc.ProcessId /T /F 2>&1 | Out-Null
}

$roots = @(Get-CimInstance Win32_Process -Filter "Name='conhost.exe' OR Name='cmd.exe'" |
    Where-Object { $_.CommandLine -match $pattern })
# A backend binary left behind by a Convex CLI that gave up.
$roots += @(Get-CimInstance Win32_Process -Filter "Name='convex-local-backend.exe'" |
    Where-Object { $_.CommandLine -match $deploymentDir })

if (-not $roots -and -not $watchdogs) {
    Write-Host "No servers started by start-dev-servers are running."
    return
}

foreach ($proc in $roots) {
    # /T ends the whole process tree under it. Output is discarded: ending a
    # console first also ends the cmd.exe inside it, so the later attempt on
    # that cmd.exe reports "not found", which is expected.
    taskkill.exe /PID $proc.ProcessId /T /F 2>&1 | Out-Null
}
Write-Host "Stopped the staff-rca-calculator backend and frontend."

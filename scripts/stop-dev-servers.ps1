# Stops the hidden backend and frontend servers started by
# start-dev-servers.ps1. Only matches the processes that script launched —
# identified by the log files they write inside this project — and ends each
# of those along with everything it started (node, pnpm, vite, the Convex
# backend binary).

$ProjectDir = Split-Path -Parent $PSScriptRoot
$logDir = [regex]::Escape((Join-Path $ProjectDir "logs"))
$pattern = "$logDir\\(backend|frontend)\.log"

$roots = Get-CimInstance Win32_Process -Filter "Name='conhost.exe' OR Name='cmd.exe'" |
    Where-Object { $_.CommandLine -match $pattern }

if (-not $roots) {
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

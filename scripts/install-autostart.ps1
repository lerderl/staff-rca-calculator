# Registers the "StaffRCACalculator-DevServers" Scheduled Task so both dev
# servers start automatically when the CURRENT Windows user logs in.
#
# Run this once on each host machine, signed in as the account that will
# host the app. The task points at this script's own folder, so it's correct
# wherever the project was copied to. No admin rights needed.
#
# Remove with: Unregister-ScheduledTask -TaskName "StaffRCACalculator-DevServers" -Confirm:$false

$TaskName = "StaffRCACalculator-DevServers"
$LauncherPath = Join-Path $PSScriptRoot "start-dev-servers.ps1"

# `conhost --headless` runs the launcher without opening a blank terminal
# window; the two server windows it starts still open normally.
$Action = New-ScheduledTaskAction -Execute "conhost.exe" `
    -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$LauncherPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# Priority 4 = normal. Task Scheduler's default (7) runs the task at
# below-normal CPU and very-low disk I/O priority, which made the launcher
# take 20+ minutes to get going right after boot — and the servers it
# starts would inherit that priority too.
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Priority 4

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Starts the staff-rca-calculator Convex backend and Vite frontend at logon" -Force | Out-Null

Write-Host "Registered '$TaskName' for $env:USERDOMAIN\$env:USERNAME"
Write-Host "Launcher: $LauncherPath"
Write-Host "It will run at your next login. Log file: $(Join-Path (Split-Path -Parent $PSScriptRoot) 'logs\autostart.log')"

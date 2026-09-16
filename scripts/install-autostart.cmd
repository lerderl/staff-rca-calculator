@echo off
rem Double-click this to register the auto-start task for the current user.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
pause

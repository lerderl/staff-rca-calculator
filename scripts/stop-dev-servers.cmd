@echo off
rem Double-click this to stop the background backend and frontend servers.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-dev-servers.ps1"
pause

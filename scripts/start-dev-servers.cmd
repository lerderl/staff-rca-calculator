@echo off
rem Double-click this to start the backend and frontend in the background now,
rem without waiting for the next login.
start "" conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev-servers.ps1"

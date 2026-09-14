@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-CRM-PUBLIC.ps1"
if errorlevel 1 (
  echo.
  echo Nie udalo sie uruchomic publicznego CRM. Szczegoly sa powyzej.
  pause
)

@echo off
setlocal
cd /d "%~dp0"

set "DOCKER_EXE=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%DOCKER_EXE%" set "DOCKER_EXE=docker"

if not exist ".env" (
  echo Brakuje prywatnego pliku .env.
  pause
  exit /b 1
)
if not exist "secrets\eprom-crm.json" (
  echo Brakuje prywatnego pliku secrets\eprom-crm.json.
  pause
  exit /b 1
)
if not exist "cloudflared.docker.yml" (
  echo Brakuje konfiguracji cloudflared.docker.yml.
  pause
  exit /b 1
)

"%DOCKER_EXE%" compose up -d --build
if errorlevel 1 (
  echo.
  echo Docker nie uruchomil stacka CRM. Upewnij sie, ze Docker Desktop pokazuje Engine running.
  pause
  exit /b 1
)

"%DOCKER_EXE%" compose ps
echo.
echo CRM jest dostepny pod https://crm.webspanner.pl
pause

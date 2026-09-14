$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$tokenFile = Join-Path $appRoot 'secrets\cloudflare-tunnel-token'
$cloudflared = Join-Path $appRoot 'tools\cloudflared.exe'
$healthUrl = 'http://127.0.0.1:4320/api/health'

if (-not (Test-Path -LiteralPath $tokenFile)) {
  throw 'Brakuje prywatnego pliku secrets\cloudflare-tunnel-token.'
}
if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw 'Brakuje podpisanej binarki tools\cloudflared.exe.'
}
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html'))) {
  Push-Location $appRoot
  try {
    & npm.cmd ci --no-audit --no-fund
    & npm.cmd run build
  } finally {
    Pop-Location
  }
}

$previous = @{
  NODE_ENV = $env:NODE_ENV
  PORT = $env:PORT
  CRM_HOST = $env:CRM_HOST
  CRM_DATA_DIR = $env:CRM_DATA_DIR
  CRM_SECURE_COOKIE = $env:CRM_SECURE_COOKIE
  CRM_TRUST_PROXY = $env:CRM_TRUST_PROXY
  CRM_ALLOWED_ORIGINS = $env:CRM_ALLOWED_ORIGINS
  CRM_TIMEZONE = $env:CRM_TIMEZONE
}

$env:NODE_ENV = 'production'
$env:PORT = '4320'
$env:CRM_HOST = '127.0.0.1'
$env:CRM_DATA_DIR = (Join-Path $appRoot 'data')
$env:CRM_SECURE_COOKIE = 'true'
$env:CRM_TRUST_PROXY = 'cloudflare'
$env:CRM_ALLOWED_ORIGINS = 'https://crm.webspanner.pl'
$env:CRM_TIMEZONE = 'Europe/Warsaw'

$server = $null
try {
  $server = Start-Process -FilePath (Get-Command node.exe).Source `
    -ArgumentList 'server/index.mjs' `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -PassThru

  $healthy = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($response.ok) { $healthy = $true; break }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) { throw 'Serwer CRM nie przeszedl kontroli zdrowia.' }

  Write-Host 'CRM dziala publicznie pod https://crm.webspanner.pl'
  Write-Host 'Pozostaw to okno otwarte. Ctrl+C zatrzyma tunel i CRM.'
  & $cloudflared tunnel --no-autoupdate --loglevel info run --token-file $tokenFile
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
  }
  foreach ($name in $previous.Keys) {
    if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $previous[$name] }
  }
}

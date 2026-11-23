$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
. (Join-Path $project 'identidad_backend_qa.ps1')
$serverPath = Join-Path $project 'backend\server.js'
$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\cursor\resources\app\resources\helpers\node.exe'
  if (Test-Path -LiteralPath $candidate) { $nodePath = $candidate }
}
if (-not $nodePath) { throw 'No se encontro Node.js. No se cerro ningun proceso.' }
$listeners = @(Get-NetTCPConnection -LocalPort 3101 -State Listen -ErrorAction SilentlyContinue)
$catalogMatches = $false
if ($listeners.Count -gt 0) {
  try {
    $snapshotText = & $nodePath --disable-warning=ExperimentalWarning (Join-Path $project 'comprobar_qa_datos.cjs') 2>$null
    if ($LASTEXITCODE -eq 0) {
      $snapshot = $snapshotText | ConvertFrom-Json
      $catalog = Invoke-RestMethod -Uri 'http://127.0.0.1:3101/api/products?limit=1' -TimeoutSec 4
      $catalogMatches = Test-QaCatalogMatch -Snapshot $snapshot -Catalog $catalog
    }
  } catch { Write-Output 'No fue posible cotejar el catalogo para reconocer un inicio con ruta relativa.' }
}
$verifiedOwners = @{}
foreach ($listener in $listeners | Sort-Object OwningProcess -Unique) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if (-not (Test-QaOwnerIdentity -Owner $owner -ServerPath $serverPath -CatalogMatches $catalogMatches)) {
    throw "El puerto 3101 no pertenece al backend de este proyecto. No se cerro ningun proceso. PID: $($listener.OwningProcess)"
  }
  $verifiedOwners[$owner.ProcessId] = $owner.CreationDate
}
foreach ($listener in $listeners | Sort-Object OwningProcess -Unique) {
  $currentOwner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if (-not $currentOwner -or $currentOwner.CreationDate -ne $verifiedOwners[$currentOwner.ProcessId]) {
    throw 'El proceso cambio durante la comprobacion. No se reinicio ningun proceso adicional.'
  }
  Write-Output "Cerrando solo el backend QA de este proyecto (PID $($listener.OwningProcess))..."
  Stop-Process -Id $listener.OwningProcess -ErrorAction Stop
}
$deadline = (Get-Date).AddSeconds(15)
while (Get-NetTCPConnection -LocalPort 3101 -State Listen -ErrorAction SilentlyContinue) {
  if ((Get-Date) -gt $deadline) { throw 'El puerto 3101 sigue ocupado. No se inicio otro backend.' }
  Start-Sleep -Milliseconds 200
}
$env:QA_MODE = '1'
$env:QA_ALLOW_GEMINI = '1'
$env:PORT = '3101'
$env:DATABASE_PATH = Join-Path $project 'backend\data\database.sqlite'
$logs = Join-Path $project 'backend\logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory (Join-Path $project 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'qa-backend.log') -RedirectStandardError (Join-Path $logs 'qa-backend-error.log') | Out-Null
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 400
  try {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3101/api/qa/status' -TimeoutSec 2
    if ($status.service -eq 'claremm-qa' -and $status.qaMode) {
      Write-Output 'Backend QA actualizado y disponible.'
      exit 0
    }
  } catch { }
} while ((Get-Date) -lt $deadline)
throw "El backend no respondio. Revisa $logs\qa-backend-error.log"

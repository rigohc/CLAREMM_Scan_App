param(
  [Parameter(Mandatory=$true)][ValidateSet('backend','frontend')][string]$Kind,
  [Parameter(Mandatory=$true)][string]$ProjectDir,
  [ValidateRange(0,65535)][int]$Port = 0
)
# Exit codes: 0 = this QA instance is ready, 10 = port free, 20 = conflict/not ready.
$ErrorActionPreference = 'Stop'
if ($Port -eq 0) { $Port = if ($Kind -eq 'backend') { 3101 } else { 5174 } }
$socket = New-Object System.Net.Sockets.TcpClient
try {
  $connection = $socket.ConnectAsync('127.0.0.1', $port)
  if (-not $connection.Wait(1000)) { exit 10 }
  if (-not $socket.Connected) { exit 10 }
} catch { exit 10 } finally { $socket.Dispose() }

$project = [IO.Path]::GetFullPath($ProjectDir).TrimEnd('\')
$sha = [Security.Cryptography.SHA256]::Create()
try { $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($project.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }
$origin = if ($Kind -eq 'backend') { "http://127.0.0.1:$Port" } else { "https://localhost:$Port" }
function Confirm-ExportReady {
  try {
    Invoke-WebRequest -Uri "$origin/api/products/export-saz?modo=__comprobacion__" -UseBasicParsing -TimeoutSec 3 | Out-Null
  } catch {
    # The new export handler rejects the invalid mode with 400. Old servers
    # route export-saz into products/:id and return 404 instead.
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 400) { return }
  }
  Write-Output 'El backend esta desactualizado: falta la ruta de exportacion SAZ.'
  Write-Output 'Ejecuta reiniciar_backend_qa.bat y vuelve a iniciar QA.'
  exit 20
}
try {
  $status = Invoke-RestMethod -Uri "$origin/api/qa/status" -TimeoutSec 3
  if ($status.service -eq 'claremm-qa' -and $status.qaMode -eq $true -and $status.instance -eq $identity) {
    if ($Kind -eq 'frontend') {
      $vite = Invoke-WebRequest -Uri "$origin/@vite/client" -UseBasicParsing -TimeoutSec 3
      if ($vite.StatusCode -ne 200 -or $vite.Content -notmatch 'WebSocket') { throw 'El frontend no es Vite.' }
    }
    Confirm-ExportReady
    Write-Output "QA $Kind ya esta disponible en el puerto $port. Se reutilizara."
    exit 0
  }
} catch { }

# An already-running older backend has no identity endpoint. Verify that its
# live catalog matches this project's SQLite database, opened read-only.
try {
  $node = $env:NODE_EXE
  if (-not $node) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
  $snapshotText = & $node --disable-warning=ExperimentalWarning (Join-Path $project 'comprobar_qa_datos.cjs') 2>$null
  if ($LASTEXITCODE -eq 0) {
    $snapshot = $snapshotText | ConvertFrom-Json
    $catalog = Invoke-RestMethod -Uri "$origin/api/products?limit=1" -TimeoutSec 3
    $matches = $catalog.success -eq $true -and $catalog.pagination.total -eq $snapshot.total
    if ($snapshot.latest) {
      $item = @($catalog.items)[0]
      foreach ($field in @('id','estilo','color','corrida','precio','costo')) {
        if ([string]$item.$field -cne [string]$snapshot.latest.$field) { $matches = $false }
      }
    } else { $matches = $false }
    if ($matches) {
      if ($Kind -eq 'frontend') {
        $vite = Invoke-WebRequest -Uri "$origin/@vite/client" -UseBasicParsing -TimeoutSec 3
        if ($vite.Content -notmatch 'WebSocket') { throw 'El frontend no es Vite.' }
      }
      Confirm-ExportReady
      Write-Output "QA $Kind ya responde con la base de datos de este proyecto en $port. Se reutilizara."
      exit 0
    }
  }
} catch { }

# Compatibility with QA processes started before the identity endpoint existed.
# Require both the expected executable command path AND a working CLAREMM API.
try {
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop)
  $expected = if ($Kind -eq 'backend') { Join-Path $project 'backend\server.js' } else { Join-Path $project 'frontend\node_modules\vite\bin\vite.js' }
  $owned = $false
  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction Stop
    if ($process.CommandLine -and $process.CommandLine.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $owned = $true }
  }
  if ($owned) {
    $stats = Invoke-RestMethod -Uri "$origin/api/stats" -TimeoutSec 3
    if ($stats.success -eq $true -and $null -ne $stats.stats) {
      Confirm-ExportReady
      Write-Output "QA $Kind de este proyecto ya responde en $port. Se reutilizara."
      exit 0
    }
  }
  $listeners | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize
} catch { Write-Output $_.Exception.Message }
Write-Output "El puerto $port esta ocupado, pero no se pudo verificar una instancia QA lista de este proyecto."
Write-Output 'No se cerro ningun proceso. Revisa la ventana de QA o la aplicacion que ocupa ese puerto.'
exit 20

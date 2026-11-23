function Test-QaCatalogMatch {
  param($Snapshot, $Catalog)
  if (-not $Snapshot.latest -or $Catalog.success -ne $true -or
      $Catalog.pagination.total -ne $Snapshot.total -or @($Catalog.items).Count -ne 1) { return $false }
  $item = @($Catalog.items)[0]
  foreach ($field in @('id','estilo','color','corrida','precio','costo')) {
    if ([string]$item.$field -cne [string]$Snapshot.latest.$field) { return $false }
  }
  return $true
}

function Test-QaOwnerIdentity {
  param($Owner, [string]$ServerPath, [bool]$CatalogMatches)
  if (-not $Owner -or $Owner.Name -notmatch '^node(?:\.exe)?$' -or -not $Owner.CommandLine) { return $false }
  $command = $Owner.CommandLine.Replace('/', '\').Replace('"', '')
  if ($command.IndexOf($ServerPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  # Relative startup: node server.js, node --watch server.js, node backend/server.js.
  # A catalog match alone never authorizes stopping an unrelated Node script.
  return ($CatalogMatches -and $command -match '(?i)(?:^|\s)(?:\.\\)?(?:backend\\)?server\.js\s*$')
}

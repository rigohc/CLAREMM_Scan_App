$ErrorActionPreference = 'Stop'

$certDirectory = Join-Path $env:LOCALAPPDATA 'CLAREMM-QA\certs'
$rootSubject = 'CN=CLAREMM QA LAN Root'
$rootCertificatePath = Join-Path $certDirectory 'CLAREMM-QA-Root.cer'
$serverCertificatePath = Join-Path $certDirectory 'qa-server.pfx'

$ipAddresses = @(
  Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway } |
    ForEach-Object { $_.IPv4Address } |
    Where-Object { $_.IPAddress -and $_.IPAddress -notlike '169.254.*' }
)

if ($ipAddresses.Count -eq 0) {
  throw 'No se encontró una dirección IPv4 activa con salida de red.'
}

$ipAddress = $ipAddresses[0].IPAddress
New-Item -ItemType Directory -Path $certDirectory -Force | Out-Null

$rootCertificate = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -eq $rootSubject -and $_.NotAfter -gt (Get-Date) } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $rootCertificate) {
  $rootCertificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $rootSubject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyUsage CertSign, CRLSign, DigitalSignature `
    -KeyUsageProperty All `
    -KeyExportPolicy NonExportable `
    -NotAfter (Get-Date).AddYears(10) `
    -TextExtension @('2.5.29.19={critical}{text}ca=TRUE&pathlength=0')
}

$trustedRoot = Get-ChildItem Cert:\CurrentUser\Root |
  Where-Object { $_.Thumbprint -eq $rootCertificate.Thumbprint } |
  Select-Object -First 1

if (-not $trustedRoot) {
  $rootCertificate | Export-Certificate -FilePath $rootCertificatePath -Force | Out-Null
  Import-Certificate -FilePath $rootCertificatePath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
} else {
  $rootCertificate | Export-Certificate -FilePath $rootCertificatePath -Force | Out-Null
}

$serverSubject = "CN=CLAREMM QA $ipAddress"
$serverCertificate = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object {
    $_.Subject -eq $serverSubject -and
    $_.Issuer -eq $rootCertificate.Subject -and
    $_.HasPrivateKey -and
    $_.NotAfter -gt (Get-Date)
  } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $serverCertificate) {
  $serverCertificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $serverSubject `
    -Signer $rootCertificate `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -KeyUsageProperty All `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(2) `
    -TextExtension @(
      "2.5.29.17={text}DNS=localhost&IPAddress=$ipAddress",
      '2.5.29.37={text}1.3.6.1.5.5.7.3.1'
    )
}

$pfxBytes = $serverCertificate.Export(
  [System.Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12
)
[System.IO.File]::WriteAllBytes($serverCertificatePath, $pfxBytes)

Write-Output "Certificado HTTPS local creado para https://$ipAddress`:5174 y https://localhost:5174."
Write-Output "Certificado raíz público para confiar en los dispositivos QA: $rootCertificatePath"
$rootHash = Get-FileHash -Path $rootCertificatePath -Algorithm SHA256
Write-Output "SHA-256 del archivo del certificado raíz: $($rootHash.Hash)"

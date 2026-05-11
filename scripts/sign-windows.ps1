# Authenticode-sign the Windows agent and the MSI/zip bundle.
# Run on a machine that has the EV code-signing cert in its certificate store.
#
#   .\scripts\sign-windows.ps1 -CertSubject "CN=Hospital IT, O=Hospital, C=IN"
param(
    [Parameter(Mandatory = $true)] [string] $CertSubject,
    [string] $Dist        = "$PSScriptRoot\..\dist",
    [string] $TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = 'Stop'
$signtool = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
if (-not (Test-Path $signtool)) {
    $signtool = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe |
                 Where-Object FullName -match 'x64' | Select-Object -First 1).FullName
}
if (-not $signtool) { throw "signtool.exe not found — install Windows SDK." }

$cert = Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My |
        Where-Object Subject -eq $CertSubject |
        Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) { throw "No certificate matching subject '$CertSubject' in cert store." }

$targets = @(
    Join-Path $Dist 'auro-agent.exe'
)

foreach ($t in $targets) {
    if (-not (Test-Path $t)) { Write-Warning "skip (missing): $t"; continue }
    Write-Host "[*] Signing $t"
    & $signtool sign `
        /sha1   $cert.Thumbprint `
        /fd     SHA256 `
        /td     SHA256 `
        /tr     $TimestampUrl `
        /v $t
    Write-Host "[+] verifying"
    & $signtool verify /pa /v $t
}

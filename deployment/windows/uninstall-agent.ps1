# AURO-DLP — Uninstaller (admin only).
# Removing the agent should be a managed action, never a user one.
param(
    [string] $InstallDir = "$env:ProgramFiles\AURO-DLP",
    [string] $DataDir    = "$env:ProgramData\AURO-DLP",
    [switch] $KeepData
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'AuroAgent'

function Require-Admin {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administrator required."
    }
}

Require-Admin

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
}

# Browser policies
foreach ($k in @(
    'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist',
    'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist'
)) {
    if (Test-Path $k) { Remove-ItemProperty -Path $k -Name '1' -ErrorAction SilentlyContinue }
}

if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
if (-not $KeepData -and (Test-Path $DataDir)) { Remove-Item -Recurse -Force $DataDir }

Write-Host "AURO-DLP removed."

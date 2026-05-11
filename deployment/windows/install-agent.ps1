# AURO-DLP Endpoint Agent — Windows installer
# Run as Administrator. Idempotent: safe to re-run for upgrades.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install-agent.ps1 `
#       -ServerUrl "https://dlp.hospital.local:8443" `
#       -EnrollmentToken "<token>"
#
# What it does:
#   1. Verifies code signature on auro-agent.exe
#   2. Copies binary + configs to %ProgramFiles%\AURO-DLP
#   3. Locks down ACL so only SYSTEM and Administrators can write
#   4. Registers a Windows service (auto-start, restart on failure)
#   5. Configures the service for tamper resistance (FailureActions)
#   6. Enrolls with the policy server using the one-time token
#   7. Drops the Chrome/Edge force-install policy keys
#   8. Starts the service

param(
    [Parameter(Mandatory = $true)] [string] $ServerUrl,
    [Parameter(Mandatory = $true)] [string] $EnrollmentToken,
    [string] $InstallDir = "$env:ProgramFiles\AURO-DLP",
    [string] $DataDir    = "$env:ProgramData\AURO-DLP",
    [string] $ExtensionId = "auro-dlp-extension-id-placeholder",
    [switch] $SkipSignatureCheck
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'AuroAgent'
$DisplayName = 'AURO-DLP Endpoint Agent'
$BinaryName  = 'auro-agent.exe'

function Require-Admin {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This script must be run as Administrator."
    }
}

function Stop-OldService {
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        Write-Host "[*] Stopping existing service…"
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        sc.exe delete $ServiceName | Out-Null
        Start-Sleep -Seconds 2
    }
}

function Install-Files {
    $src = Join-Path $PSScriptRoot $BinaryName
    if (-not (Test-Path $src)) { throw "Binary not found: $src" }

    if (-not $SkipSignatureCheck) {
        $sig = Get-AuthenticodeSignature $src
        if ($sig.Status -ne 'Valid') {
            Write-Warning "Authenticode signature status: $($sig.Status). Pass -SkipSignatureCheck to override (not recommended)."
            throw "Refusing to install unsigned binary."
        }
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    New-Item -ItemType Directory -Force -Path $DataDir    | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $DataDir 'logs') | Out-Null

    Copy-Item -Force $src "$InstallDir\$BinaryName"

    # Default configs (overridden by policy bundle once enrolled)
    $cfg = @"
listen: "127.0.0.1:7443"
data_dir: "$($DataDir.Replace('\','\\'))"
server_url: "$ServerUrl"
heartbeat_seconds: 60
ocr:
  enabled: true
tamper:
  enabled: true
  watchdog: true
"@
    Set-Content -Path (Join-Path $InstallDir 'agent.yaml') -Value $cfg -Encoding utf8
}

function Lock-Acl {
    Write-Host "[*] Locking ACL on $InstallDir"
    $acl = Get-Acl $InstallDir
    $acl.SetAccessRuleProtection($true, $false)  # disable inheritance, no copy
    $rules = @(
        New-Object System.Security.AccessControl.FileSystemAccessRule(
            'NT AUTHORITY\SYSTEM','FullControl','ContainerInherit,ObjectInherit','None','Allow'),
        New-Object System.Security.AccessControl.FileSystemAccessRule(
            'BUILTIN\Administrators','FullControl','ContainerInherit,ObjectInherit','None','Allow'),
        New-Object System.Security.AccessControl.FileSystemAccessRule(
            'BUILTIN\Users','ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')
    )
    foreach ($r in $rules) { $acl.AddAccessRule($r) }
    Set-Acl -Path $InstallDir -AclObject $acl
}

function Register-Service {
    Write-Host "[*] Registering service $ServiceName"
    $bin = "`"$InstallDir\$BinaryName`" --service --config `"$InstallDir\agent.yaml`""
    sc.exe create $ServiceName binPath= $bin start= auto DisplayName= "$DisplayName" obj= "LocalSystem" | Out-Null
    sc.exe description $ServiceName "AURO-DLP endpoint inspector. Tamper-protected. Required for Gmail compliance." | Out-Null
    # Restart on crash: 60s, 60s, 60s
    sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
    sc.exe failureflag $ServiceName 1 | Out-Null
    sc.exe sdset $ServiceName "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)" | Out-Null
}

function Enroll-Endpoint {
    Write-Host "[*] Enrolling with $ServerUrl"
    $body = @{
        token    = $EnrollmentToken
        hostname = $env:COMPUTERNAME
        os       = "Windows " + (Get-CimInstance Win32_OperatingSystem).Version
        agentVersion = "1.0.0"
    } | ConvertTo-Json
    try {
        $r = Invoke-RestMethod -Method POST -Uri "$ServerUrl/api/v1/agents/enroll" `
            -Body $body -ContentType 'application/json' -TimeoutSec 30
        Set-Content -Path (Join-Path $InstallDir 'agent.id') -Value $r.agentId -Encoding ascii
        Set-Content -Path (Join-Path $InstallDir 'agent.cert.pem') -Value $r.certificate -Encoding ascii
        Set-Content -Path (Join-Path $InstallDir 'server.ca.pem') -Value $r.caCertificate -Encoding ascii
        Write-Host "[+] Enrolled as $($r.agentId)"
    } catch {
        Write-Warning "Enrollment failed: $_  — agent will retry on first start."
    }
}

function Set-BrowserPolicy {
    Write-Host "[*] Configuring Chrome/Edge force-install policy"
    $chromeKey = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist'
    $edgeKey   = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist'
    foreach ($k in @($chromeKey, $edgeKey)) {
        New-Item -Path $k -Force | Out-Null
        # value: <extension-id>;<update-url>
        $val = "$ExtensionId;$ServerUrl/extension/updates.xml"
        Set-ItemProperty -Path $k -Name '1' -Value $val -Type String
    }
    # Block private/incognito where the extension can't run
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome' -Name 'IncognitoModeAvailability' -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' -Name 'InPrivateModeAvailability' -Value 1 -Type DWord -Force -ErrorAction SilentlyContinue
}

function Start-It {
    Write-Host "[*] Starting service"
    Start-Service -Name $ServiceName
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $ServiceName
    if ($svc.Status -ne 'Running') {
        throw "Service did not reach Running state (current: $($svc.Status))."
    }
    Write-Host "[+] $DisplayName installed and running."
}

Require-Admin
Stop-OldService
Install-Files
Lock-Acl
Register-Service
Enroll-Endpoint
Set-BrowserPolicy
Start-It

Write-Host ""
Write-Host "==================================================================="
Write-Host "  AURO-DLP installed."
Write-Host "  Service:      $ServiceName"
Write-Host "  Install dir:  $InstallDir"
Write-Host "  Data dir:     $DataDir"
Write-Host "  Server:       $ServerUrl"
Write-Host "==================================================================="

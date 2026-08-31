<#
.SYNOPSIS
  Installs VerduraIdealposBridge as a Windows Service.

.DESCRIPTION
  Run this from an elevated (Administrator) PowerShell prompt on the
  Windows 11 machine that has Idealpos installed, AFTER building the
  project (see ../README.md "Build") and confirming ../App.config points
  at the correct SQL Server / has a real Bridge:ApiKey set.

  Service account: App.config's IpsConnection uses Trusted_Connection=True,
  which means whichever Windows account runs this service IS the SQL
  Server login used to reach IPSTransaction. The safest choice is usually
  the SAME account IdealposService already runs as (it is already
  confirmed to work against this database) — check it first:

      sc.exe qc IdealposService

  and look at SERVICE_START_NAME in the output. Pass that account via
  -ServiceAccount / -ServiceAccountPassword below. If you'd rather use a
  dedicated account, create it first and grant it a SQL Server login with
  db_datareader AND db_datawriter on IPSTransaction (datawriter is needed:
  LocalDataHelper.InsertOrders() performs a real INSERT into
  dbo.WebPendingOrder).

.PARAMETER ServiceAccount
  e.g. ".\VerduraBridgeSvc" or "NT AUTHORITY\NetworkService". If omitted,
  defaults to "NT AUTHORITY\NetworkService" — you MUST separately grant
  that account (or your chosen one) a SQL Server login, or the service
  will start but every Idealpos call will fail with a login error.

.PARAMETER ServiceAccountPassword
  Required for a real Windows account; not needed for built-in accounts
  like NetworkService/LocalSystem.
#>
param(
    [string]$ExePath = (Join-Path $PSScriptRoot "..\bin\Release\net48\VerduraIdealposBridge.exe"),
    [string]$ServiceAccount = "NT AUTHORITY\NetworkService",
    [securestring]$ServiceAccountPassword
)

$ServiceName = "VerduraIdealposBridge"

if (-not (Test-Path $ExePath)) {
    Write-Error "Executable not found at '$ExePath'. Build the project first (dotnet build -c Release) or pass -ExePath explicitly."
    exit 1
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Service '$ServiceName' already exists (status: $($existing.Status)). Stopping and removing it first..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host "Creating service '$ServiceName' running as '$ServiceAccount'..."

if ($ServiceAccountPassword) {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ServiceAccountPassword))
    New-Service -Name $ServiceName `
        -BinaryPathName "`"$ExePath`"" `
        -DisplayName "Verdura Idealpos Bridge" `
        -Description "HTTP/JSON bridge between Verdura and Idealpos's local order-injection pipeline. See README.md." `
        -StartupType Automatic `
        -Credential (New-Object System.Management.Automation.PSCredential($ServiceAccount, $ServiceAccountPassword))
} else {
    New-Service -Name $ServiceName `
        -BinaryPathName "`"$ExePath`"" `
        -DisplayName "Verdura Idealpos Bridge" `
        -Description "HTTP/JSON bridge between Verdura and Idealpos's local order-injection pipeline. See README.md." `
        -StartupType Automatic
    if ($ServiceAccount -ne "LocalSystem") {
        sc.exe config $ServiceName obj= "$ServiceAccount" | Out-Null
    }
}

# Auto-recover after a crash: restart after 5s, 5s, then 30s, resetting the
# failure counter after a day of good behaviour. Matches "recover after
# crashes" from the requirements.
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null

Write-Host ""
Write-Host "Service '$ServiceName' created (Automatic start, auto-restart on crash)."
Write-Host "It will NOT start automatically right now — start it explicitly once you've"
Write-Host "confirmed App.config (SQL connection, Bridge:ApiKey, table-assignment"
Write-Host "strategy) is correct:"
Write-Host ""
Write-Host "    Start-Service $ServiceName"
Write-Host "    Get-Service $ServiceName"
Write-Host ""
Write-Host "If it fails to start, check the Windows Application Event Log (AutoLog is"
Write-Host "on) and .\logs\bridge-*.log next to the executable."

<#
.SYNOPSIS
  Removes the VerduraIdealposBridge Windows Service. Run elevated.
#>
$ServiceName = "VerduraIdealposBridge"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Service '$ServiceName' is not installed. Nothing to do."
    exit 0
}

Write-Host "Stopping '$ServiceName'..."
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Deleting '$ServiceName'..."
sc.exe delete $ServiceName

Write-Host "Done. State (state\bridge-state.sqlite) and logs (logs\) are left in place —"
Write-Host "delete them manually if you want a clean slate."

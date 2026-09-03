<#
.SYNOPSIS
  Deploys governed copies of the production ops scripts out of this mutable
  git checkout and into a protected location.

.DESCRIPTION
  DL-114 Priority 1: production must not execute from
  `C:\Users\Posmate\Documents\verdura_MVP\windows-deploy\ops\`, which is a
  working tree — a branch checkout, reset, or stash silently changes or
  removes what the Scheduled Tasks run. This script copies the ops scripts to
  `C:\ProgramData\Verdura\ops\`, applies the DL-114 ProgramData ACL model,
  and writes a MANIFEST.json provenance record (SHA-256 per file, originating
  commit, deploying account, host, source-tree cleanliness).

  Idempotent: re-running re-copies, re-verifies and refreshes the manifest.
  It does NOT touch the Scheduled Tasks — repointing is a separate, reviewed
  step (see -WhatIfTasks output for the exact task arguments to set).

.PARAMETER OpsDir
  Protected destination. Default C:\ProgramData\Verdura\ops.

.NOTES
  ACL rationale — the destination does NOT use the bare
  releases/state/logs model (SYSTEM + Administrators only), because
  `VerduraPostgresBackup` runs with RunLevel=Limited (non-elevated). Under a
  non-elevated token the Administrators SID is deny-only, so that ACL would
  leave the backup task unable to READ its own script. The task principal is
  therefore granted an explicit ReadAndExecute ACE: executable by the task,
  not writable by the unelevated user who owns the checkout.

  Requires elevation (it sets a protected ACL under ProgramData).
#>
[CmdletBinding()]
param(
    [string]   $RepoRoot,
    [string]   $OpsDir       = 'C:\ProgramData\Verdura\ops',
    # docker-compose.redis.yml is not a script, but it is production input the
    # ensure script reads at runtime, so it must be governed and hashed the
    # same way -- otherwise the checkout dependency simply moves rather than
    # being removed.
    [string[]] $ScriptNames  = @('ensure-verdura-redis.ps1', 'pg-backup.ps1', 'docker-compose.redis.yml'),
    [string]   $TaskPrincipalSid = 'S-1-5-21-160777116-34683011-1598780446-1001'
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not reliably populated in a param() default under -File on
# Windows PowerShell 5.1, so the repo root is resolved here instead.
if (-not $RepoRoot) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $here)
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Elevation required: this script sets a protected ACL under ProgramData.'
}

$sourceDir = Join-Path $RepoRoot 'windows-deploy\ops'
if (-not (Test-Path -LiteralPath $sourceDir)) { throw "Source ops directory not found: $sourceDir" }

# --- provenance from git -------------------------------------------------
Push-Location $RepoRoot
try {
    $headCommit = (& git rev-parse HEAD).Trim()
    $dirty      = (& git status --porcelain -- 'windows-deploy/ops' | Out-String).Trim()
} finally { Pop-Location }

if ($dirty) {
    Write-Warning "Source tree is DIRTY under windows-deploy/ops; the deployed copy will not correspond to a committed state:`n$dirty"
}

# --- destination + ACL ---------------------------------------------------
if (-not (Test-Path -LiteralPath $OpsDir)) { New-Item -ItemType Directory -Path $OpsDir -Force | Out-Null }

$acl = Get-Acl -LiteralPath $OpsDir
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }

$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$prop    = [System.Security.AccessControl.PropagationFlags]::None
$allow   = [System.Security.AccessControl.AccessControlType]::Allow
@(
    New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl',$inherit,$prop,$allow)
    New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl',$inherit,$prop,$allow)
    New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($TaskPrincipalSid)),'ReadAndExecute',$inherit,$prop,$allow)
) | ForEach-Object { $acl.AddAccessRule($_) }
Set-Acl -LiteralPath $OpsDir -AclObject $acl

# --- copy + verify -------------------------------------------------------
$records = foreach ($name in $ScriptNames) {
    $src = Join-Path $sourceDir $name
    $dst = Join-Path $OpsDir    $name
    if (-not (Test-Path -LiteralPath $src)) { throw "Missing source script: $src" }

    Copy-Item -LiteralPath $src -Destination $dst -Force

    $srcHash = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
    $dstHash = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
    if ($srcHash -ne $dstHash) { throw "SHA-256 mismatch after copy for '$name' ($srcHash vs $dstHash)." }

    Push-Location $RepoRoot
    try { $fileCommit = (& git log -1 --format='%H' -- "windows-deploy/ops/$name" | Out-String).Trim() }
    finally { Pop-Location }

    # A newly added file has no commit yet. Record that honestly instead of
    # crashing on Substring of an empty string -- and make it visible, because
    # deploying an uncommitted file is exactly what the dirty-tree warning is
    # for.
    $commitLabel = if ($fileCommit) { $fileCommit.Substring(0,9) } else { 'UNCOMMITTED' }

    # Write-Host, not Write-Output: this foreach is captured into $records, so
    # anything written to the success stream here would be serialised into the
    # manifest's files[] array alongside the real records.
    Write-Host ("  {0,-28} {1}  <- {2}" -f $name, $dstHash.Substring(0,16), $commitLabel)

    [pscustomobject]@{
        fileName        = $name
        sourcePath      = $src
        deployedPath    = $dst
        sha256          = $dstHash
        sourceGitCommit = if ($fileCommit) { $fileCommit } else { $null }
        sizeBytes       = (Get-Item -LiteralPath $dst).Length
    }
}

[pscustomobject]@{
    artifact        = 'verdura-ops-scripts'
    purpose         = 'Governed production copies of ops scripts; removes production execution from the mutable git checkout (DL-114 Priority 1).'
    deployedUtc     = (Get-Date).ToUniversalTime().ToString('o')
    deployedBy      = "$env:USERDOMAIN\$env:USERNAME"
    hostName        = $env:COMPUTERNAME
    sourceRepo      = $RepoRoot
    sourceRepoHead  = $headCommit
    sourceTreeClean = [string]::IsNullOrWhiteSpace($dirty)
    aclModel        = 'Inheritance disabled; SYSTEM=FullControl, Administrators=FullControl, task principal=ReadAndExecute (backup task runs RunLevel=Limited and must be able to read).'
    files           = $records
} | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $OpsDir 'MANIFEST.json') -Encoding utf8

Write-Output ''
Write-Output "Deployed to $OpsDir (manifest refreshed)."
Write-Output 'Scheduled Tasks are NOT modified by this script. To repoint, set each task''s'
Write-Output 'action arguments to (changing ONLY the -File path, never principal/trigger/run level):'
foreach ($name in $ScriptNames | Where-Object { $_ -like '*.ps1' }) {
    Write-Output ("  -NoProfile -ExecutionPolicy Bypass -File `"{0}`"" -f (Join-Path $OpsDir $name))
}

Write-Output ''
Write-Output 'Non-script production input deployed alongside them (read at runtime, not launched):'
foreach ($name in $ScriptNames | Where-Object { $_ -notlike '*.ps1' }) {
    Write-Output ("  {0}" -f (Join-Path $OpsDir $name))
}

<#
.SYNOPSIS
  Stages a governed, byte-identical release of the five static frontends and
  the proxy host, so production services stop executing from this checkout.

.DESCRIPTION
  DL-114 Priority 1, phase A. Six of the nine Verdura services execute from
  `C:\Users\Posmate\Documents\verdura_MVP`. Five of them are static frontends
  served by `windows-deploy\static-proxy-server.mjs`, which imports only Node
  builtins (no node_modules), so they relocate cleanly. The sixth, VerduraAPI,
  does NOT — its 26 dependencies are hoisted into the 643 MB root
  `node_modules`, and it reads `.env` from its working directory. The API is
  deliberately out of scope here and needs its own governed release.

  Copy semantics are byte-identical: this stages exactly the build output
  production is already serving. It does NOT rebuild, so behaviour cannot
  change. Every file is verified by SHA-256 and the script aborts on any
  mismatch rather than leaving a partial release.

  This script does NOT touch the services. Repointing and restarting is a
  separate, reviewed step — see the printed instructions at the end.

.PARAMETER Stamp
  Release directory name under releases\frontends\. Defaults to the short
  HEAD commit, matching the connector/bridge release convention.

.NOTES
  Requires elevation (sets a protected ACL under ProgramData).
  All Verdura services run as LocalSystem, so the ACL is the standard
  releases model: SYSTEM + Administrators only. (Contrast
  deploy-ops-scripts.ps1, which must additionally grant the task principal
  ReadAndExecute because VerduraPostgresBackup runs RunLevel=Limited.)
#>
[CmdletBinding()]
param(
    [string] $RepoRoot,
    [string] $ReleaseRoot = 'C:\ProgramData\Verdura\releases\frontends',
    [string] $Stamp,
    [string] $ApiUrl      = 'http://127.0.0.1:3000'
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $here)
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Elevation required: this script sets a protected ACL under ProgramData.'
}

Push-Location $RepoRoot
try {
    $head = (& git rev-parse HEAD).Trim()
    if (-not $Stamp) { $Stamp = (& git rev-parse --short HEAD).Trim() }
} finally { Pop-Location }

$rel = Join-Path $ReleaseRoot $Stamp

# repo-relative source -> release-relative destination, and the service that serves it
$items = @(
    @{ Src = 'windows-deploy\static-proxy-server.mjs'; Dst = 'static-proxy-server.mjs';        Type = 'file'; Svc = $null;                    Port = $null }
    @{ Src = 'apps\admin-console\dist-admin';          Dst = 'apps\admin-console\dist-admin';  Type = 'dir';  Svc = 'VerduraAdminConsole';    Port = 5177 }
    @{ Src = 'apps\admin-console\dist-kds';            Dst = 'apps\admin-console\dist-kds';    Type = 'dir';  Svc = 'VerduraKitchenDisplay';  Port = 5175 }
    @{ Src = 'apps\admin-console\dist';                Dst = 'apps\admin-console\dist';        Type = 'dir';  Svc = 'VerduraOrderTablet';     Port = 5176 }
    @{ Src = 'apps\customer-website\dist';             Dst = 'apps\customer-website\dist';     Type = 'dir';  Svc = 'VerduraCustomerWebsite'; Port = 5173 }
    @{ Src = 'apps\window-display\dist';               Dst = 'apps\window-display\dist';       Type = 'dir';  Svc = 'VerduraWindowDisplay';   Port = 5174 }
)

foreach ($i in $items) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $i.Src))) {
        throw "Missing build artifact: $($i.Src). Build before staging a release; this script never rebuilds."
    }
}

New-Item -ItemType Directory -Force -Path $rel | Out-Null

foreach ($i in $items) {
    $s = Join-Path $RepoRoot $i.Src
    $d = Join-Path $rel      $i.Dst
    New-Item -ItemType Directory -Force -Path (Split-Path $d -Parent) | Out-Null
    if ($i.Type -eq 'file') {
        Copy-Item -LiteralPath $s -Destination $d -Force
    }
    else {
        # robocopy /MIR, NOT Copy-Item -Recurse: copying a directory onto an
        # EXISTING directory nests the source inside it (dist\dist), so a
        # re-run silently doubles the release. /MIR mirrors and purges extras,
        # which makes re-staging idempotent.
        $null = & robocopy $s $d /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed for '$($i.Src)' with exit code $LASTEXITCODE." }
    }
    Write-Host "  staged: $($i.Src)"
}

# --- verify byte-identical -----------------------------------------------
$checked = 0; $bad = 0
foreach ($i in $items) {
    $s = Join-Path $RepoRoot $i.Src
    $d = Join-Path $rel      $i.Dst
    if ($i.Type -eq 'file') {
        $checked++
        if ((Get-FileHash $s -Algorithm SHA256).Hash -ne (Get-FileHash $d -Algorithm SHA256).Hash) {
            $bad++; Write-Warning "MISMATCH: $($i.Src)"
        }
    } else {
        Get-ChildItem $s -Recurse -File | ForEach-Object {
            $checked++
            $rp = $_.FullName.Substring($s.Length).TrimStart('\')
            $t  = Join-Path $d $rp
            if (-not (Test-Path -LiteralPath $t)) { $script:bad++; Write-Warning "MISSING: $rp" }
            elseif ((Get-FileHash $_.FullName -Algorithm SHA256).Hash -ne (Get-FileHash $t -Algorithm SHA256).Hash) {
                $script:bad++; Write-Warning "MISMATCH: $rp"
            }
        }
    }
}
if ($bad -gt 0) { throw "ABORT: $bad of $checked file(s) failed SHA-256 verification; release at '$rel' is NOT trustworthy." }
Write-Host "  verified: $checked/$checked files byte-identical"

# --- ACL: standard releases model (services run as LocalSystem) ----------
$acl = Get-Acl -LiteralPath $rel
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
$inh = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$pf  = [System.Security.AccessControl.PropagationFlags]::None
$al  = [System.Security.AccessControl.AccessControlType]::Allow
@('NT AUTHORITY\SYSTEM','BUILTIN\Administrators') | ForEach-Object {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($_,'FullControl',$inh,$pf,$al)))
}
Set-Acl -LiteralPath $rel -AclObject $acl

# --- manifest ------------------------------------------------------------
# Exclude ONLY the release-root manifest, matched by full path. Filtering on
# name would also drop shipped app assets called manifest.json (the customer
# website ships one), silently omitting them from fileCount and rootHash --
# PowerShell's -ne is case-insensitive, so MANIFEST.json != manifest.json does
# not hold here.
$manifestPath = Join-Path $rel 'MANIFEST.json'
$files = Get-ChildItem $rel -Recurse -File | Where-Object { $_.FullName -ne $manifestPath }
$concat = ($files | Sort-Object FullName | ForEach-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash }) -join ''
$sha = [System.Security.Cryptography.SHA256]::Create()
$rootHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($concat))).Replace('-','')

[pscustomobject]@{
    artifact       = 'verdura-frontends'
    purpose        = 'Governed release of the five static frontends + proxy host; removes production service execution from the mutable git checkout (DL-114 Priority 1, phase A).'
    deployedUtc    = (Get-Date).ToUniversalTime().ToString('o')
    deployedBy     = "$env:USERDOMAIN\$env:USERNAME"
    hostName       = $env:COMPUTERNAME
    sourceRepo     = $RepoRoot
    sourceRepoHead = $head
    copySemantics  = 'Byte-identical copy of the build output production was already serving. No rebuild; behaviour unchanged.'
    aclModel       = 'Inheritance disabled; SYSTEM=FullControl, Administrators=FullControl. All Verdura services run as LocalSystem.'
    fileCount      = $files.Count
    totalBytes     = ($files | Measure-Object Length -Sum).Sum
    rootHash       = $rootHash
    notInScope     = 'VerduraAPI: dependencies hoisted to the 643 MB root node_modules and .env is read from the working directory. Needs its own governed release.'
} | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $rel 'MANIFEST.json') -Encoding utf8

Write-Host ''
Write-Host "Release staged: $rel"
Write-Host "  files=$($files.Count)  rootHash=$($rootHash.Substring(0,32))..."
Write-Host ''
Write-Host 'Services are NOT modified by this script. To cut over, for each service set'
Write-Host 'AppDirectory and AppParameters, then restart it via the SCM and confirm HTTP 200'
Write-Host 'before moving to the next:'
Write-Host ''
foreach ($i in $items | Where-Object { $_.Svc }) {
    Write-Host ("  {0}" -f $i.Svc)
    Write-Host ("    AppDirectory  {0}" -f $rel)
    Write-Host ("    AppParameters {0}\static-proxy-server.mjs {1}\{2} {3} {4}" -f $rel, $rel, $i.Dst, $i.Port, $ApiUrl)
}
Write-Host ''
Write-Host 'Rollback: descriptors captured under'
Write-Host '  C:\ProgramData\Verdura\rollback\services-20260903-frontend-relocation\'

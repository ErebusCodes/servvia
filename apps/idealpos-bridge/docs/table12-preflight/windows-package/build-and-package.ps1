<#
.SYNOPSIS
  Builds VerduraIdealposBridge on the Windows machine that has Idealpos
  installed, using ITS OWN legitimately-licensed vendor DLLs, and produces
  a checksummed manifest of the build output.

.DESCRIPTION
  This script deliberately does NOT ship or embed IdealPos.Webit.Core.dll /
  IdealPos.Data.dll / IdealPos.Common.dll / Newtonsoft.Json.dll /
  System.Data.SQLite.dll anywhere — those are Idealpos's own proprietary
  files. This script copies them from the local Idealpos installation into
  ./lib (the same file it never touches, PUT_DLLS_HERE.txt, has always
  documented this) and builds in place. That is the ONLY correct way to
  produce a legitimate, licensed build of this bridge — the "package" this
  repository ships is source + this script, not a pre-built binary from
  another machine.

  Run this from an elevated OR standard PowerShell prompt (elevation is not
  required for the build itself, only for deploy-and-run steps later in
  the runbook) in the root of this repository, on the target Windows
  machine, AFTER confirming source-manifest-sha256.txt matches (see that
  file's own header for the verification command).

.PARAMETER IdealposInstallDir
  Path to the live Idealpos installation directory containing
  IdealPos.Webit.Core.dll etc. Typically
  "C:\Program Files (x86)\Idealpos Solutions\Idealpos".

.PARAMETER OutputDir
  Where the built, checksummed package lands. Defaults to .\dist next to
  this script. This is NOT the final install location — see
  install-locations.md for where to copy it afterward.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$IdealposInstallDir,

    [string]$OutputDir = (Join-Path $PSScriptRoot "dist")
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")

Write-Host "=== VerduraIdealposBridge build-and-package ==="
Write-Host "Repo root:            $repoRoot"
Write-Host "Idealpos install dir: $IdealposInstallDir"
Write-Host "Output dir:           $OutputDir"
Write-Host ""

# --- 0. Verify source integrity before touching anything -------------------
$manifestPath = Join-Path $PSScriptRoot "source-manifest-sha256.txt"
Write-Host "Verifying source against $manifestPath ..."
$mismatches = @()
Get-Content $manifestPath | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
    $parts = $_ -split '\s{2,}', 2
    if ($parts.Count -ne 2) { return }
    $expectedHash = $parts[0].Trim()
    $relPath = $parts[1].Trim().TrimStart('.', '/')
    $fullPath = Join-Path $repoRoot ($relPath -replace '/', '\')
    if (-not (Test-Path $fullPath)) {
        $mismatches += "MISSING: $relPath"
        return
    }
    $actualHash = (Get-FileHash $fullPath -Algorithm SHA256).Hash.ToLower()
    if ($actualHash -ne $expectedHash) {
        $mismatches += "HASH MISMATCH: $relPath (expected $expectedHash, got $actualHash)"
    }
}
if ($mismatches.Count -gt 0) {
    Write-Error "Source manifest verification FAILED:`n$($mismatches -join "`n")`nDo not proceed until this is understood."
    exit 1
}
Write-Host "Source manifest verified: OK"
Write-Host ""

# --- 1. Copy real vendor DLLs into lib/ (never committed to source control) -
$libDir = Join-Path $repoRoot "lib"
$requiredDlls = @("IdealPos.Webit.Core.dll", "IdealPos.Data.dll", "IdealPos.Common.dll", "Newtonsoft.Json.dll", "System.Data.SQLite.dll")
foreach ($dll in $requiredDlls) {
    $src = Join-Path $IdealposInstallDir $dll
    if (-not (Test-Path $src)) {
        Write-Error "Required DLL not found at $src — confirm -IdealposInstallDir points at a real Idealpos installation."
        exit 1
    }
    Copy-Item $src (Join-Path $libDir $dll) -Force
    Write-Host "Copied $dll"
}
foreach ($arch in @("x86", "x64")) {
    $src = Join-Path $IdealposInstallDir "$arch\SQLite.Interop.dll"
    $destDir = Join-Path $libDir $arch
    if (Test-Path $src) {
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        Copy-Item $src (Join-Path $destDir "SQLite.Interop.dll") -Force
        Write-Host "Copied $arch\SQLite.Interop.dll"
    } else {
        Write-Warning "$arch\SQLite.Interop.dll not found at $src — SQLite may fail to load at runtime on $arch."
    }
}
Write-Host ""

# --- 2. Build --------------------------------------------------------------
Push-Location $repoRoot
try {
    Write-Host "Running: dotnet build VerduraIdealposBridge.csproj -c Release"
    dotnet build VerduraIdealposBridge.csproj -c Release
    if ($LASTEXITCODE -ne 0) { throw "dotnet build failed (exit $LASTEXITCODE)" }

    Write-Host ""
    Write-Host "Running: dotnet build VerduraIdealposBridge.csproj -c Release -- -t:RunSelfTest (selftest via exe, not msbuild target)"
    # --selftest is a runtime flag on the exe, not an msbuild target — see
    # Program.cs. Run it now, on the machine that can actually execute a
    # net48 exe, as the first real automated evidence this build works.
    $exePath = Join-Path $repoRoot "bin\Release\net48\VerduraIdealposBridge.exe"
    if (-not (Test-Path $exePath)) { throw "Built exe not found at $exePath" }
    & $exePath --selftest
    $selfTestExit = $LASTEXITCODE
    if ($selfTestExit -ne 0) {
        Write-Error "--selftest reported $selfTestExit failing assertion(s). Do not proceed to a live order until this is understood and fixed."
        exit 1
    }
    Write-Host "--selftest: all assertions passed."
} finally {
    Pop-Location
}
Write-Host ""

# --- 3. Package the build output, with a fresh manifest ---------------------
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$buildOutputDir = Join-Path $repoRoot "bin\Release\net48"
Copy-Item "$buildOutputDir\*" $OutputDir -Recurse -Force

$manifestOut = Join-Path $OutputDir "build-output-manifest-sha256.txt"
"# VerduraIdealposBridge build output manifest — generated $(Get-Date -Format o)" | Out-File $manifestOut -Encoding utf8
"# Built from a source tree verified against source-manifest-sha256.txt above." | Out-File $manifestOut -Append -Encoding utf8
Get-ChildItem $OutputDir -Recurse -File | Where-Object { $_.FullName -ne $manifestOut } | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
    $rel = $_.FullName.Substring($OutputDir.Length + 1)
    "$hash  $rel" | Out-File $manifestOut -Append -Encoding utf8
}

Write-Host ""
Write-Host "=== Package ready at $OutputDir ==="
Write-Host "Manifest: $manifestOut"
Write-Host ""
Write-Host "This directory still contains Idealpos's own vendor DLLs (copied from"
Write-Host "$IdealposInstallDir) alongside VerduraIdealposBridge.exe — that is expected"
Write-Host "and required for the exe to load them (see .csproj HintPath comments)."
Write-Host "Do NOT copy this directory anywhere off this machine without the same"
Write-Host "license basis Idealpos itself already has on this box."
Write-Host ""
Write-Host "Next: see install-locations.md for where this goes and how to run it"
Write-Host "manually in the foreground for the first controlled test — do NOT install"
Write-Host "the Windows Service yet."

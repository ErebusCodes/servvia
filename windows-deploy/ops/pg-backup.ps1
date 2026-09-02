<#
.SYNOPSIS
  Nightly logical backup of the Verdura production PostgreSQL database.

.DESCRIPTION
  Invoked by the `VerduraPostgresBackup` scheduled task.

  Path-parameterized per DL-114 S4: the PostgreSQL binary directory and the
  backup output directory are parameters, not hardcoded absolute paths.

  NO CREDENTIALS ARE STORED IN THIS FILE. Authentication uses the PostgreSQL
  password file of the account the task runs as — by default
  %APPDATA%\postgresql\pgpass.conf for the task principal. This preserves
  the existing credential mechanism exactly; do not add a password here.

  Relocated 2026-09-03 under DL-114 from
  `C:\Users\Posmate\Documents\verduraBridge\VerduraServerOps\pg-backup.ps1`,
  which hardcoded both the `VerduraPostgresBin` binary path and a backup
  output directory inside `verduraBridge`. Both of those directories are
  being eliminated.

.NOTES
  Behaviour is otherwise preserved as-is: same database, same user, same
  custom-format dump, same 14-file retention, same file naming.

  ONE DELIBERATE HARDENING: the original script pruned old dumps
  unconditionally, so a FAILED pg_dump still deleted the oldest good backup
  and silently eroded retention. This version exits non-zero on dump failure
  and does not prune. Retention depth and semantics are unchanged.
#>
[CmdletBinding()]
param(
    [string] $PgBinDir  = 'C:\Program Files\Verdura\PostgreSQL\18\bin',
    [string] $BackupDir = 'C:\ProgramData\Verdura\postgres\backups',
    [string] $DbHost    = 'localhost',
    [string] $DbUser    = 'verdura_admin',
    [string] $Database  = 'verdura_production',
    [int]    $RetainCount = 14
)

$ErrorActionPreference = 'Stop'

$pgDump = Join-Path $PgBinDir 'pg_dump.exe'
if (-not (Test-Path -LiteralPath $pgDump)) {
    Write-Error "pg_dump.exe not found at '$pgDump'. Check -PgBinDir."
    exit 2
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $BackupDir "$($Database)_$stamp.dump"

& $pgDump -h $DbHost -U $DbUser -F c -f $target $Database
$dumpExit = $LASTEXITCODE

if ($dumpExit -ne 0) {
    Write-Error "pg_dump failed with exit code $dumpExit. Retention prune SKIPPED so existing backups are preserved."
    exit $dumpExit
}
if (-not (Test-Path -LiteralPath $target) -or (Get-Item -LiteralPath $target).Length -eq 0) {
    Write-Error "pg_dump reported success but '$target' is missing or empty. Retention prune SKIPPED."
    exit 3
}

Write-Output "Backup written: $target ($([math]::Round((Get-Item -LiteralPath $target).Length / 1KB, 1)) KB)"

# Retention: keep the newest $RetainCount dumps in this directory (unchanged).
Get-ChildItem -LiteralPath $BackupDir -Filter '*.dump' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $RetainCount |
    Remove-Item -Force

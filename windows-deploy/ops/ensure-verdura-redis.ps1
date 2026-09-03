# Ensures Docker Desktop's engine is up and production Redis (this repo's
# docker-compose.yml `redis` service) is running/healthy. Intended to run
# from a Scheduled Task triggered at Posmate's logon (see
# "Verdura Redis Startup" task) — Docker Desktop on this host needs an
# interactive session to finish WSL2/engine init, so an at-logon Interactive
# task is used rather than a headless service trigger.
#
# Scope is deliberately narrow: this script starts ONLY the `redis` compose
# service. It never runs a bare `docker compose up -d` (which would also
# bring up the dev-only `postgres` service) and never passes --profile host
# (which would bring up API/frontend containers). Production PostgreSQL is
# the separate native VerduraPostgreSQL Windows service and is never
# touched here.
#
# Since 2026-09-03 that narrowness is structural, not just conventional: the
# compose file is `docker-compose.redis.yml`, a governed minimal manifest
# declaring only the `redis` service, deployed alongside this script in
# ProgramData. It no longer reads docker-compose.yml from the git checkout,
# so a branch checkout or `git clean` can no longer change what production
# Redis runs. The redis service block there was proven to resolve to a
# byte-identical `docker compose config` before cutover, so `up -d` adopts
# the existing `verdura-redis-1` container rather than recreating it.
#
# Idempotent and safe to re-run: if Redis is already healthy, this exits 0
# quickly without recreating or restarting anything.
#
# Relocated 2026-09-03 under DL-114 from
# `C:\Users\Posmate\Documents\verduraBridge\VerduraServerOps\ensure-verdura-redis.ps1`,
# which hardcoded its own location and wrote its log inside `verduraBridge`.
# That directory is being retired. Behaviour is otherwise unchanged; paths
# are now parameters per DL-114 S4 and the log defaults to ProgramData.

[CmdletBinding()]
param(
    [string] $ComposeFile      = 'C:\ProgramData\Verdura\ops\docker-compose.redis.yml',
    [string] $LogPath          = 'C:\ProgramData\Verdura\logs\ops\ensure-verdura-redis.log',
    [string] $DockerDesktopExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe',
    [string] $DockerExe        = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe',
    [string] $RedisContainer   = 'verdura-redis-1'
)

Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $ComposeFile)) {
    throw "Compose file not found: $ComposeFile"
}

$EngineReadyTimeoutSeconds = 300
$EngineReadyPollSeconds = 5
$RedisHealthyTimeoutSeconds = 60
$RedisHealthyPollSeconds = 3

$logDir = Split-Path -Parent $LogPath
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    Add-Content -Path $LogPath -Value $line
}

function Test-DockerEngineReady {
    & $DockerExe info *> $null
    return ($LASTEXITCODE -eq 0)
}

function Exit-WithFailure {
    param([string]$Reason)
    Write-Log "FAILED: $Reason"
    exit 1
}

Write-Log '--- ensure-verdura-redis run starting ---'

if (Test-DockerEngineReady) {
    Write-Log 'Docker engine already reachable.'
} else {
    Write-Log 'Docker engine not reachable yet.'
    $alreadyRunning = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue
    if (-not $alreadyRunning) {
        if (-not (Test-Path $DockerDesktopExe)) {
            Exit-WithFailure "Docker Desktop executable not found at $DockerDesktopExe"
        }
        Write-Log 'Launching Docker Desktop...'
        Start-Process -FilePath $DockerDesktopExe | Out-Null
    } else {
        Write-Log 'Docker Desktop process already running — waiting for engine.'
    }

    # Real wall-clock timing via Stopwatch — a cold WSL2 boot can make each
    # individual `docker info` probe itself block for many seconds, which
    # would silently undercount elapsed time if only the poll interval were
    # accumulated (observed during reboot testing: probes blocked long
    # enough that a naive poll-interval counter reported "5s" for a probe
    # that actually took ~3 minutes of wall-clock time).
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    while ($sw.Elapsed.TotalSeconds -lt $EngineReadyTimeoutSeconds) {
        if (Test-DockerEngineReady) {
            Write-Log ("Docker engine became ready after {0:N0}s." -f $sw.Elapsed.TotalSeconds)
            $ready = $true
            break
        }
        Write-Log ("Still waiting for Docker engine ({0:N0}s elapsed)..." -f $sw.Elapsed.TotalSeconds)
        Start-Sleep -Seconds $EngineReadyPollSeconds
    }
    if (-not $ready) {
        Exit-WithFailure "Docker engine did not become ready within ${EngineReadyTimeoutSeconds}s."
    }
}

Write-Log "Running: docker compose -f `"$ComposeFile`" up -d redis"
Push-Location (Split-Path -Parent $ComposeFile)
& $DockerExe compose -f $ComposeFile up -d redis 2>&1 | ForEach-Object { Write-Log "[compose] $_" }
$composeExit = $LASTEXITCODE
Pop-Location
if ($composeExit -ne 0) {
    Exit-WithFailure "docker compose up -d redis exited with code $composeExit"
}

Write-Log 'Waiting for Redis container health...'
$elapsed = 0
$healthy = $false
while ($elapsed -lt $RedisHealthyTimeoutSeconds) {
    $status = & $DockerExe inspect $RedisContainer --format '{{.State.Health.Status}}' 2>$null
    if ($status -eq 'healthy') {
        $healthy = $true
        break
    }
    Start-Sleep -Seconds $RedisHealthyPollSeconds
    $elapsed += $RedisHealthyPollSeconds
}
if (-not $healthy) {
    Exit-WithFailure "Redis container did not report healthy within ${RedisHealthyTimeoutSeconds}s."
}
Write-Log "Redis container healthy after ${elapsed}s."

$ping = & $DockerExe exec $RedisContainer redis-cli ping 2>$null
if ($ping -ne 'PONG') {
    Exit-WithFailure "redis-cli ping did not return PONG (got: $ping)"
}
Write-Log 'Redis PING = PONG. Production Redis is ready.'
Write-Log '--- ensure-verdura-redis run complete (success) ---'
exit 0

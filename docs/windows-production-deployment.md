# Windows Production Deployment Layout

**Status:** Normative — physical layout of the Windows production host
**Host:** `DESKTOP-SOKKOQ7`
**Effective:** 2026-08-27

See [`source-of-truth-and-environments.md`](./source-of-truth-and-environments.md)
for the roles/rules this layout exists to satisfy (GitHub as authoritative
source, the deployment verification gate, what environment-specific state
must never be committed).

## 1. Current verified layout

**The Windows application checkout is `C:\Users\Posmate\Documents\verdura_MVP`.**
This is a deliberate, operator-directed consolidation (2026-08-27): the
application source previously lived at
`verduraBridge\VerduraServer` (migrated there 2026-08-26); it has since
been cut over to `verdura_MVP` as the single, permanent application
checkout, for operational-standardization reasons unrelated to either
checkout's historical health. `verduraBridge\` remains the root for
operational/integration components that are **not** the application
source itself:

```
C:\Users\Posmate\Documents\verdura_MVP\           # the git-tracked application
                                                   # deployment source — backs
                                                   # VerduraAPI, VerduraOrderTablet,
                                                   # VerduraAdminConsole,
                                                   # VerduraCustomerWebsite,
                                                   # VerduraWindowDisplay

C:\Users\Posmate\Documents\verduraBridge\
  VerduraServerOps\                # operational scripts/tooling for the host
  VerduraOrderTabletConnector\    # Connector deployment (publish-output copy,
                                   # not itself a git repo — rebuilt from
                                   # the application checkout and copied in)
  verduraIdealposBridge\          # IdealposBridge service deployment
  verduradb-backups\              # PostgreSQL backup output (pg-backup.ps1
                                   # target — machine-local, never committed)
  VerduraServer.retired-<timestamp>\  # retired duplicate — see §5
```

`verdura_MVP` is the single git-tracked deployment source and is the
directory the [deployment verification gate](#3-deployment-verification-gate)
applies to. Additional non-application directories (e.g. `migration-state\`
under `verduraBridge\`) may also exist; they are outside the scope of this
document.

## 2. Currently deferred (not yet migrated)

Two directories remain intentionally outside `verduraBridge\`, still at
their original location:

```
C:\Users\Posmate\Documents\VerduraPostgresBin
C:\Users\Posmate\Documents\verduradb
```

Both exist and are in active use by the running `VerduraPostgreSQL` service.
Their migration is planned but **not executed** — see
[§7](#7-postgresql-migration-maintenance-plan--draft-not-executed) below
for the drafted maintenance plan and
[`deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md)
for the tracked item. PostgreSQL must not be stopped and neither directory
may be moved without explicit, separate approval for a maintenance window.
This is unaffected by the application-checkout consolidation in §1/§5.

## 3. Deployment verification gate

Run from `C:\Users\Posmate\Documents\verdura_MVP`:

```powershell
git fetch origin
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

**Pass condition:** `git rev-parse HEAD` equals `git rev-parse origin/main`
exactly, and `git status --short` prints nothing for tracked files. This is
a precondition to re-run at the start of every deployment session, not a
one-time fact — see
[`source-of-truth-and-environments.md` §3](./source-of-truth-and-environments.md#3-deployment-verification-gate)
for the full rule and what counts as expected untracked state (this
checkout's own expected untracked entries: the nested `verdura_MVP\`
subtree, see §5, and build output such as `apps/admin-console/dist-admin\`).

## 4. Customer Website and Window Display persistent launch

Both frontends run as **NSSM-managed Windows services** that serve a
production build through `windows-deploy/static-proxy-server.mjs` — exactly
the mechanism Order Tablet and Admin Console already use:

| Service | Port | `dist` served |
| --- | --- | --- |
| `VerduraCustomerWebsite` | 5173 | `apps\customer-website\dist` |
| `VerduraWindowDisplay` | 5174 | `apps\window-display\dist` |

Both are configured identically to `VerduraOrderTablet` /
`VerduraAdminConsole`: `Start SERVICE_AUTO_START`, `ObjectName LocalSystem`,
`DependOnService :VerduraAPI`, `AppExit Default Restart` with
`AppRestartDelay 5000`, and `AppDirectory
C:\Users\Posmate\Documents\verdura_MVP`. Logs go to
`verduraBridge\VerduraServerOps\customer-website-{stdout,stderr}.log` and
`window-display-{stdout,stderr}.log`.

`static-proxy-server.mjs` binds `0.0.0.0`, so both are reachable across the
LAN (`http://192.168.1.250:5173/`, `http://192.168.1.250:5174/`), and it
proxies `/api/`, `/socket.io/` and `/media/` same-origin to
`http://127.0.0.1:3000`. Both apps' `.env` deliberately leave
`VITE_API_URL` empty so the browser calls the same origin it loaded from —
a LAN phone or tablet must never be handed a `127.0.0.1` API URL, which on
that device resolves to the device itself. Matching the existing 5176/5177
rules, inbound firewall rules `Verdura Customer Website (5173)` and
`Verdura Window Display (5174)` (TCP, Domain+Private) allow LAN access.

Rebuild after a code change with `npm run build:customer-website` /
`npm run build:window-display` from the repo root, then
`Restart-Service VerduraCustomerWebsite` / `VerduraWindowDisplay`. Neither
`dist\` is committed — both are gitignored build output.

**Superseded 2026-09-01: the `Verdura Window Display` Scheduled Task.**
Window Display previously ran `npm run dev` (a Vite dev server) from a
logon-triggered Scheduled Task, because launching it with `Start-Process`
over the Win32 OpenSSH session used for remote administration killed the
process as soon as that SSH session ended. By 2026-09-01 the task had
stopped serving 5174 altogether — `LastTaskResult 3221225786`
(`0xC000013A`, `STATUS_CONTROL_C_EXIT`): its console had been terminated,
and nothing restarted it. The task is now **disabled, not deleted** (kept
for rollback and history). The NSSM service supersedes it and is strictly
better: it starts at boot with no interactive logon, restarts itself on
failure, and serves a production build rather than a dev server. Do not
re-enable the task — it would race the service for port 5174.

## 5. Application-checkout consolidation (2026-08-27)

**Current state: `verdura_MVP` is the sole active application checkout.**
It was reconciled from a stale historical clone (previously at
`C:\Users\Posmate\Desktop\verdura_MVP`, then relocated to
`C:\Users\Posmate\Documents\verdura_MVP`) up to current `origin/main`
before cutover — see git history of this document for the prior
"non-authoritative legacy clone" designation and the full reconciliation
record (fast-forward merge, corrected machine-local `.env`/`VITE_VENUE_ID`
config copied from the prior checkout, clean build and 108/108 targeted
tests, before any service was repointed).

**Nested `verdura_MVP\verdura_MVP\` subtree — still preserved, still not
production data.** This is a real, historical local-dev PostgreSQL data
directory (`verdura_MVP\verdura_MVP\local-postgres\data\docker\` —
confirmed via `PG_VERSION`/`pg_wal`/`base`/`global\pg_control`), a leftover
from before the original Desktop→Documents relocation. It is untracked,
unrelated to production (production Postgres is the separate native
Windows service described in §2), and remains untouched pending a
separate, deliberate review — do not delete or migrate it as a side
effect of any other task.

**Retired duplicate: `verduraBridge\VerduraServer.retired-<timestamp>\`.**
The former application checkout was audited before cutover (git HEAD/
status confirmed clean and identical to `verdura_MVP` post-reconciliation;
every untracked file classified — debug/one-off production-bootstrap
`.mjs` scripts and a stock-items export preserved into
`verdura_MVP\_preserved-from-VerduraServer\` for reference, build output
and dev-session logs confirmed disposable/reproducible) and then renamed
(not deleted) to preserve a full rollback path. It is retired, not in any
active NSSM/scheduled-task/script reference — confirmed by a full scan —
and may be permanently deleted once production has run stably from
`verdura_MVP` for a satisfactory period; do not recreate a `VerduraServer`
checkout afterward.

**Prior incidents this consolidation is downstream of:** this same
checkout (prior to reconciliation) caused two real incidents — a stale
`VITE_VENUE_ID` outage (documented in
[`dl-107-dunedin-live-certification-runbook.md` §1c`](../_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md)),
and, separately, an unmanaged process serving the pre-reconciliation
(stale) checkout's code exposed the "Imported from IdealPOS (pending
review)" staging category on the public Window Display because that stale
commit predated the `normalizePublicMenu()` `isAvailable` filter. Both are
resolved as of this consolidation: `verdura_MVP` is now reconciled to
current `main` (which contains the filter), machine-local config is
corrected, and Window Display has exactly one managed launch path (§4).
The underlying rule — "no second editable production clone" — is in
[`source-of-truth-and-environments.md`](./source-of-truth-and-environments.md#2-the-rule).

## 6. Related documents

- [`source-of-truth-and-environments.md`](./source-of-truth-and-environments.md) —
  environment roles and the rule this layout exists to satisfy.
- [`../_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md`](../_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md) —
  the live-order certification runbook, including the historical path-layout
  investigations that predate this consolidation.
- [`../_bmad-output/implementation-artifacts/deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md) —
  the PostgreSQL migration plan and other tracked deferred items.

## 7. PostgreSQL migration maintenance plan — DRAFT, NOT EXECUTED

**Status: plan only. Do not execute any step below without explicit,
separate approval for a maintenance window.** PostgreSQL must not be
stopped and neither directory below may be moved until that approval is
given.

**Scope:** move
`C:\Users\Posmate\Documents\VerduraPostgresBin` →
`C:\Users\Posmate\Documents\verduraBridge\VerduraPostgresBin`, and
`C:\Users\Posmate\Documents\verduradb` →
`C:\Users\Posmate\Documents\verduraBridge\verduradb`.

**Baseline (recorded 2026-08-27, re-verify freshly before any real
attempt):**

| Item | Value |
| --- | --- |
| PostgreSQL binary identity | `PostgreSQL 18.6` (`pg_ctl.exe --version` / `postgres.exe --version`, both under `VerduraPostgresBin\pgsql\bin\`) |
| Service PathName (`VerduraPostgreSQL`) | `"C:\Users\Posmate\Documents\VerduraPostgresBin\pgsql\bin\pg_ctl.exe" runservice -N "VerduraPostgreSQL" -D "C:\Users\Posmate\Documents\verduradb" -w` |
| Data directory (`-D`) | `C:\Users\Posmate\Documents\verduradb` |
| `pg_isready` baseline | `localhost:5432 - accepting connections` |
| `GET /api/health` baseline | `{"status":"ok","db":"ok","redis":"ok"}` |
| `pg-backup.ps1` location | `C:\Users\Posmate\Documents\verduraBridge\VerduraServerOps\pg-backup.ps1` — its `$backupDir` already correctly points at `verduraBridge\verduradb-backups`; only its hardcoded `pg_dump.exe` path (`...\Documents\VerduraPostgresBin\pgsql\bin\pg_dump.exe`) needs updating to the new location |
| Backup target database | `verdura_production`, via `pg_dump -h localhost -U verdura_admin -F c` |

**Procedure (to run only during an approved maintenance window):**

1. **Pre-migration backup + restore validation.** Run `pg-backup.ps1` to
   produce a fresh dump into `verduraBridge\verduradb-backups\`. Restore
   that dump into a scratch/throwaway database (not `verdura_production`)
   with `pg_restore` and spot-check row counts against
   `verdura_production` to prove the backup is actually restorable, not
   just present.
2. **Record current state** (binary identity, service `PathName`, `-D`
   path, `pg_isready`, `GET /api/health`) — see baseline table above; this
   step re-captures it fresh at execution time rather than trusting this
   document's dates.
3. **Check for active DB sessions/transactions** (`SELECT * FROM
   pg_stat_activity WHERE datname = 'verdura_production' AND pid <>
   pg_backend_pid();`) — confirm no live application traffic or long-running
   transaction before shutdown; coordinate a quiet window with whoever owns
   the live venue if any activity is found.
4. **Clean PostgreSQL service shutdown** (`Stop-Service VerduraPostgreSQL`
   or `pg_ctl stop -m fast` against the current data directory) — never a
   forced kill as the first resort.
5. **Confirm all `postgres.exe` processes have exited**
   (`Get-Process postgres -ErrorAction SilentlyContinue` returns nothing)
   before touching any file.
6. **Move both directories** into `verduraBridge\` (`Move-Item`), then
   **verify the move** — file/subdirectory counts and total size of the
   source tree before the move must match the destination tree after
   (e.g. `Get-ChildItem -Recurse | Measure-Object -Property Length -Sum`
   compared before/after). No file content is read or altered — this is a
   verification of completeness, not a data check.
7. **Update the `VerduraPostgreSQL` service's `binPath`** (`sc.exe config
   VerduraPostgreSQL binPath= ...`, or NSSM's equivalent if it's
   NSSM-managed — confirm which before writing the command) to reference
   the new binary path and the new `-D` data-directory path.
8. **Update `pg-backup.ps1`** to reference the new `pg_dump.exe` path
   under `verduraBridge\VerduraPostgresBin\pgsql\bin\` (its `$backupDir`
   already needs no change — see baseline table).
9. **Start PostgreSQL** (`Start-Service VerduraPostgreSQL`).
10. **`pg_isready`** against the new binary — must again report `accepting
    connections`.
11. **Database connectivity check** — a real query against
    `verdura_production` (e.g. `psql -c "SELECT 1"`) from the new binary
    path.
12. **`GET /api/health`** — must again report `"db":"ok"`, matching the
    pre-migration baseline exactly.
13. **Backup task test** — run the updated `pg-backup.ps1` once and confirm
    a new dump lands in `verduraBridge\verduradb-backups\` with a
    plausible size (not zero/truncated).
14. **Service/runtime stale-path search** — grep NSSM configs, scheduled
    tasks, and any script under `verduraBridge\` for the old
    `Documents\VerduraPostgresBin` / `Documents\verduradb` path strings to
    catch anything not already covered by steps 7–8.

**Rollback plan (if any step 4–13 fails):** stop the service if running,
move both directories back to their original `Documents\` locations,
restore the service's original `binPath` (recorded in step 2), start the
service, and re-run `pg_isready` + `GET /api/health` to confirm the
pre-migration baseline is restored. No step in this plan modifies database
contents — every step through 13 is shutdown/filesystem/service-config
only, and no migration step in this plan is ever run while PostgreSQL is
still running against the directories being moved.

**Estimated affected services:** `VerduraPostgreSQL` directly; `VerduraAPI`
transitively (loses its database during the outage window) and anything
depending on `GET /api/health` reporting `db:ok`. `VerduraOrderTablet`,
`VerduraAdminConsole`, `VerduraConnector`, and IdealposBridge do not
connect to Postgres directly but will surface API errors for the same
window.

**Estimated required outage:** the interval between steps 4 (shutdown) and
9 (service start) — expected to be short (filesystem move + two config
edits) but has not been timed against the real data directory's size; time
step 6 during a rehearsal/dry run before committing to a live window.

## 8. Redis reboot persistence

**Production Redis is Docker-backed, not a native Windows service.** It is
this repo's own `docker-compose.yml` `redis` service (`redis:7-alpine`,
`restart: unless-stopped`, `127.0.0.1:6379->6379`, named volume
`verdura-redis`, healthcheck `redis-cli ping`). Docker Desktop's own
Windows service (`com.docker.service`) is `StartMode: Manual` and, on this
host, does not reliably bring the engine up by itself — confirmed
2026-08-27: starting only that service left the daemon unreachable after
90s, while launching `Docker Desktop.exe` in an interactive session
succeeded within seconds. **Prior incident (2026-08-27):** a full Windows
reboot left Docker's engine down; `VerduraAPI` stayed running throughout
but every `RateLimitGuard`-guarded request (including the public menu) and
`/api/health` hung indefinitely rather than failing fast, because the
guard's Redis client is configured with `maxRetriesPerRequest: null` (a
setting that's correct for BullMQ, not for a bounded per-request check —
tracked as a separate source-level follow-up, not yet implemented). Once
Redis was manually restored, the existing `VerduraAPI` process self-healed
via ioredis's automatic reconnection — no API restart was needed. This
section's mechanism exists so that manual recovery step is never required
again.

**Permanent mechanism: the `Verdura Redis Startup` Scheduled Task.**
Triggered `AtLogOn` for `Posmate` (Interactive logon type, highest run
level) — an `AtStartup`/System-context trigger was considered but rejected
based on the `com.docker.service`-alone evidence above: Docker Desktop on
this host needs an interactive session to finish initializing reliably, so
`AtLogOn` is the proven mechanism (it was also, until 2026-09-01, how
Window Display started — see §4, now an NSSM service with no such
dependency). **This has a real consequence:** after a cold boot, Redis does
not come back until `Posmate` has an interactive logon —
confirmed in practice to happen automatically via AnyDesk's own
unattended-access auto-connect (verified during the 2026-08-27 reboot
test, Explorer running in Session 1 within ~4 seconds of boot), but this
is external to Windows itself (`AutoAdminLogon` is deliberately `0` /
disabled — enabling it was considered and explicitly declined, since it
would let anyone with console/KVM access bypass the Windows login screen
entirely). NSSM-managed services (`VerduraAPI`, `VerduraOrderTablet`,
`VerduraAdminConsole`, `VerduraCustomerWebsite`, `VerduraWindowDisplay`,
`VerduraConnector`, `VerduraPostgreSQL`) have no such dependency and start
on boot regardless.

The task runs one wrapper script:
`C:\Users\Posmate\Documents\verduraBridge\VerduraServerOps\ensure-verdura-redis.ps1`
(chosen over an inline task action because reliable quoting of paths
containing spaces, e.g. `C:\Program Files\Docker\...`, inside a `cmd.exe
/c "..."` action argument is fragile — confirmed the hard way during
Window Display's own task setup). The script, idempotent and safe to
re-run at any time:

1. Probes `docker info`; if already reachable, skips straight to step 4.
2. If not reachable and `Docker Desktop.exe` isn't already running,
   launches it (`Start-Process`, non-blocking — safe here because the
   *task itself* already runs in the correct interactive session via its
   `AtLogOn` trigger, unlike a plain `Start-Process` over an SSH session).
3. Polls `docker info` every 5s against a 300s wall-clock budget (tracked
   via `Stopwatch`, not an assumed-per-iteration counter — an earlier
   version undercounted elapsed time because individual `docker info`
   calls can themselves block for a long time during a cold WSL2 boot;
   observed during reboot testing: one real engine-ready wait took ~173s
   of actual wall-clock time). Exits non-zero with a clear log message if
   the budget is exceeded — it never hangs forever.
4. Runs `docker compose -f
   C:\Users\Posmate\Documents\verdura_MVP\docker-compose.yml up -d
   redis` — the explicit `-f` path and the explicit `redis` service name
   are both deliberate: this must never bring up the compose file's
   `postgres` service (dev-only, see below) or, with `--profile host`,
   the API/frontend containers, and never has.
5. Waits (bounded, 60s) for the container's own healthcheck to report
   `healthy`, then confirms `redis-cli ping` returns `PONG`.
6. Logs every step with a timestamp to
   `verduraBridge\VerduraServerOps\ensure-verdura-redis.log`; exits 0 only
   on confirmed success.

There is exactly one Redis-related Scheduled Task — no one-shot tasks were
left behind from the incident-response session that first restored Redis
manually.

**Dev-only Docker containers do not auto-start.** Two containers
(`verdura-postgres-1` — this same compose project's dev `postgres`
service, host port 5434, database `verdura_dev`; and
`verdura-local-postgres` — a separate `local-postgres` compose project,
no host port exposed) both previously had `restart: unless-stopped` and
auto-started alongside Redis whenever Docker's engine came back, which is
what caused Docker to be blamed for "starting things it shouldn't" during
the original incident response. Neither is referenced by production in
any way — confirmed by inspecting `apps/api/.env`'s `DATABASE_URL`
directly (`localhost:5432`, the native `VerduraPostgreSQL` Windows
service, never `5434` or the local-postgres project) — so both were
changed to `docker update --restart=no <container>` (2026-08-27). Their
data (both Docker-managed named volumes, not bind mounts to any host
path) was not touched, and neither container was deleted. **Verified
across a real reboot:** both remained `Exited`, not restarted, while Redis
came back healthy — confirming the policy change persists across a full
Docker Desktop restart, not just a `docker update` in a live session.

**Reboot-tested end-to-end (2026-08-27).** A full, controlled Windows
reboot was performed. Post-reboot, with no manual SSH/AnyDesk launch of
Docker or Redis: `Verdura Redis Startup` and `Verdura Window Display` both
fired at logon; Docker's engine came up (~173s cold-boot wait, within
budget); Redis came up healthy, `PING` = `PONG`; the two dev-only
containers stayed `Exited`; `VerduraAPI`/`VerduraOrderTablet`/
`VerduraAdminConsole`/`VerduraPostgreSQL`/`VerduraConnector` were all
`Running` from their NSSM auto-start (unaffected by any of the above);
`GET /api/health` returned `{"status":"ok","db":"ok","redis":"ok"}`; the
public Window Display menu rendered all 10 curated categories with no
"Imported from IdealPOS (pending review)" category and no unavailable
staging items visible, verified against the live rendered page, not just
the raw API response.

**Known residual gap, not addressed by this section:** the underlying
code-level defect that turned the original Redis outage into a *hang*
instead of a fast, bounded degraded response (`RateLimitGuard`'s shared
`REDIS_CLIENT`, and `HealthService`'s own untimed Redis probe) has not
been fixed in source. This section makes the outage far less likely and
fully self-healing without human intervention — it does not make
`/api/health` or guarded requests fail fast during the (now much shorter)
window before Redis comes back. See
[`../_bmad-output/implementation-artifacts/deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md)
for the tracked follow-up.

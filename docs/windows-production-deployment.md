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
                                                   # VerduraAdminConsole, Window Display

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

## 4. Window Display persistent launch

The Window Display dev server (`apps/window-display`, port 5174) runs via
a **permanent Scheduled Task** named `Verdura Window Display`, triggered
at logon for `Posmate` (Interactive logon type, highest run level), with
`WorkingDirectory` set to `C:\Users\Posmate\Documents\verdura_MVP` and
action `cmd.exe /c npm run dev --workspace=apps/window-display -- --host
0.0.0.0 --port 5174`, stdout/stderr redirected to
`verduraBridge\VerduraServerOps\window-display.out.log` /
`.err.log`. Reason a Scheduled Task is required at all: launching Window
Display via `Start-Process` over the Win32 OpenSSH session used for remote
administration causes the process to die the moment that SSH session
ends — it is a child of the SSH-spawned process tree, not a true detached
process; a Scheduled Task launches it outside that process tree so it
survives both the SSH session closing and, via its logon trigger, a host
reboot.

This is a known operational workaround, not an NSSM-managed service — the
three NSSM-managed application services (`VerduraAPI`, `VerduraOrderTablet`,
`VerduraAdminConsole`) plus `VerduraConnector`, `VerduraPostgreSQL`, and the
IdealposBridge service remain the actual NSSM-managed production service
set. There must be exactly one `Verdura Window Display` task; do not
create a second one-shot or ad-hoc task — reuse/redeploy this one if the
launch command ever needs to change.

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

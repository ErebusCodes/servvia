# Windows Production Deployment Layout

**Status:** Normative — physical layout of the Windows production host
**Host:** `DESKTOP-SOKKOQ7`
**Effective:** 2026-08-27

See [`source-of-truth-and-environments.md`](./source-of-truth-and-environments.md)
for the roles/rules this layout exists to satisfy (GitHub as authoritative
source, the deployment verification gate, what environment-specific state
must never be committed).

## 1. Current verified layout

All application deployment sources live under one root,
`C:\Users\Posmate\Documents\verduraBridge\`, migrated and verified
2026-08-26/27:

```
C:\Users\Posmate\Documents\verduraBridge\
  VerduraServer\                  # the git-tracked deployment source — backs
                                   # VerduraAPI, VerduraOrderTablet,
                                   # VerduraAdminConsole, Window Display
  VerduraServerOps\                # operational scripts/tooling for the host
  VerduraOrderTabletConnector\    # Connector deployment (publish-output copy,
                                   # not itself a git repo — rebuilt from
                                   # VerduraServer and copied in)
  verduraIdealposBridge\          # IdealposBridge service deployment
  verduradb-backups\              # PostgreSQL backup output (pg-backup.ps1
                                   # target — machine-local, never committed)
```

Each of the five directories above has been directly verified present on
the host (2026-08-27). `VerduraServer` is the single git-tracked deployment
source and is the directory the [deployment verification gate](#3-deployment-verification-gate)
applies to.

Additional non-application directories (e.g. `migration-state\`) may also
exist under this root; they are outside the scope of this document.

## 2. Currently deferred (not yet migrated)

Two directories remain intentionally outside `verduraBridge\`, still at
their original location:

```
C:\Users\Posmate\Documents\VerduraPostgresBin
C:\Users\Posmate\Documents\verduradb
```

Both exist and are in active use by the running `VerduraPostgreSQL` service.
Their migration into `verduraBridge\` is planned but **not executed** — see
[§7](#7-postgresql-migration-maintenance-plan--draft-not-executed) below
for the drafted maintenance plan and
[`deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md)
for the tracked item. PostgreSQL must not be stopped and neither directory
may be moved without explicit, separate approval for a maintenance window.

## 3. Deployment verification gate

Run from `C:\Users\Posmate\Documents\verduraBridge\VerduraServer`:

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
for the full rule and what counts as expected untracked state.

## 4. Window Display persistent launch

The Window Display dev server (`apps/window-display`, port 5174) is
currently launched via a one-shot **Scheduled Task** rather than a plain
`Start-Process`. Reason: when Window Display is started with
`Start-Process` over the Win32 OpenSSH session used for remote
administration, the process dies the moment that SSH session ends — it is
a child of the SSH-spawned process tree, not a true detached process. A
Scheduled Task (run once, on demand) launches it outside that process
tree, so it survives the SSH session closing. This is a known operational
workaround, not a production service — the four NSSM-managed services
(`VerduraAPI`, `VerduraOrderTablet`, `VerduraAdminConsole`,
`VerduraConnector`) plus `VerduraPostgreSQL` and the IdealposBridge service
remain the actual production service set.

## 5. Non-authoritative legacy clone (relocated, still not in use)

A second, non-authoritative Verdura checkout exists on the same host:

- **Path:** `C:\Users\Posmate\Documents\verdura_MVP`
- **Role:** legacy / non-authoritative clone
- **Production dependency:** none found — verified 2026-08-27 by inspecting
  every `Verdura*` NSSM service's `AppDirectory`/`AppParameters`; all five
  reference only `verduraBridge\...` paths, none reference this clone
- **Git remote:** same Verdura GitHub repository
- **Branch:** `main`
- **Status:** stale checkout / non-production

**Relocated 2026-08-27.** This clone previously sat at
`C:\Users\Posmate\Desktop\verdura_MVP` and an initial directory-level move
attempt failed with `Access is denied`. Investigation (in-place rename of
the actual directory succeeded; a disposable Desktop→Documents test
directory moved cleanly; no reparse point, ACL DENY entry, or referencing
process/service/scheduled task was ever found) never identified a
persistent blocking cause, and a subsequent retry of the identical,
non-forceful `Move-Item` succeeded outright — recursive item count
(68,694 files / 7,282 directories) and total byte size (1,031,247,662
bytes) matched exactly before and after, `.git`, `HEAD`
(`0a7c2865e0d704fbaa1b1c57e455e529f571f1c9`), branch, `git status
--short`, the nested untracked `verdura_MVP\verdura_MVP\` subtree, and the
GitHub remote were all confirmed unchanged post-move.

Rules while it remains in place:

- Must not be used for production runtime or new development.
- Must not be treated as a source of truth.
- Any unique work found in it must be reconciled into GitHub before
  eventual archival.
- Do not delete it.

This same clone previously caused a real incident (documented in
[`dl-107-dunedin-live-certification-runbook.md` §1c`](../_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md)):
a Window Display dev server was found running from this Desktop clone
instead of the canonical deployment source, serving a stale `VITE_VENUE_ID`
and causing a production menu outage. This is the concrete example of why
"no second editable production clone" is a rule in
[`source-of-truth-and-environments.md`](./source-of-truth-and-environments.md#2-the-rule),
not just a hygiene preference.

## 6. Related documents

- [`source-of-truth-and-environments.md`](./source-of-truth-and-environments.md) —
  environment roles and the rule this layout exists to satisfy.
- [`../_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md`](../_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md) —
  the live-order certification runbook, including the historical path-layout
  investigation (§1b/§1c) that predates the `verduraBridge` migration.
- [`../_bmad-output/implementation-artifacts/deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md) —
  the PostgreSQL migration plan and the Desktop-clone relocation item.

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

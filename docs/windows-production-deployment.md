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
[`deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md)
for the tracked item and the drafted maintenance plan referenced there.
PostgreSQL must not be stopped and neither directory may be moved without
explicit, separate approval for a maintenance window.

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

## 5. Non-authoritative Desktop clone (blocked, not in use)

A second, non-authoritative Verdura checkout exists on the same host:

- **Path:** `C:\Users\Posmate\Desktop\verdura_MVP`
- **Role:** legacy / non-authoritative clone
- **Production dependency:** none found
- **Git remote:** same Verdura GitHub repository
- **Branch:** `main`
- **Status:** stale checkout / non-production

**Current filesystem state (verified 2026-08-27): this clone has not been
moved.** It is still at `C:\Users\Posmate\Desktop\verdura_MVP`. It has
**not** been moved to `C:\Users\Posmate\Documents\verdura_MVP`, and it has
**not** been moved to
`C:\Users\Posmate\Documents\verduraBridge\source\verdura_MVP-from-desktop-20260827`.
An attempted directory-level move failed because the top-level directory
node is held open by an unidentified process; no partial move occurred.

Rules while it remains in place:

- Must not be used for production runtime or new development.
- Must not be treated as a source of truth.
- Any unique work found in it must be reconciled into GitHub before
  eventual archival/relocation.
- Do not delete it.
- Do not force-kill processes solely to force the move through.
- Revisit relocation only after the handle holder is identified safely.

The desired eventual destination is `C:\Users\Posmate\Documents\verdura_MVP`
— that is a future cleanup step, not the current state. See
[`deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md)
for the tracked relocation item.

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

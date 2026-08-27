# Source of Truth and Environments

**Status:** Normative — governs how code moves between environments
**Effective:** 2026-08-27

This document defines which environment owns which kind of state, and the
verification gate that must pass before any Windows deployment is
considered production-correct. See
[`windows-production-deployment.md`](./windows-production-deployment.md)
for the physical layout of the Windows host itself.

## 1. Roles

| Environment | Role |
| --- | --- |
| **GitHub `main`** | The single authoritative source of Verdura application code. If Windows or Mac disagrees with it, `main` wins. |
| **Mac** | Primary development environment. All feature work, review, and merges to `main` originate here. |
| **Windows (`DESKTOP-SOKKOQ7`)** | Production/integration deployment environment. Runs the live services against the real DUNEDIN IdealPOS installation. It is a *deployment target*, not a second place to develop. |

## 2. The rule

**Windows source must not diverge from GitHub.** The Windows checkout is
expected, at all times, to be a clean working tree at a commit that exists
on `origin/main`. A commit made or amended only on Windows and never pushed
is not real — it exists nowhere else and will be lost the next time the
Windows repo is force-synced or the host is rebuilt.

**Emergency Windows-side source fixes must be reconciled back into GitHub
immediately** — same day, not "when convenient." If a fix genuinely has to
be made directly on the Windows box because the venue is live and broken
(e.g. mid-service), the sequence is:

1. Make the minimal fix directly in the Windows checkout.
2. Restart only the affected service(s) and confirm the venue is unblocked.
3. Within the same session, commit that exact change, push it to a branch,
   open a PR, and merge it to `main` — do not silently let Windows and
   GitHub disagree.
4. Re-run the [deployment verification gate](#3-deployment-verification-gate)
   once the merge lands, to confirm Windows now matches the merged commit
   exactly (not just "contains an equivalent fix").

**No second editable production clone may be used.** Windows must have
exactly one live, git-tracked checkout of the application acting as the
deployment source (currently `C:\Users\Posmate\Documents\verdura_MVP`). A
second clone sitting on the same box that anyone could edit and which any
service might accidentally be pointed at is exactly the failure mode this
document exists to prevent — see the consolidation history in
[`windows-production-deployment.md`](./windows-production-deployment.md#5-application-checkout-consolidation-2026-08-27)
for two real examples of how that happens by accident.

## 3. Deployment verification gate

Before treating any Windows deployment as production-correct, run this
from the deployment source directory on the Windows host:

```powershell
git fetch origin
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

**Pass condition:** `git rev-parse HEAD` must equal `git rev-parse
origin/main` exactly, and `git status --short` must print nothing (a
clean tracked working tree). Untracked files are expected and do not fail
this gate — see §4. A tracked-file modification, or `HEAD` not equal to
`origin/main`, means: stop, do not treat the deployment as verified, and
resolve the drift (fast-forward, or reconcile per §2) before doing
anything else.

This gate is a **precondition**, not a one-time fact — re-run it at the
start of every deployment session and every certification/runbook
procedure that touches the Windows host (e.g. DL-107's own precondition
checklist), rather than trusting a previous session's recorded commit
hash.

## 4. What is expected environment-specific state (never committed)

The following are expected to differ between Mac, GitHub, and Windows, and
must never be committed to the repository:

- machine-local runtime configuration (`.env` files, NSSM service
  arguments, port bindings for this specific host);
- credentials, API keys, and enrollment tokens (e.g. the Bridge API key,
  the Connector's enrollment credential, the owner token used by
  operational scripts);
- logs (stdout/stderr redirection targets, application log files);
- database files and PostgreSQL data directories;
- database backups/dumps;
- Windows service registration state (NSSM configuration itself lives in
  the Windows service registry, not in the repository);
- Connector enrollment/installation identity.

A `git status --short` on the Windows deployment showing untracked debug
scripts, log files, or a build-output directory is normal and does not
indicate drift, provided none of them are *tracked* files with local
modifications. The gate in §3 checks for exactly that distinction.

## 5. Related documents

- [`windows-production-deployment.md`](./windows-production-deployment.md) —
  current physical layout of the Windows host, per-service configuration
  summary, and the deferred PostgreSQL migration plan.
- [`../_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md`](../_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md) —
  the live-order certification runbook; its own precondition checklist
  applies this document's verification gate.
- [`../_bmad-output/implementation-artifacts/deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md) —
  tracks outstanding deferred items, including the PostgreSQL
  binaries/data migration.

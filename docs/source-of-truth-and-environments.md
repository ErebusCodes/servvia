# Source of Truth and Environments

**Status:** Normative — governs how code moves between environments
**Effective:** 2026-08-28

This document defines the roles of environments, secure access rules, the standing session protocol, and safety constraints that govern all work in the Servvia repository.

Future implementation sessions (including those by AI coding assistants like Claude) should begin by reading and following this operating procedure. Do not rely on conversational memory when repository documentation provides the current operating policy.

See [`windows-production-deployment.md`](./windows-production-deployment.md) for the physical layout and service configurations of the Windows host.

---

## 1. Environment Roles and Source of Truth

The authoritative Git remote repository (`origin/main`) is the single authoritative source of truth for tracked code, while other environments serve specific operational roles.

| Environment / Role | Classification | Purpose & Constraints |
| --- | --- | --- |
| **Git Remote `origin/main`** | Authoritative Tracked Source | The single authoritative source of truth for all tracked Servvia application code. If any local checkout disagrees with it, `main` wins. |
| **Windows (`DESKTOP-SOKKOQ7`)** | Primary Production-Facing Work/Integration Surface | The primary surface for production-facing implementation, deployment, IdealPOS/connector/bridge validation, service configuration, and live integration work. It is **not** the source of truth; all changes here must be committed, pushed, and verified against the Git remote. |
| **Mac** | Synchronized Development & Review Environment | A local development and review environment. All offline feature work, review, and sync validations occur here. |

---

## 2. Secure Windows Access (SSH)

SSH is the preferred secure mechanism for remote Windows access, command execution, and cross-system verification/synchronization.

### Connection Parameters
*   **Host IP:** `47.72.154.80`
*   **Port:** `49222`
*   **Windows User:** `Posmate`
*   **Access Credentials:** Authentication is managed via authorized SSH key files (e.g., `~/.ssh/verdura_windows_ed25519` generic pattern).

> [!IMPORTANT]
> **Credential & Key Security:**
> Do NOT commit SSH private keys, private key files, passwords, or host-specific credentials to the repository. If referencing local paths, do so only generically.

---

## 3. Session Protocol (Standard Operating Procedure)

Every implementation session must strictly adhere to the following sequence to prevent code drift and protect the production environment.

### 3.1 Session Start
1.  **Windows Verification:** Log into the Windows host via SSH and run:
    ```powershell
    git fetch origin
    git status --short
    git rev-parse HEAD
    git rev-parse origin/main
    ```
2.  **Clean Tree Check:** The Windows working tree must be clean (no modified tracked files) unless the session is explicitly continuing known, documented work.
3.  **Synchronization Check:** Windows `HEAD` must equal `origin/main` before any new tracked work begins.
4.  **Checkout Verification:** Verify that you are working in the canonical Windows application checkout directory:
    `C:\Users\Posmate\Documents\verdura_MVP`
    Do not use retired, stale, or backup checkouts (e.g., legacy `VerduraServer` checkouts).

### 3.2 During Work
1.  **Production-Facing Work:** Make production-facing changes on Windows when they require interaction with the actual Windows host, IdealPOS, connector, or bridge environment.
2.  **Environment Isolation:** Keep all machine-local secrets and configurations out of Git (see §5).
3.  **Local Testing:** Run targeted tests first, followed by broader deterministic quality gates.
4.  **Production Safety:** Strictly follow the live-production-sensitive safety rules (see §4).

### 3.3 Before Push
1.  **Review Differences:** Run `git diff` and examine all modified files.
2.  **Secrets Audit:** Confirm that no machine-local configurations, private keys, `.env` files, or secrets are staged.
3.  **Quality Gates:** Run required tests and build steps to ensure there are no compilation or runtime regressions.
4.  **Commit:** Commit your changes with a clear, descriptive commit message.
5.  **Push:** Push all committed work to remote `main`.

### 3.4 After Push
1.  **CI Validation:** Wait for the CI pipeline to run and verify that it passes. Do not treat a pushed commit as approved until required CI status is green.
2.  **Windows Sync:** Update the active Windows runtime/deployment only from the approved Git commit.

### 3.5 Mac Synchronization
1.  **Clean Tree Check:** Verify that the Mac working tree is clean.
2.  **Fetch Updates:** Run `git fetch origin`.
3.  **Fast-Forward:** Fast-forward the Mac checkout to the approved `origin/main`.
4.  **Conflict Resolution:** Do not overwrite independent Mac work. If drift or divergence exists, stop and reconcile deliberately.

### 3.6 Session Close
Before ending the session, verify and satisfy all of the following conditions:
*   The Windows tracked working tree is clean.
*   The Windows `HEAD` matches `origin/main`.
*   The Mac `HEAD` matches `origin/main`.
*   There are no unpushed tracked commits on either machine.
*   There are no unintended tracked modifications.
*   The CI status is green for the final commit.
*   Production health is verified (e.g., check `/api/health`) if production services were touched.
*   Any deferred work is recorded in the task tracker or decision log.

**Final Invariant Check:**
Ensure that:
$$\text{Windows HEAD} == \text{origin/main} == \text{Mac HEAD}$$

---

## 4. Production-Safety Standing Rules

All operations on production-facing environments must respect these safety boundaries to prevent data corruption or service disruption.

> [!WARNING]
> Do not weaken or bypass any of the following safety rules under any circumstances:
> 
> *   **Catalog Read-Only:** Live DUNEDIN IdealPOS catalog/menu data is read-only from automation.
> *   **Product Protection:** Do not modify `StockItems`, `PLUs`, tables, or existing products without explicit approved task scope.
> *   **No Harness Against Live:** Never run `VerduraIdealposHarness` against live DUNEDIN.
> *   **Order/KOT Authorizations:** No live order or Kitchen Order Ticket (KOT) generation is permitted without explicit immediate authorization and physical observation.
> *   **No Legacy POS Conflict:** Do not enable competing legacy POS dispatch paths.
> *   **Secret Exposure:** Do not expose secrets or check them into source control.
> *   **No Database Migrations:** Do not migrate PostgreSQL paths or schemas unless explicitly approved.

---

## 5. What Must Never Be Committed

The following files and states are machine-local and must never be checked into Git:
*   Production `.env` files (machine-local environment configuration)
*   Credentials, secrets, API keys, and enrollment tokens
*   SSH private keys and key files
*   Machine-local runtime state (such as temporary files, process IDs)
*   Generated production log files (`*.log`)
*   Local database data directories (e.g., native PostgreSQL or Docker volumes)
*   Docker volumes, states, or ephemeral database volumes
*   Other host-specific operational states

---

## 6. Checkout Ambiguity Prevention

To prevent confusion and ensure code consistency:
*   `C:\Users\Posmate\Documents\verdura_MVP` is the single, canonical Windows application checkout.
*   Retired or backup copies of the checkout must never be used as active development or production sources.
*   If another checkout is discovered on the Windows host, it must be classified, documented, and reconciled before use.

---

## 7. Claude Standing Instruction

Future implementation sessions should begin by reading and following this operating procedure. Do not rely on conversational memory when repository documentation provides the current operating policy.

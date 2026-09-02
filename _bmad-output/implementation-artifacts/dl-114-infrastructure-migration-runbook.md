# DL-114 — Verdura infrastructure migration runbook

**Status: S0 and S1 are COMPLETE and verified read-only on 2026-09-03.
S2 is APPROVED and 5 of its 6 services are migrated and verified; the
`VerduraAPI` step is blocked and S2 is NOT complete (§S2). Every other stage
is PLANNING ONLY and UNAPPROVED — none has been executed.**
No uncompleted production-affecting stage may run without separate, explicit,
per-stage approval and, where service lifecycle changes are involved, the
maintenance-window controls defined in this runbook.

**§0 rule 7 (`ProgramData` ACL pre-use gate) is SATISFIED for `releases`,
`state` and `logs` as of 2026-09-03.** That is a permission change and
nothing more: it **authorises no stage**. S2 was approved separately and
afterwards.

This is the **durable** migration artifact and the authoritative record of
stage identity, status and sequence. Where a stage identity is **not** firmly
established, this document marks it as such and uses a descriptive
provisional name rather than an invented number.

Scope: infrastructure relocation and `verduraBridge` retirement only. It does
**not** authorise the DUNEDIN live-order certification — that is governed by
`dl-107-dunedin-live-certification-runbook.md`, deliberately kept separate.

---

## 0. Evidence and operating standard (binding on every stage)

1. **Row counts are exact `COUNT(*)`.** `pg_stat_user_tables.n_live_tup` is
   inadmissible on this instance: 25 of 30 user tables have never been
   analyzed, so it reports 0 rows for `Organization`, `Venue` and `Table`,
   all of which hold rows, and 1 row for the 12-row `_prisma_migrations`.
2. **Timestamps compare on a common time base.** Application timestamp
   columns are `timestamp without time zone` holding **UTC**; `now()` is
   `timestamptz` in **Pacific/Auckland**. Compare against
   `now() AT TIME ZONE 'UTC'`, or a healthy system reads 12 h stale (13 h in
   NZDT).
3. **Service control.** Immediately before acting, derive the full
   **service → wrapper PID → child PID → listening port** mapping. Perform
   all normal stop/start/restart operations through **SCM/service controls**.
   **Direct PID termination is reserved for proven orphan recovery only.**
   **Broad process-name termination is prohibited** — NSSM services run *as*
   `nssm.exe`, so a name-pattern kill destroys service wrappers.
4. **Maintenance-window authorization.** No stop, start, restart or resume
   occurs without explicit user-approved maintenance-window authorization
   **in the session executing it**.
5. **Health probes use the correct scheme.** API health is `/api/health`
   (a global `api` prefix is set; bare `/health` returns 404). Bridge health
   requires `Authorization: Bearer <key>`; `X-Api-Key` returns 401.
6. **Undocumented recollection is never evidence.** A claim gates a stage
   only when it is supported by a recorded observation or an authoritative
   artifact. Anything else is re-verified against the machine first.
7. **`ProgramData` ACL pre-use gate — binding.**
   **Before any production stage begins using
   `C:\ProgramData\Verdura\releases`, `state`, or `logs`, the intended ACL
   model for those paths must be explicitly approved, applied, and verified.
   Production use does not proceed while inherited `BUILTIN\Users` write
   access remains unless that access is explicitly accepted as part of the
   approved security model.**

   This is a **hard pre-use gate, not a deferred observation.** Specifically:

   - It is a **prerequisite for S2**, which must be satisfied *before*
     production service logs are redirected to `logs\services`.
   - It applies **before release binaries or mutable state are redirected
     into `ProgramData`**, by any stage.
   - It **does not authorize an ACL change now.** Approval, application and
     verification are themselves gated work.
   - **This runbook does not specify the final ACL entries.** The intended
     model is defined by the approved security decision, not invented here.

   The observed current state that makes this gate necessary is recorded in
   §S1.

   **STATUS — SATISFIED for `releases`, `state` and `logs` on 2026-09-03.**
   The ACL model was explicitly approved by the user, applied, and verified.
   Evidence:
   `_bmad-output/implementation-artifacts/2026-09-03-dl-114-acl-hardening/`.

   The approved and applied model, recorded here because the gate is only
   discharged by a *specific* model — this is the record of the approved
   security decision, not an invention by this runbook:

   | Element | Applied as |
   | --- | --- |
   | Inheritance | disabled and **protected** (`SE_DACL_PROTECTED`) |
   | `NT AUTHORITY\SYSTEM` | FullControl, `(OI)(CI)`, explicit |
   | `BUILTIN\Administrators` | FullControl, `(OI)(CI)`, explicit |
   | `BUILTIN\Users` | **removed entirely** |
   | `CodexSandboxUsers` / `…Offline` / `…Online` | **no access of any kind** |
   | `CREATOR OWNER` | **removed** — not required once inheritance is protected |
   | Owner | **unchanged** (`BUILTIN\Administrators`); ownership was not touched |

   Resulting DACL, identical on all three roots —
   `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)` — and on all 7 descendants,
   inherited and unprotected: `D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)`.

   Verified: inheritance protected; SYSTEM and Administrators FullControl;
   `BUILTIN\Users` absent from roots **and** descendants; the three Codex
   identities absent by `icacls /findsid` across the whole
   `C:\ProgramData\Verdura` tree **and** unable to reach the Administrators
   ACE by group nesting (`Administrators` holds only two local users, neither
   of them a Codex identity); and `C:\ProgramData`, the Verdura runtime root,
   `config`, `config\secrets`, `backups`, `rollback`, the **S0 baseline
   (all 38 entries)** and `README.md` unchanged pre → post.

   **The scope was exactly this ACL change.** No service was stopped,
   started, restarted or reconfigured; no file was created, moved or deleted
   in the three trees. Non-invasive health verification before and after was
   identical, **including every `Verdura*` service PID** — direct evidence
   that nothing restarted — with `/api/health` returning
   `{"status":"ok","db":"ok","redis":"ok"}` and all five frontend listeners
   answering `200`.

   **Two consequences carry into later stages.** First, `Posmate` reached
   these trees through `BUILTIN\Users`, so **non-elevated** tooling can no
   longer read or write `releases`, `state` or `logs`; anything touching them
   must run elevated. This is the intended effect of the model. Second, the
   runtime root, `backups` and `rollback` were **not** in scope and still
   grant `BUILTIN\Users` write by inheritance — extending production use to
   `backups` would need its own rule 7 decision.

---

## 1. Stage and authorization status

| Stage | Identity | Status |
| --- | --- | --- |
| **S0** | Immutable pre-migration baseline | **COMPLETE** — captured 2026-09-02 14:10:04–14:11:33; verified 2026-09-03 |
| **S1** | `C:\ProgramData\Verdura\` runtime skeleton creation + permission validation | **COMPLETE** — created 2026-09-02 14:08:11; verified 2026-09-03 |
| **S2** | Service stdout/stderr logging relocation to `C:\ProgramData\Verdura\logs\services\` | **APPROVED and PARTLY EXECUTED 2026-09-03 — 5 of 6 services complete and verified; `VerduraAPI` NOT migrated, blocked by a scope conflict (see §S2)** |
| **S3** | *Identity not established* | **UNAPPROVED** |
| **S4** | Includes migration of the 8 live-critical ops scripts into `verdura_MVP\windows-deploy\ops\` | **UNAPPROVED** |
| **S5** | *Identity not established* | **UNAPPROVED** |
| **S6** | **Connector cutover** (targets `IPS.exe`) | **UNAPPROVED** |
| **S7 – S9** | *Identities not established* | **UNAPPROVED** |
| *(provisional)* | **Bridge cutover stage** — number not established; must precede S6 | **UNAPPROVED** |
| *(provisional)* | **S-PG** — PostgreSQL data directory relocation to `ProgramData` | **UNAPPROVED** (newly planned) |
| *(provisional)* | **`verduraBridge` retirement** — rename + soak; number not established | **UNAPPROVED** |
| *(provisional)* | **`verduraBridge` deletion** — separate later approval | **UNAPPROVED** |

**Authorization state: S0 complete, S1 complete, S2–S9 unapproved,
PostgreSQL relocation newly planned and unapproved.**

**The `ProgramData` ACL hardening of 2026-09-03 is not a stage and is given
no stage number.** It is a discrete, separately approved permission change
that discharges the §0 rule 7 pre-use gate for `releases`, `state` and
`logs`. It changes no stage's status, and it must not be cited as authority
for beginning any stage.

**Chronology note (filesystem observation, 2026-09-03).** The S1 runtime
skeleton was created at **14:08:11**, and the S0 baseline was captured into
it at **14:10:04–14:11:33** — so `rollback\pre-migration-20260902` is a
subtree of the S1 skeleton, and the S1 directory structure necessarily
predates the S0 capture on disk. Stage *numbering* is authoritative as
recorded above and is not altered by this; the note exists so the
filesystem timestamps are not later mistaken for evidence that the recorded
stage order is wrong. Both events precede INC-001.

**No stage is "next".** Execution order is not reordered on grounds of
convenience, size, or reversibility. S-PG in particular is *not* promoted
ahead of the established sequence because the PostgreSQL audit happened to
complete first.

### 1.1 Established ordering constraints

- **Bridge is cut over before the Connector**, because the Connector
  communicates with the Bridge.
- **At each component cutover, any mutable production state used by that
  component must already reside outside the immutable release directory.**
- **Final `verduraBridge` retirement happens only after all dependencies on
  it are removed** — see §6.

---

## 2. Stage text

### S0 — Immutable pre-migration baseline — COMPLETE

Created on **2026-09-02** — recorded as approximately 14:15; filesystem
timestamps verified 2026-09-03 place the capture at **14:10:04–14:11:33** —
at:

```
C:\ProgramData\Verdura\rollback\pre-migration-20260902
```

Contents include, among other evidence:

- HEAD / origin verification
- 8 NSSM `.reg` exports plus parameters
- 3 Scheduled Task XML exports
- Bridge and Connector production configs and credential files
- `bridge-state.sqlite`
- `tracer-store.jsonl`
- Bridge logs
- binary hashes
- manual `verdura_production_pre-migration_20260902.dump`

**S0 predates INC-001 and is immutable.** It must not be modified, appended
to, regenerated, or relocated by any later stage.

**Read-only verification, 2026-09-03.** The baseline exists at the recorded
path: 32 files, 0.33 MB, directory created 14:10:04. All recorded artifact
categories are present — `hashes\repo-HEAD.txt` and `hashes\git-status.txt`;
8 NSSM `.reg` exports plus `registry\nssm-parameters.txt`; 3 Scheduled Task
XML exports; 6 Bridge/Connector config and credential files (**names only —
contents were not read**); `state\bridge-state.sqlite`;
`state\tracer-store.jsonl`; 7 Bridge log files spanning 2026-08-25 to
2026-09-01; `hashes\binaries.txt`; and the manual dump (205,125 B).

*Immutability — corroborating evidence, not proof:* the newest observed write
anywhere in the tree is **14:11:33**, before INC-001. No filesystem writes
later than the baseline capture were observed in the S0 tree; this is
consistent with the requirement that S0 remain immutable.

*HEAD corroborated:* the recorded `repo-HEAD.txt` value matches the
repository's current HEAD exactly, and `git-status.txt` is zero bytes,
indicating a clean working tree when the baseline was taken.

*ACL, as observed and not generalised:* the baseline directory has
**inheritance disabled**, owner `DESKTOP-SOKKOQ7\Posmate`, and three explicit
entries — `SYSTEM`, `Administrators` and `Posmate`, each FullControl. This
posture is specific to this directory and is not shared by the wider runtime
root (see S1).

The PostgreSQL dump in this baseline has since been **structurally validated
with `pg_restore --list`**. A structural listing confirms the archive is
readable and complete in form; it is not equivalent to a restore-and-compare
test.

### S1 — `ProgramData` runtime skeleton — COMPLETE

Creation and permission validation of the new runtime skeleton under:

```
C:\ProgramData\Verdura\
```

including the role-specific `releases` / `config` / `state` / `logs` / `etc`
directories, and a **genuine LocalSystem write test** proving the service
account can write where it will need to.

**No production service was redirected during S1.** S1 built and proved the
destination; it moved nothing.

**Read-only verification, 2026-09-03.** The skeleton exists, created
14:08:11, with the role-specific tree present and empty:
`backups`, `config\{bridge,connector,secrets}`,
`logs\{archive,bridge,services}`, `releases\{bridge,connector}`, `rollback`,
`state\{bridge,connector}`.

*No probe artifacts remain.* Every skeleton directory outside `rollback\`
contains **zero files**. The only file elsewhere in the tree is a `README.md`
at the root, which is documentation rather than residue. Nothing left behind
by the LocalSystem write test was found.

*S-PG target absent, as expected:* neither `C:\ProgramData\Verdura\postgres`
nor `…\postgres\data` exists — consistent with S-PG being unexecuted.

**ACL observations — recorded per-path, deliberately NOT generalised.** The
posture differs between paths and must not be treated as uniform:

| Path | Inheritance | Observed access |
| --- | --- | --- |
| `C:\ProgramData\Verdura` (runtime root) | **enabled** (not protected) | `SYSTEM` FullControl — including one **explicit, non-inherited** entry, consistent with a deliberate LocalSystem grant; `Administrators` FullControl; `CREATOR OWNER`; and **`BUILTIN\Users` with Read/Execute *and* Write**, inherited from the `ProgramData` default model |
| `config\secrets` | enabled (not protected) | `SYSTEM`, `Administrators`, `Posmate` — all FullControl. **`BUILTIN\Users` is absent here** |
| `rollback\pre-migration-20260902` | **disabled** (protected) | `SYSTEM`, `Administrators`, `Posmate` — explicit entries only |

**The hardened posture at `config\secrets` does not extend to the runtime
root.** The root granted — and still grants — `BUILTIN\Users` write access by
inheritance, as did the `releases`, `state` and `logs` subtrees beneath it at
the time of this observation.

**This finding was a binding pre-use gate, not a deferred observation —
see §0 rule 7.** No production stage could begin using `releases`, `state` or
`logs` until the intended ACL model for those paths was explicitly approved,
applied and verified.

> **SUPERSEDED for `releases`, `state` and `logs` on 2026-09-03.** The table
> above is the **pre-hardening** observation and must not be read as current
> state for those three paths. The approved model has since been applied and
> verified: all three are now **protected**, with `SYSTEM` and
> `Administrators` FullControl only — `BUILTIN\Users` and `CREATOR OWNER` are
> gone. See §0 rule 7 STATUS. The rows for the runtime root and
> `rollback\pre-migration-20260902` remain **current and unchanged**, and were
> re-verified byte-for-byte as part of that work.

*Corroborating the S1 permission-validation result:* the explicit
non-inherited `SYSTEM` FullControl entry at the runtime root is consistent
with the recorded LocalSystem write test having been performed and having
succeeded. `DESKTOP-SOKKOQ7\CodexSandboxUsers` — the identity holding read
access over the current PostgreSQL data directory (§4.5) — is **absent from
every directory** under `C:\ProgramData\Verdura`.

### S2 — Service logging relocation — APPROVED; 5 of 6 EXECUTED 2026-09-03

> **STATUS 2026-09-03.** Approved with maintenance-window authorization and
> executed for the **five frontends only**: `VerduraCustomerWebsite`,
> `VerduraWindowDisplay`, `VerduraKitchenDisplay`, `VerduraOrderTablet`,
> `VerduraAdminConsole`. Each passed full verification — wrapper/child/port,
> child PID changed, no orphans, HTTP 200, new log path receiving output, old
> log path static across two samples. No rollback was needed. Evidence:
> `_bmad-output/implementation-artifacts/2026-09-03-dl-114-s2-logging-relocation/`.
>
> **`VerduraAPI` was NOT migrated, and S2 is therefore NOT complete.**
> `VerduraAPI` has six dependent services — the five frontends **and
> `VerduraConnector`** — so SCM cannot stop it without stopping them. That
> makes "restart only that service" and "do not touch the Connector"
> mutually unsatisfiable for the API step. The approved scope disclosed the
> frontend dependency but **not** the Connector dependency, so this
> consequence was never put to the approver. Execution stopped cleanly rather
> than stacking an unapproved change. **Completing S2 requires a fresh
> decision that explicitly accepts a `VerduraConnector` stop/start.**
>
> The resulting half-migrated state is stable: the API keeps logging to its
> original `VerduraServerOps\api-*.log`, untouched and writable. Rollback of
> any migrated frontend remains per-service and isolated, since none has
> dependents.
>
> **NSSM log rotation was not enabled** — `AppRotateFiles` remains unset on
> all six services, as required.
>
> **Closed out and verified at 5 of 6 on 2026-09-03 02:43.** All 9 services
> `Running`; `/api/health` ok; five frontends `200`; Bridge `200` with
> `bridgeRunning`/`sqlConnected`/`assembliesLoaded` true; Connector heartbeat
> advancing across two samples; all five migrated sinks held open by NSSM
> (live handles); the API's original sink unchanged, present and held open;
> zero orphaned wrappers. Evidence: `S2-CLOSEOUT-VERIFICATION.txt`.

#### S2 DEFERRED FINDING — `VerduraAPI` cannot be restarted in isolation

**This is the precise, self-contained record of why S2 stopped at 5 of 6.**

Verified from SCM on 2026-09-03:

```
VerduraAPI  DependentServices:
  VerduraKitchenDisplay, VerduraWindowDisplay, VerduraCustomerWebsite,
  VerduraOrderTablet, VerduraConnector, VerduraAdminConsole      (six)

VerduraAPI  DependOnService: VerduraPostgreSQL
```

Windows SCM refuses to stop a service while any dependent is running
(`ERROR_DEPENDENT_SERVICES_RUNNING`). Therefore **any** SCM restart of
`VerduraAPI` also stops `VerduraConnector` and all five frontends, and each
must then be restarted and re-verified.

Consequences, stated exactly:

- Relocating the **API** log is *not* a single-service operation, unlike the
  five frontends, each of which has **zero** dependents and was migrated in
  isolation.
- It conflicts with the S2 scope constraint "do not touch … Connector", so it
  cannot be completed under the 2026-09-03 approval.
- The alternatives are barred: **direct termination of the API's child
  process violates §0 rule 3**, and `nssm restart` routes through the same
  SCM stop, so it is not a workaround.

**What completing it would require:** an approval that *explicitly* accepts a
`VerduraConnector` stop/start, plus a maintenance window sized for six
dependent restarts rather than one — with post-restart verification of the
Connector heartbeat advancing, not merely `Running`.

**Current state is stable and is not a defect.** `VerduraAPI` continues to
log to
`C:\Users\Posmate\Documents\verduraBridge\VerduraServerOps\api-{stdout,stderr}.log`
(`REG_EXPAND_SZ`, unchanged, sink held open by NSSM). Nothing is inconsistent
and nothing is at risk. Each migrated frontend remains independently
reversible.

**Standing direction recorded 2026-09-03:** this deferred API log relocation
is **not** to be prioritised on its own. It carries six-service restart risk
to move one log file. Work that actually removes the `verduraBridge`,
PostgreSQL and other `Documents`-root dependencies takes precedence; the API
log should be folded into whichever stage already has to restart the API for
a substantive reason, rather than being scheduled as its own production
change.

Planned migration of **stdout/stderr logging for the six NSSM application
services** away from `verduraBridge\VerduraServerOps` to:

```
C:\ProgramData\Verdura\logs\services\
```

**Prerequisite — §0 rule 7 (`ProgramData` ACL pre-use gate).** S2 redirects
production service logs into `logs\services`, which is production use of a
`ProgramData` path. The intended ACL model for `logs` must be explicitly
approved, applied and verified **before** that redirection occurs. S2 does
not proceed while inherited `BUILTIN\Users` write access remains, unless that
access has been explicitly accepted as part of the approved security model.

**This prerequisite is SATISFIED as of 2026-09-03** — see §0 rule 7 STATUS.
`logs` is protected, `BUILTIN\Users` is removed, and `SYSTEM` holds an
explicit FullControl `(OI)(CI)` grant, which is what the NSSM services need
in order to write into `logs\services` as LocalSystem.

**Satisfying this prerequisite does not approve S2.** It discharges one of
several conditions. **S2 remains UNAPPROVED**, and every requirement below
still stands in full — in particular the maintenance-window authorization of
§0 rule 4, which no ACL approval substitutes for.

Because this changes NSSM service parameters, it **requires service
restarts**, and therefore requires all of:

- **§0 rule 7 satisfied** for `logs` — **met 2026-09-03**;
- explicit maintenance-window approval (§0 rule 4);
- per-service preflight;
- **one service at a time**;
- **the five frontends first, the API last**;
- post-restart verification of health, listener, PID and orphan state for
  each service before moving to the next;
- **immediate abort and rollback on any failure**, not live debugging.

**NSSM log rotation is explicitly NOT part of S2.** Do not add it.

**S2 is not replaced by the PostgreSQL relocation.** They are different
stages with different objectives.

### S3 — identity not established

Not reconstructed. Do not infer its content from adjacent stage numbers.

### S4 — ops-script migration — UNAPPROVED

S4 **includes** migration of the **8 live-critical ops scripts** into:

```
verdura_MVP\windows-deploy\ops\
```

**path-parameterized** (no hardcoded absolute paths) and **secret-scanned**
(no credentials in tracked files).

*Input toward identifying those 8 (identification to be confirmed at stage
planning, not assumed here):* `VerduraServerOps\pg-backup.ps1` is
live-critical — the `VerduraPostgresBackup` scheduled task invokes it
directly. By contrast `test-restore.ps1`, `test-restore3.ps1` and
`test-restore4.ps1` all reference `Documents\verduradb-backups`, **a path
that does not exist**, and are therefore already broken; they encode a
useful restore-and-compare pattern but must be corrected before being
relied upon.

S4 may include work beyond the ops scripts; only the ops-script element is
firmly established.

### S5 — identity not established

Not reconstructed.

### S6 — Connector cutover — UNAPPROVED

**S6 is the Connector cutover. It is NOT `verduraBridge` decommission.**

Binding constraints:

- **S6 must target `IPS.exe`.**
- **`IPS.exe` runtime state must be revalidated immediately before S6** — it
  is a runtime condition, not a one-time finding.
- **Never revert the target to `IPSClient.exe`.**
- S6 runs **after** the Bridge cutover stage, because the Connector
  communicates with the Bridge.

**Both `IPS.exe` and `IPSClient.exe` may be running concurrently. S6 must
verify that the Connector/discovery implementation selects the intended exact
`IPS.exe` target and must record the attached PID and full image path.**

*Current observed state, for revalidation at stage time — not a substitute
for it:* `IPS.exe` (pid 1564, started 2026-09-02 21:03:45) and
`IPSClient.exe` (pid 12800, started 2026-08-27 16:14:30) were both running
from `C:\Program Files (x86)\Idealpos Solutions\Idealpos\`. The deployed
`discovery-profile.local.json` still reads
`"ExpectedProcessName": "IPSClient"` with
`"ProfileVersion": "DUNEDIN-CLOUD-MODE-UNUSED"`, while the repo profile
targets `"IPS"`. S6 must overwrite the deployed profile and assert the
resulting `ProfileVersion` string, not merely that the file exists.

### S7 – S9 — identities not established

Not reconstructed.

### Provisional — Bridge cutover stage

Stage number **not established**. Ordering is established: it precedes S6.

Redeploy the Bridge from a tagged commit with a `DEPLOYED-COMMIT.txt` in the
release directory, with production state externalized from the release
binaries (§1.1).

`Idealpos:ExpectedIpsExePath` correction belongs to this stage — see §5.

### Provisional — S-PG, PostgreSQL data directory relocation

See §3. Newly planned, unapproved, and **not** promoted ahead of the
established sequence.

---

## 3. S-PG — PostgreSQL relocation (planning only)

**Objective.** Move the PostgreSQL 18.6 cluster from
`C:\Users\Posmate\Documents\verduradb` to
`C:\ProgramData\Verdura\postgres\data` by **controlled physical move of the
existing cluster**, not fresh `initdb` + restore.

**Why physical move on this host.** The recommendation rests on:

- **Same host, same version, same platform** — 18.6 → 18.6 with the same
  binaries, so the copied cluster is binary-compatible.
- **Self-contained cluster** — `config_file`, `hba_file` and `ident_file` all
  resolve relative to `-D`, and `external_pid_file` is empty, so the
  configuration travels with the directory.
- **No external tablespaces** — `pg_default` and `pg_global` only, and
  `pg_tblspc/` is empty, so no data lives outside the directory being copied.
- **Small data size** — ≈67 MB, keeping the transfer and its verification
  short.
- **Retained old cluster for rollback** — the source directory is copied,
  never moved, and is kept intact as the rollback target (§S-PG.9).
- **Validated logical backups** — the §S-PG.1 dump, validated by
  restore-and-compare, plus `pg_dumpall --globals-only`, as the second line
  of defence.

Data checksums are enabled, providing page-level corruption detection when
pages are read. This is useful verification protection but does not prove the
entire cluster is corruption-free, and it is not a basis for the
recommendation.

A fresh-cluster restore offers a clean rebuild and may provide other
operational benefits, but on this installation it introduces additional
reconstruction and verification work, including explicit restoration of
roles/globals. For the currently verified same-host PostgreSQL 18.6
relocation, the physical-copy approach is preferred.

Supporting verified fact: the nightly artifact is a **per-database
`pg_dump`, which does not contain cluster roles or globals**. A
restore-based recovery path therefore requires
`pg_dumpall --globals-only` in addition, or the `verdura_admin` role is not
reconstructed.

**Explicitly out of scope — do not bundle:** PITR/WAL archiving and
persistent server logging (§7).

### S-PG.1 Prerequisites

1. Fresh `pg_dump` taken **after** the last change it must be able to undo.
   The nightly 03:00 job is not sufficient cover on its own. (S0's baseline
   dump is immutable evidence of the pre-migration state; it is not the
   rollback artifact for this stage.)
2. That dump validated two ways: `pg_restore --list` (structural), **and** a
   scratch-database restore with an exact `COUNT(*)` diff against production
   across all core tables.
3. `pg_dumpall --globals-only` captured alongside it — the artifact that
   makes a dump/restore fallback viable if the physical move is abandoned.
4. Baseline captured for comparison at S-PG.6: exact `COUNT(*)` for all core
   tables, `ConnectorInstallation.lastSeenAt`, and the full service → wrapper
   PID → child PID → port map.
5. Free space verified on the target volume (≈67 MB needed; 52.1 GB free at
   audit time).
6. The conflicting prior plan recorded at
   `docs/windows-production-deployment.md:236-237` — an earlier intent to
   move `verduradb` into `verduraBridge\verduradb` — explicitly retired.
7. Explicit maintenance-window authorization in the executing session
   (§0 rule 4).

### S-PG.2 Quiesce

Venue not trading, no orders in flight. Confirm no `Order` sits in a
non-terminal state a staff member is actively working, and no
`ConnectorCommand` is `claimed`/`accepted` awaiting a terminal report.

### S-PG.3 Stop dependent services

**Shutdown scope and order are NOT established. No service list or ordering
is provided here, and none may be inferred from this document.** They are
outputs of the pre-cutover dependency analysis below, not inputs to it.

**Pre-cutover dependency analysis — required before the maintenance window:**

1. **Identify the exact set of services that maintain direct PostgreSQL
   connections.**
2. **Identify services that can issue database-affecting work transitively
   during the outage** — work reaching the database through another
   component rather than through their own connection.
3. **Determine what must be quiesced for order and command consistency** —
   what must not be mid-flight when the cluster stops.
4. **Produce an evidence-backed dependency map and, from it, an approved
   shutdown and startup order.** The map is the evidence; the order is
   derived from it and approved before the window opens.
5. **Treat the API as a known database dependent.**
6. **Do not stop static frontend services merely because PostgreSQL is
   unavailable.** Serving static assets is not a database dependency;
   inclusion must be justified by the analysis, not assumed.

**Execution.** Derive the full service → wrapper PID → child PID → port
mapping immediately before acting. Stop **only the approved set**, **through
SCM/service controls**, in the approved order.

After each stop, confirm the wrapper and its child are both gone. If a child
survives as a proven orphan holding its port, **that** is the one case where
direct PID termination is permitted (§0 rule 3) — identified by PID, never
by name.

### S-PG.4 Controlled PostgreSQL shutdown

**Stop the cluster by stopping the registered Windows service
`VerduraPostgreSQL` through SCM/service controls**, and let its `pg_ctl
runservice` wrapper perform the shutdown. This follows the SCM-first rule in
§0 rule 3; a direct `pg_ctl stop` is **not** an equal alternative for normal
lifecycle control.

`pg_ctl` and other PostgreSQL tooling may be used freely for **read-only
status and verification**, which is how the confirmations below are gathered.

Before touching any file, confirm:

- `postmaster.pid` is **gone** from the old data directory;
- **zero** `postgres.exe` processes remain on the host;
- the shutdown was clean.

A file-level copy taken while the postmaster is running is not a consistent
cluster copy. Do not proceed on a partial shutdown.

### S-PG.5 Transfer and destination ACL establishment

**Copy data and timestamps only. Do not propagate source ACLs.** The source
tree carries an inherited-permission defect (§4) that must not be reproduced
at the destination.

1. **Copy contents safely, without security descriptors:**

   ```
   robocopy "C:\Users\Posmate\Documents\verduradb" ^
            "C:\ProgramData\Verdura\postgres\data" ^
            /E /COPY:DAT /DCOPY:DAT /R:1 /W:1
   ```

   `/COPY:DAT` carries **D**ata, **A**ttributes and **T**imestamps and
   deliberately **omits S (security), O (owner) and U (auditing)**.
   `/COPYALL` must **not** be used — it would copy the source ACLs, which is
   precisely the defect being corrected.

2. **Verify the copy by cryptographic hash manifest — hard gate.**

   Taken **after** PostgreSQL is confirmed cleanly stopped (§S-PG.4) and
   **before** any service reconfiguration, build a **deterministic recursive
   hash manifest of regular files** for both the source and the destination
   tree, and compare them on all three of:

   - **relative path** (normalised identically on both sides);
   - **file size in bytes**;
   - **cryptographic hash** of file contents.

   Requirements:

   - The manifest is **deterministic** — the same tree produces the same
     manifest — so ordering must be normalised, not left to directory
     enumeration order.
   - **Regular files only.** Any exclusion (directories, reparse points,
     anything skipped) must be **explicitly justified and recorded** in the
     stage evidence. Unjustified exclusions invalidate the comparison.
   - **Zero unexpected differences are allowed.** Any difference in path,
     size or hash fails the stage — there is no acceptable-variance
     threshold, and no difference may be waived at execution time.
   - **Retain the comparison result as stage evidence**, alongside both
     manifests.

   **File count, aggregate byte total and `PG_VERSION` are insufficient on
   their own** and must not be used as the copy-verification gate. They may
   be recorded as supplementary context only. For reference, the audit-time
   figures were 1,454 files and ≈66.92 MB, with `PG_VERSION` reading `18` and
   `pg_tblspc/` empty; those numbers are context, not the gate.

3. **Establish destination ACLs deliberately**, from scratch:
   - **Disable inheritance** on `C:\ProgramData\Verdura\postgres\data` and
     remove inherited entries rather than converting them.
   - `NT AUTHORITY\SYSTEM` — FullControl (the service runs as `LocalSystem`;
     this is the operative grant).
   - `BUILTIN\Administrators` — FullControl.
   - **Only explicitly required operator access** beyond those two. Any
     interactive-user grant must be justified and recorded, not inherited by
     default.
   - **`CodexSandboxUsers` receives no access of any kind** to the raw
     database files.

4. **Hard gate — destination ACL verification.** Enumerate the effective ACL
   on the destination root and on a representative child file, and record
   both in the stage evidence. The stage **fails** unless:
   - inheritance is disabled and no inherited entries remain;
   - `CodexSandboxUsers` is absent;
   - `SYSTEM` and `Administrators` hold the required control;
   - no unintended identity appears.

   A failed ACL gate is a stage failure → §S-PG.8 rollback. It is not a
   post-cutover cleanup item.

### S-PG.6 Service reconfiguration and first-start gates

Update the `VerduraPostgreSQL` service `-D` to the new path. **No other path
changes are required** — `config_file`, `hba_file` and `ident_file` all
resolve relative to `-D`, so they travel with the directory. Record the exact
before and after ImagePath strings.

All gates must pass; any failure is a stage failure → rollback, not live
debugging:

1. Service reaches `Running` via SCM; the `pg_ctl` wrapper spawns a
   postmaster whose PID matches the new `postmaster.pid`.
2. `SHOW data_directory` returns `C:/ProgramData/Verdura/postgres/data`;
   `config_file`, `hba_file` and `ident_file` all resolve beneath it.
3. `SHOW server_version` = `18.6`; `data_checksums` still `on`.
4. Exact `COUNT(*)` on all core tables **matches the S-PG.1 baseline
   exactly**.
5. All Prisma migrations still `finished`, none `rolled_back`.
6. 0 invalid indexes, 0 prepared transactions, 0 replication slots.
7. The §S-PG.5 ACL gate is re-confirmed after first start.

### S-PG.7 Dependent-service health verification

Restart the approved dependent-service set through SCM/service controls in
the reverse of the dependency order established and approved during the S-PG
pre-cutover dependency analysis. Then verify they are **functioning**, not
merely `Running`:

1. `GET /api/health` → `{"status":"ok","db":"ok","redis":"ok"}`.
2. Bridge `GET /api/health` with `Authorization: Bearer <key>` → 200, with
   `sqlConnected:true`, `bridgeRunning:true`.
3. Connector heartbeat advancing: `ConnectorInstallation.lastSeenAt` compared
   against `now() AT TIME ZONE 'UTC'`, within one poll interval, and observed
   to **advance across two samples**.
4. All six frontend/API listeners answering, each mapped to the expected
   service → wrapper PID → child PID.
5. No orphaned processes; each wrapper holds exactly one correct child.

**Pre-existing conditions that must NOT be misread as migration damage** —
capture each in the S-PG.1 baseline so attribution is unambiguous:
`ipsExePathExists:false` (§5), `tableAssignmentConfirmed:false`, and the
three orders parked at `submitted_awaiting_confirmation`. All predate S-PG
and are governed by DL-107.

> **Correction, machine-verified 2026-09-03 (§0 rule 6).** The order-status
> claim above is wrong as written. The database holds exactly **three orders
> in total**, and their statuses are **2 × `preparing`** (`ORD-600003`,
> `ORD-600002`) and **1 × `cancelled`** (`ORD-600001`) — not
> `submitted_awaiting_confirmation`. The count of three is right; the status
> is not. Do not cite the status claim as-is; re-verify at stage time.

### S-PG.8 Rollback

**Fast path — pointer reversal.** The rollback is reversal of the service
`-D` pointer back to `C:\Users\Posmate\Documents\verduradb`:

1. Stop the `VerduraPostgreSQL` service **through SCM/service controls**;
   confirm by read-only inspection that no `postgres.exe` remains.
2. Restore the service `-D` to the old data directory.
3. Start the `VerduraPostgreSQL` service **through SCM/service controls**;
   re-run the §S-PG.6 gates against the old directory.
4. Restart dependent services **through SCM/service controls**; re-run
   §S-PG.7.

Lifecycle control in rollback follows the same SCM-first rule as the forward
path: `pg_ctl` is used for read-only status and verification only.

This is available because S-PG.5 **copies and never moves**, and nothing
writes to the old directory once the postmaster is stopped. No completion-time
guarantee is asserted for this procedure.

**Second line of defence:** the validated dump from S-PG.1, plus
`pg_dumpall --globals-only` for role reconstruction.

### S-PG.9 PostgreSQL rollback-retention requirement

**This is a PostgreSQL-specific retention requirement with its own
justification. It is not the `verduraBridge` retirement soak (§6) and does
not automatically inherit that policy.**

The old data directory at `C:\Users\Posmate\Documents\verduradb` is retained
**untouched** — not renamed, not deleted, not archived — because it *is* the
fast-path rollback target in §S-PG.8. Renaming it breaks the pointer
reversal; deleting it reduces rollback to a logical-backup restore, bounded
by the age of the most recent successfully validated backup
(`archive_mode=off`, so PITR is not available — §7).

Retention must therefore continue until **all** of the following hold, at
which point removal requires **separate explicit approval**:

- the cluster has run from the new location across normal operation long
  enough for a data-affecting fault to have surfaced;
- at least two successful **validated** backup cycles have completed from the
  new location — validated meaning restore-and-compare, not merely a dump
  file appearing;
- the operator explicitly accepts that fast-path rollback is being given up.

*Recommended retention period: 7 days.* Recorded as a recommendation for
deliberate adoption, **not** as an automatic application of §6's rule.

---

## 4. Verified current topology (2026-09-03, read-only)

**This is a current-state observation, not a stage record.** In particular,
the fact that six application services execute from `verdura_MVP` is a
verified current-topology fact and is **not** S1.

| Service | Runtime root | Evidence |
| --- | --- | --- |
| VerduraAPI | `verdura_MVP` | cmdline is relative (`node dist\src\main.js`) and proves nothing alone; root established from loaded native modules under `verdura_MVP\node_modules` |
| VerduraCustomerWebsite | `verdura_MVP` | cmdline, `:5173` |
| VerduraWindowDisplay | `verdura_MVP` | cmdline, `:5174` |
| VerduraKitchenDisplay | `verdura_MVP` | cmdline, `:5175` |
| VerduraOrderTablet | `verdura_MVP` | cmdline, `:5176` |
| VerduraAdminConsole | `verdura_MVP` | cmdline, `:5177` |
| **VerduraIdealposBridgeSvc** | **`verduraBridge`** | image under `…\verduraBridge\verduraIdealposBridge\bin\Release\net48\` |
| **VerduraConnector** | **`verduraBridge`** | image under `…\verduraBridge\VerduraOrderTabletConnector\…\publish\` |
| VerduraPostgreSQL | `VerduraPostgresBin` (binaries), `verduradb` (data) | §4.2 |

**`verduraBridge` is not retired.** The Bridge, the Connector, the backup
output directory and the operational scripts all still live there.

### 4.1 PostgreSQL process tree

```
VerduraPostgreSQL  (SCM service, LocalSystem, Auto)
└── PID 4156  pg_ctl.exe runservice -N "VerduraPostgreSQL"
              -D "C:\Users\Posmate\Documents\verduradb" -w   (started 2026-08-27 16:13:31)
    └── PID 5524  postgres.exe -D "…\verduradb"              (postmaster; matches postmaster.pid)
        ├── 8 auxiliary processes                             (started with the postmaster)
        └── N client backends                                 (transient)
```

The service PID and the postmaster PID are different processes and both
legitimately date from 2026-08-27. PostgreSQL was not restarted during
INC-001, which touched only NSSM-wrapped services.

### 4.2 Cluster facts

| Fact | Value |
| --- | --- |
| `server_version` | 18.6 |
| `data_directory` | `C:/Users/Posmate/Documents/verduradb` |
| `config_file` / `hba_file` / `ident_file` | all inside the data directory |
| `external_pid_file` | empty |
| Tablespaces | `pg_default`, `pg_global` only; `pg_tblspc/` empty; 0 external |
| Size | 66.92 MB across 1,454 files |
| `data_checksums` | on |
| `fsync` / `synchronous_commit` / `full_page_writes` | on / on / on |
| `archive_mode` | **off** — no PITR; rollback is dump-based |
| `logging_collector` | **off** — no persistent server log exists |
| `postgresql.auto.conf` | header only; no `ALTER SYSTEM` overrides |
| Slots / prepared xacts / invalid indexes | 0 / 0 / 0 |
| XID age | 139,000 (≈1.9999 B headroom) |

### 4.3 Only one live binding to the data directory

The `VerduraPostgreSQL` service ImagePath is the sole live reference. No
scheduled task and no other service references the data directory.

Everything else is stale or documentation: `verduraBridge\installers\`
scripts (hardcoded datadir — see §8), `VerduraServerOps\test-restore*.ps1`
(×3, pointing at a non-existent path), and documentation in
`deferred-work.md`, `dl-106`, `dl-107` and
`docs/windows-production-deployment.md`.

### 4.4 Direct writers to the data directory

The PostgreSQL server process tree is the only writer. Evidence: no
non-postgres process has an image path inside the directory; no external
tablespaces or symlinks; `archive_mode=off`; `logging_collector=off`; no
`ALTER SYSTEM` settings; no non-standard files present; the backup task uses
`pg_dump` over the client protocol, writing outside the data directory; no
AV, sync or third-party backup agents running; `Documents` is not
OneDrive-redirected.

**Evidence limit:** this finding rests on convergent inference. Live
file-handle enumeration was not performed, so it is not direct proof.

### 4.5 Source-tree permission defect (the reason §S-PG.5 rejects `/COPYALL`)

The existing data directory grants `DESKTOP-SOKKOQ7\CodexSandboxUsers`
**ReadAndExecute**, inherited across the whole tree, permitting raw database
files to be read independently of SQL-level authentication. It also sits
inside a user profile while the service runs as `LocalSystem`; `Documents` is
not currently OneDrive-redirected, but the OneDrive profile exists, so a
future Known Folder Move would begin syncing a live database.

---

## 5. `Idealpos:ExpectedIpsExePath`

`Idealpos:ExpectedIpsExePath` currently points to a nonexistent path
(`C:\Idealpos\IPS.exe`; `C:\Idealpos` does not exist) and **explains the
Bridge health field `ipsExePathExists:false`** while `ipsExeRunning` reports
`true`. The real binary is at
`C:\Program Files (x86)\Idealpos Solutions\Idealpos\IPS.exe`.

This is a configuration defect, not an IdealPOS fault, and must not be
debugged as one.

**Its correction belongs to the eventual Bridge deployment/configuration
stage and requires separate review and approval.** No production change now.

---

## 6. `verduraBridge` retirement, soak and deletion

Established policy:

1. **`verduraBridge` may be retired only after a fresh dependency audit
   proves that no production service, scheduled task, operational script,
   backup path, config path, state path, log path, or other live runtime
   dependency still resolves into `verduraBridge`.**

   **The fresh audit is the checklist.** No pre-enumerated list substitutes
   for it, and none is provided here — an inherited list would anchor
   execution to whatever was known when it was written.

   For context only, and explicitly **not** a retirement checklist: as of the
   verified topology in §4, the Bridge, the Connector, the backup output
   directory and the operational scripts are known current dependencies on
   `verduraBridge`. Their removal is necessary but not demonstrated to be
   sufficient; only the fresh audit establishes sufficiency.
2. **Retirement is performed by rename** to:

   ```
   verduraBridge.RETIRED-<date>
   ```

3. **A soak of at least 7 full days follows the rename.** During the soak the
   renamed directory is retained intact.
4. **Deletion is a later, separately approved action.** It is not part of the
   retirement stage and must not be folded into any stage's cleanup.

Until that separate approval is given, any document describing
`verduraBridge` as deleted is wrong.

**This 7-day soak governs `verduraBridge` retirement only.** The PostgreSQL
old-data-directory retention in §S-PG.9 is a separate requirement with its
own justification.

---

## 7. Deferred by decision — do not configure during this migration

Both are real operational weaknesses, recorded so they are not lost, and both
are explicitly out of scope for every stage above.

**Persistent server logging (deferred).**

- `logging_collector` is currently **off**.
- Persistent PostgreSQL server logging is therefore **absent**.
- A separate logging design/change must define **destination, rotation,
  retention, verbosity and access**.
- That change **requires separate review and approval**.
- It is **not part of S-PG** and must not be bundled implicitly.

DL-114 is the migration runbook, not the future logging design. No
configuration values are specified here.

**PITR / WAL archiving (deferred).**

PITR is not part of this migration. `archive_mode=off`, so PITR is not
currently available. Whether PITR is warranted must be decided separately
from business RPO/RTO requirements, acceptable order-loss exposure, trading
characteristics, operational complexity and tested restore capability.

Increasing validated dump frequency is a possible intermediate option, but it
is not a substitute for an explicit recovery-policy decision.

**Recovery bound, stated precisely:** recovery from logical backup is bounded
by the age of the most recent **successfully validated** backup. A scheduled
cadence does not by itself establish that bound — only successful, validated
execution does.

---

## 8. Security / deferred-remediation findings

**Plaintext PostgreSQL credential in installer scripts.**
`verduraBridge\installers\install-postgres.ps1` and
`install-postgres2.ps1` each contain a plaintext PostgreSQL superuser
credential.

Recorded as a security / deferred-remediation finding. **Do not rotate the
live superuser password, and do not fold password rotation into this
migration.** Rotation interacts with the service account and every stored
connection string, and requires its own documented procedure and separate
approval.

---

## 9. Remaining genuinely unknown stage identities

1. **S3** — identity not established.
2. **S5** — identity not established.
3. **S7, S8, S9** — identities not established.
4. **The Bridge cutover stage number** — the stage's content and its ordering
   before S6 are established; its number is not.
5. **The `verduraBridge` retirement stage number** — content and policy
   established (§6); number not.
6. **Whether S4 contains work beyond the ops-script migration**, and the
   identification of exactly which 8 scripts are the live-critical set.
7. **Where S-PG belongs in the sequence.** It is newly planned and
   unapproved; its position is not established and must not be assumed.

Separately open, not a stage identity: **the deferred `VerduraAPI` log
relocation** — the remaining 1 of 6 of S2. It is blocked by the API's six
dependent services (including `VerduraConnector`), not by any technical
failure; see the S2 DEFERRED FINDING in §2. It requires an approval that
explicitly accepts a Connector restart, and is deliberately **not** to be
scheduled as a standalone production change.

Separately open, not a stage identity: the INC-001 incident details
(timestamp, process count, SCM event id) have never been verified against the
Windows System event log. §0 rule 3 stands on its own merits regardless, but
the incident narrative is not citable as evidence until verified.

---

## 10. Change-tracking note

The 2026-09-03 corrections to
`dl-107-dunedin-live-certification-runbook.md` — three §2 precondition
corrections covering the Bridge/API health probe schemes with
`TableAssignmentConfirmed` evidence, UTC timestamp comparison, and the
superseded menu-mapping count — are **deliberately kept as a change separate
from this runbook**. They correct live-order certification preconditions,
are not migration governance, and must not be merged into a migration commit.

**2026-09-03 — `ProgramData` ACL hardening.** The approved ACL model was
applied to `releases`, `state` and `logs`, discharging §0 rule 7 for those
paths. Sections updated: the status header, §0 rule 7 (STATUS added), §1
(scoping note), §S1 (pre-hardening table marked superseded for the three
paths), and §S2 (prerequisite marked met). Evidence, including the
authoritative rollback descriptors, is at
`_bmad-output/implementation-artifacts/2026-09-03-dl-114-acl-hardening/`.

This was applied **on its own**, deliberately not combined with S2, service
reconfiguration, any service lifecycle operation, the Bridge/Connector
migration, the PostgreSQL relocation, or any deletion. **No stage was
approved, begun or advanced by it.**

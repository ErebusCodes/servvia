# DL-114 — Verdura infrastructure migration runbook

**Status: S0 and S1 are COMPLETE and verified read-only on 2026-09-03.
S2 is COMPLETE at 6 of 6 — the deferred `VerduraAPI` step was executed inside
the approved combined PostgreSQL maintenance window on 2026-09-03 (§S-PG-EXEC).
`verduraBridge` has been RETIRED by rename and is in its 7-day soak (§13) — deletion remains BLOCKED pending both the soak and a separate approval (§14.4). **DL-114 Priority 1 is CLOSED: `VerduraAPI` was relocated off the git checkout and `Documents\verduradb` was deleted on 2026-09-03/04, and both exposed credentials were rotated (§14).** The Bridge cutover is COMPLETE and verified — it runs from an immutable release under `ProgramData` (§12). S-PG is COMPLETE and verified: PostgreSQL now runs from
`C:\Program Files\Verdura\PostgreSQL\18` against
`C:\ProgramData\Verdura\postgres\data`. Every other stage is PLANNING ONLY
and UNAPPROVED — none has been executed.**
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
| **S2** | Service stdout/stderr logging relocation to `C:\ProgramData\Verdura\logs\services\` | **COMPLETE 2026-09-03 — 6 of 6. The five frontends were migrated individually; `VerduraAPI` was completed inside the combined PostgreSQL window that already required its restart (§S-PG-EXEC)** |
| **S3** | *Identity not established* | **UNAPPROVED** |
| **S4** | Includes migration of the 8 live-critical ops scripts into `verdura_MVP\windows-deploy\ops\` | **UNAPPROVED** |
| **S5** | *Identity not established* | **UNAPPROVED** |
| **S6** | **Connector cutover** (targets `IPS.exe`) | **STILL UNAPPROVED.** The Connector was *relocated* at its deployed commit on 2026-09-03 (§13), which is NOT S6 — no retarget was performed and the profile still says `IPSClient` |
| **S7 – S9** | *Identities not established* | **UNAPPROVED** |
| **Bridge cutover** | Bridge relocated to the immutable commit-tagged release `C:\ProgramData\Verdura\releases\bridge\abe301a\`, with state and logs externalized | **COMPLETE and verified 2026-09-03** (§12). Predecessor release retained for rollback |
| **S-PG** | PostgreSQL **binary** relocation to `C:\Program Files\Verdura\PostgreSQL\18` **and** data directory relocation to `C:\ProgramData\Verdura\postgres\data`, plus backup script/output migration off `verduraBridge` | **COMPLETE and verified 2026-09-03** (§S-PG-EXEC). Predecessor cluster retained under §S-PG.9 |
| **`verduraBridge` retirement** | rename + soak | **EXECUTED 2026-09-03** — renamed to `verduraBridge.RETIRED-20260903` after a zero-live-dependency proof; 7-day soak running (§13) |
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

---

## 11. §S-PG-EXEC — combined PostgreSQL maintenance window, 2026-09-03

**Executed and verified. Approved in-session with explicit acceptance of a
controlled stop/start of the SCM-dependent service set, including
`VerduraConnector`.** Evidence:
`_bmad-output/implementation-artifacts/2026-09-03-dl-114-postgres-relocation/`.

The window deliberately combined four changes that all required the same
outage, because `VerduraPostgreSQL` has seven direct dependents and
`VerduraAPI` six more — so any PostgreSQL restart is a full-stack restart, and
splitting the work would have meant repeating the outage.

### What changed

| # | Change | From | To |
| --- | --- | --- | --- |
| 1 | PostgreSQL binaries | `Documents\VerduraPostgresBin\pgsql` | `C:\Program Files\Verdura\PostgreSQL\18` |
| 2 | PostgreSQL data directory | `Documents\verduradb` | `C:\ProgramData\Verdura\postgres\data` |
| 3 | `VerduraAPI` stdout/stderr (the deferred 1 of 6 of S2) | `verduraBridge\VerduraServerOps\api-*.log` | `C:\ProgramData\Verdura\logs\services\api-*.log` |
| 4 | Backup script **and** output | `verduraBridge\VerduraServerOps\pg-backup.ps1` → `verduraBridge\verduradb-backups` | `verdura_MVP\windows-deploy\ops\pg-backup.ps1` → `C:\ProgramData\Verdura\postgres\backups` |

### Why `Program Files`, not `ProgramData`, for the binaries

`ProgramData` is application *data*. Executables there are a binary-planting
exposure, and this runbook already records that the `ProgramData\Verdura`
runtime root still grants `BUILTIN\Users` write by inheritance. `Program Files`
inherits the correct model — `BUILTIN\Users` gets `ReadAndExecute` and **no**
write — so no §0 rule 7 decision was required for the binary tree. The `18`
segment allows a side-by-side major upgrade later.

### Destination ACL model (§0 rule 7 for the new paths)

`C:\ProgramData\Verdura\postgres` was created with inheritance **disabled and
protected**, granting only `NT AUTHORITY\SYSTEM` and `BUILTIN\Administrators`
FullControl `(OI)(CI)`. `data` inherits exactly that — which is what the
LocalSystem postmaster needs and nothing more.

`backups` inherits the same **plus one explicit ACE**:
`DESKTOP-SOKKOQ7\Posmate:(OI)(CI)(M)`. This is required, not a relaxation:
the `VerduraPostgresBackup` task runs as `Posmate` at **`RunLevel=Limited`**,
so its token has `Administrators` filtered out and the inherited
Administrators ACE does not apply. Granting the designated writer is the
minimum that preserves existing behaviour; the alternative — raising the task
to `RunLevel=Highest` — would have granted it full administrative rights and
was rejected as the larger privilege increase.

Verified after application: `BUILTIN\Users` absent, and all three
`CodexSandbox*` identities absent, by `icacls /findsid` across the whole
tree. **This is a net security improvement**: §4.5 recorded that the old data
directory granted `CodexSandboxUsers` `ReadAndExecute` over raw database
files, and the old backup directory carried the same ACE over production
dumps. Neither survives the move.

### Prerequisites, all satisfied before the first stop

9/9 healthy; venue quiescent (newest order 1 d 17 h old, 0 non-idle backends,
0 prepared transactions, no connector backlog); dependency/process/port map
captured; the three rollback descriptors captured exactly; fresh `pg_dump`
and — for the first time on this instance — `pg_dumpall --globals-only`
taken and both validated; exact `COUNT(*)` captured for all 30 user tables;
destination ACLs established and verified.

The pre-relocation dump and globals are held at
`C:\ProgramData\Verdura\postgres\backups\pre-relocation-20260903\`, **outside**
the retention-pruned directory so the nightly 14-file prune cannot reach them.

### Transfer integrity

Services were stopped through SCM in dependency order — six leaves, then
`VerduraAPI`, then `VerduraPostgreSQL`. No PID or process-name termination
was used at any point.

Before any file was touched, the PostgreSQL process tree was proven gone:
captured PIDs 4156 and 5524 both absent, nothing listening on 5432,
`postmaster.pid` absent, and `pg_controldata` reporting
`Database cluster state: shut down`.

The copy used `/COPY:DAT`, **not** `/COPYALL`, precisely so the §4.5 source
ACL defect was not propagated. Independent SHA-256 manifests of both trees
were then compared on relative path, size and hash:
**1,454 files, zero differences.**

### Verification after the change

`SHOW data_directory` = `C:/ProgramData/Verdura/postgres/data`;
`server_version` 18.6; `data_checksums`/`fsync`/`synchronous_commit` all on;
**all 30 table counts identical pre → post**, checked before the API was
started so no application write could mask a discrepancy.

9/9 services Running; `/api/health` `{"status":"ok","db":"ok","redis":"ok"}`;
five frontends 200; Bridge authenticated health 200 with
`bridgeRunning`/`sqlConnected`/`assembliesLoaded` true; Connector heartbeat
advancing across two samples 60 s apart; one process tree per role; **zero
orphaned NSSM wrappers**; no process running from the old binary path.

`VerduraAPI`'s new sink is live and growing while both old sinks are static
and byte-identical across two samples. `AppRotateFiles` remains unset on all
six services.

The backup task ran manually to completion — `LastTaskResult = 0`, proving
the `Limited` token can write to the hardened destination — producing a dump
that validates with `pg_restore --list` at 260 TOC entries and 30 `TABLE DATA`
entries. The old backup directory was not written to.

### `tableAssignmentConfirmed` unchanged

Bridge health still reports `tableAssignmentConfirmed:false`. **The DL-107
certification gate was neither touched nor weakened by this window.**

### Predecessor retention and the amended rollback descriptor

`C:\Users\Posmate\Documents\verduradb` is **retained untouched** under
§S-PG.9. It was re-verified byte-identical to the stopped-copy manifest
*after* the cutover, proving nothing modified it.

`Documents\VerduraPostgresBin` was **removed** after proving no live
reference remained — no service, no scheduled task, no `PATH` entry, no
running process — and after confirming the `Program Files` tree is
byte-identical (20,448 files, 913,597,411 bytes, plus hash spot-checks of
`pg_ctl.exe`, `postgres.exe` and `pg_dump.exe`).

**Because that directory is gone, the originally captured `ImagePath` string
is no longer a usable rollback target. Roll back with the `Program Files`
binaries pointed at the retained predecessor cluster:**

```
"C:\Program Files\Verdura\PostgreSQL\18\bin\pg_ctl.exe" runservice -N "VerduraPostgreSQL" -D "C:\Users\Posmate\Documents\verduradb" -w
```

This is proven viable: `pg_controldata` from the new binaries reads the
predecessor cluster cleanly. The other two rollback descriptors (API log
values, backup task action) are recorded verbatim in
`06-post-cutover-verification.txt`.

### `verduraBridge` dependencies removed by this window

The API log sinks, the backup script and the backup output directory no
longer resolve into `verduraBridge`. What remains is recorded in §6 as the
current dependency set — the Bridge and Connector service definitions
themselves, and two scheduled tasks.

---

## 12. Bridge cutover — executed 2026-09-03

**Executed and verified.** Approved in-session as an isolated maintenance
window for `VerduraIdealposBridgeSvc` only. Evidence:
`_bmad-output/implementation-artifacts/2026-09-03-dl-114-bridge-staging/`.

**Outage was ~60 seconds and affected one service.** The Bridge has no SCM
dependents and no dependencies, so 8 of the 9 services stayed Running
throughout. This is why it was executed on its own rather than folded into a
larger window.

### Deployed commit — and why not HEAD

The release is **`abe301a`**, not repo HEAD. **This was a relocation, and a
relocation must not smuggle in a code upgrade.**

The running binary carried no provenance record, so its source had to be
established by evidence:

- building `abe301a` produces **120,320 bytes**, an exact size match with the
  deployed binary;
- the two differ by only **six embedded managed strings**, every one a
  build-path or compression artifact — no functional string differs;
- a raw byte comparison differs in ~18%, but that is metadata and layout from
  a different toolchain invocation. **.NET builds are not deterministic, so
  raw-byte equality is the wrong test here**; size plus embedded-string
  identity is the reliable one. Do not later mistake that 18% for evidence of
  a functional difference.

Building HEAD (`567dce7`) produces **148,992 bytes** and adds **386** embedded
strings across four commits after `abe301a` — `833540f`, `8d0cd1a`,
`4b2a394`, `442a7c4` — covering P0 cross-store reconciliation, POSServer
table-sale resolution by code, and table-assignment capability reporting.
Those touch the live order path.

**HEAD additionally references a `PosServerConnection` connection string that
exists in neither the production config nor the repo `App.config`**, so its
cross-store reconciliation would ship inert until someone supplies POSServer
credentials — a separate production configuration decision.

**Upgrading the Bridge to HEAD therefore remains OPEN and UNAPPROVED.** It is
a functional change to the order path and needs its own approval plus DL-107
certification consideration. It is not part of any relocation stage.

### What moved

| Element | From | To |
| --- | --- | --- |
| Binaries | `verduraBridge\verduraIdealposBridge\bin\Release\net48` | `C:\ProgramData\Verdura\releases\bridge\abe301a` (immutable, manifested) |
| State DB | `…\net48\state\bridge-state.sqlite` | `C:\ProgramData\Verdura\state\bridge\bridge-state.sqlite` |
| App logs | `…\net48\logs\` | `C:\ProgramData\Verdura\logs\bridge\` |
| NSSM stdout/stderr | `verduraBridge\VerduraServerOps\bridge-svc-*.log` | `C:\ProgramData\Verdura\logs\services\bridge-svc-*.log` |

Exactly two config settings differ from production — `Bridge:StateDatabasePath`
and `Logging:Directory`, both now absolute. `BridgeConfig.ResolvePath` honours
rooted paths. **Every other setting is byte-identical to production, including
the production `Bridge:ApiKey` and the `IpsConnection` string. No repository
default was substituted for a production secret** — verified by authenticating
the post-cutover health probe with the carried-over key.

All seven vendor and native assemblies were verified byte-identical by SHA-256
to those running in production before the switch.

### Verification

Service Running from the release path; release manifest re-verified after
start (11 files, 0 mismatches, 0 unexpected files); Bridge authenticated
health 200 with `bridgeRunning`/`sqlConnected`/`assembliesLoaded` true;
9/9 services Running; `/api/health` ok; five frontends 200; Connector
heartbeat advancing across two samples 60 s apart, confirming it recovered
from the Bridge gap; zero orphaned wrappers; exactly one Bridge process.

**Proof the externalized paths are genuinely in effect:** the release
directory contains **no** `state\` or `logs\` subdirectory. Had the app fallen
back to relative resolution it would have created them beside the binaries.
The app log is being written to the absolute `ProgramData` path, which
exercises the same config file and the same `ResolvePath` call as the state
path.

The predecessor state DB is untouched (20,480 bytes, 2026-09-01 17:07:52).

### Deliberately unchanged

`Idealpos:ExpectedIpsExePath` still points at the nonexistent
`C:\Idealpos\IPS.exe`, so `ipsExePathExists` remains `false`. Correcting it is
§5 work and changes a health field, so it was kept out of a relocation.

`Idealpos:TableAssignmentConfirmed` remains `false`. **The DL-107
certification gate was not touched or weakened.**

### Rollback (still available)

Restore four NSSM values — `Application` and `AppDirectory` to the
`verduraBridge` net48 path, `AppStdout`/`AppStderr` to
`VerduraServerOps\bridge-svc-*.log` — and restart. The predecessor release
directory and its state DB are intact, so rollback is a pointer change plus a
restart. Exact values are in `01-staging-record.txt`.

### `verduraBridge` dependency set after this stage

Re-audited immediately after cutover:

1. **`VerduraConnector`** — `Application`, `AppDirectory`, `AppStdout`,
   `AppStderr`, and `AppEnvironmentExtra` (which carries `TRACER_STORE_PATH`
   and `TRACER_PROFILE_PATH` **and the production Connector and Bridge
   credentials — these must be carried across verbatim at S6, never replaced
   with repository defaults**).
2. **Scheduled task `Verdura Redis Startup`** (Ready) →
   `VerduraServerOps\ensure-verdura-redis.ps1`.
3. **Scheduled task `Verdura Window Display`** (Disabled) → log paths only.

Everything else under `verduraBridge` is now inert: the predecessor Bridge
release (retained for rollback), `verduradb-backups` (superseded),
`installers`, `migration-state`, and `VerduraServer.retired-20260827-155640`.

**S6 plus the two scheduled tasks are all that stand between here and
`verduraBridge` retirement.**

---

## 13. Connector relocation and `verduraBridge` retirement — 2026-09-03

**Executed and verified.** Approved in-session as authorization to move the
three remaining live dependencies out of `verduraBridge`, then classify the
directory. Evidence:
`_bmad-output/implementation-artifacts/2026-09-03-dl-114-connector-and-retirement/`.

### THIS IS NOT S6 — read before touching the Connector again

S6 is defined in §S6 as the Connector cutover **that targets `IPS.exe`**.
What was executed here is a **relocation at the deployed commit**, with the
discovery profile carried across **unchanged**. It still reads
`ExpectedProcessName: "IPSClient"`.

**S6 remains OPEN and UNAPPROVED.** Performing it means deploying nine
commits of new IdealPOS automation — fail-closed native table execution,
control-tree capture, HWND-bound capture, and the two retarget commits
`33fd573` and `2b023de` — onto the live order path. That is DL-107
certification territory and needs its own approval.

**Do not "fix" the deployed profile on its own.** `Cli/Program.cs`
deserializes the profile and builds a `WindowsUiAutomationClient` from its
`ExpectedProcessName` *before* branching on `TRACER_MODE`, and passes both
into `RunAlwaysOnHostAsync`. The `ProfileVersion` string
`DUNEDIN-CLOUD-MODE-UNUSED` is a label someone wrote, **not** behaviour — the
profile is live in cloud mode. Correcting it is a behaviour change and
belongs with the retargeted binary, not with this build.

**IPS revalidation was still performed**, as the control requires: `IPS.exe`
pid 4332 (started 2026-09-03 04:01:46) and `IPSClient.exe` pid 12800 were
**both running concurrently**, from
`C:\Program Files (x86)\Idealpos Solutions\Idealpos\`. Recorded, not assumed.

### What moved

| Dependency | From | To |
| --- | --- | --- |
| Connector binaries | `verduraBridge\VerduraOrderTabletConnector\src\…\publish` | `C:\ProgramData\Verdura\releases\connector\9f17006` (38 files, manifested) |
| Connector state | `…\tracer-store.jsonl` | `C:\ProgramData\Verdura\state\connector\` |
| Discovery profile | `…\discovery-profile.local.json` | `C:\ProgramData\Verdura\config\connector\` |
| Connector NSSM logs | `VerduraServerOps\connector-*.log` | `C:\ProgramData\Verdura\logs\services\` |
| Redis startup script | `VerduraServerOps\ensure-verdura-redis.ps1` | `verdura_MVP\windows-deploy\ops\` (parameterized; log → `logs\ops\`) |
| Window Display task logs | `VerduraServerOps\window-display.*.log` | `C:\ProgramData\Verdura\logs\ops\` |

The release is a **byte-identical copy of the running publish output** —
per-file SHA-256, 38 files, zero mismatches — so no functional change was
deployed. `tracer-store.jsonl` was migrated with the service **stopped**.

**Production credentials were preserved verbatim.** `AppEnvironmentExtra`
went in with 7 elements and came out with 7; `TRACER_CONNECTOR_CREDENTIAL`
and `IDEALPOS_BRIDGE_API_KEY` were verified unchanged by case-sensitive
comparison. They live only in that NSSM value — never in the release
directory, never in the repository.

**Commit provenance for the Connector is circumstantial, not
cryptographic** — the deployed binaries are dated four minutes after
`9f17006`, and the directory held a
`…exe.backup-20260830-pre-capability-fix` file matching that commit's
subject. A reproducing `dotnet publish` was attempted and failed on MSB3030
in this environment. Because the release is a byte-identical copy, this
affects the confidence of the *label* only. Details in its
`DEPLOYED-COMMIT.txt`.

### Zero-live-dependency proof, run before the rename

- **Services** — ImagePath and *every* NSSM parameter including the
  environment block: **none**.
- **Scheduled tasks** — every task on the host, not only `Verdura*`-named:
  **none**.
- **Running processes** imaged under `verduraBridge`: **none**.

Three stray `cmd`/`powershell` processes carried the path in their *command
line* — orphaned diagnostic shells from an earlier session (parent gone, a
recursive listing piped into `ssh`). They are not services and not service
children. **They were left running**, per §0 rule 3, and the rename then
succeeded, which proves they held no blocking handle.

### Retirement

```
C:\Users\Posmate\Documents\verduraBridge
  -> C:\Users\Posmate\Documents\verduraBridge.RETIRED-20260903
```

Per §6.2. **Soak of at least 7 full days, retained intact. Deletion is a
separate later approval and is not implied by this rename.**

Post-rename verification: 9/9 services Running; `/api/health` ok; five
frontends 200; Bridge authenticated health 200 with
`bridgeRunning`/`sqlConnected`/`assembliesLoaded` true; Connector heartbeat
advancing across two samples 60 s apart; zero orphaned wrappers; no process
imaged under the old path. **The rename surviving cleanly is the empirical
proof that the dependency count really was zero.**

### AMENDED ROLLBACK — binding

**The rename invalidated the literal paths in both service-pointer rollback
descriptors.** To roll back the Bridge or the Connector, **first rename
`verduraBridge.RETIRED-20260903` back to `verduraBridge`**, then restore the
recorded NSSM values. The predecessor trees are retained intact for exactly
this reason, which is the point of the soak.

### Two things inside the retired tree that need deliberate handling

1. **`VerduraServerOps\connector-credential.txt`** (80 bytes) is a credential
   file. Nothing reads it — the live credential is in the NSSM environment —
   but it must be dealt with deliberately at the deletion decision, not swept
   up by a bulk delete.
2. The **predecessor Bridge and Connector releases** are the rollback targets
   for §12 and this section. They must survive the full soak.

### What is left in `Documents`

Only `verduradb` (RETIREMENT/SOAK under §S-PG.9), `verdura_MVP` (the approved
repository location, not a migration target), and the renamed
`verduraBridge.RETIRED-20260903`. **All five originally targeted
`Documents`-root directories are now removed or in a retention gate.**

---

## 14. API relocation, `verduradb` deletion and credential rotation — 2026-09-03/04

**Executed and verified.** This closes DL-114 Priority 1: no production
component resolves runtime code, dependencies or configuration from the
mutable git checkout any longer.

### 14.1 `VerduraAPI` relocated off the checkout — the last one

`VerduraAPI` was the eighth and final service still running from
`verdura_MVP`. It is now:

| | Before | After |
| --- | --- | --- |
| `Application` | `C:\Program Files\nodejs\node.exe` | unchanged |
| `AppParameters` | `dist\src\main.js` | `C:\ProgramData\Verdura\releases\api\509d71e-asrun\apps\api\dist\src\main.js` |
| `AppDirectory` | `verdura_MVP\apps\api` | `C:\ProgramData\Verdura\config\api` |

**Three cwd-relative dependencies had to be handled, not just `.env`.** The
previously recorded blocker was only the first of them:

1. **`.env` from `process.cwd()`** — `main.js` checks for it and
   `ConfigModule.forRoot()` defaults to `.env` relative to cwd. cwd is
   therefore the governed secrets directory `config\api`, which is why
   `AppDirectory` is a *config* path and not the release path. ACLs are
   inherited from `config\` (SYSTEM / Administrators / Posmate), matching
   `config\bridge`.
2. **`MEDIA_STORAGE_PATH`** was the relative value `storage`, which
   `media-storage.util.js` resolves against cwd. Changed to the absolute
   `C:\ProgramData\Verdura\state\api\storage`. This was the ONLY line changed
   in `.env`; all 23 keys were verified preserved, CRLF structure intact.
3. **Menu-image writes.** `media.service.js` walks up from cwd looking for
   `docker-compose.yml` (max 4 levels) and writes uploads to
   `<projectRoot>\apps\*\public\menu-images`. **This was writing into the git
   checkout in production.** No `docker-compose.yml` exists anywhere on the
   walk from `config\api`, so `projectRoot` stays cwd; `config\api\apps` is an
   NTFS **junction** to `state\api\apps`, so those writes now land in `state\`.
   The 47 existing images per frontend were migrated there.

**Known pre-existing behaviour, deliberately NOT changed:** the frontends are
served from prebuilt `dist\`, so a newly uploaded menu image is not served
until a frontend rebuild. That was already true before this relocation. It is
a real defect but fixing it is a behaviour change, not a relocation.

**Release provenance.** `releases\api\509d71e-asrun` is a byte-identical copy
of what was already running — `dist\src\main.js` SHA-256 verified equal, 509
dist files, and the resolved dependency closure (64,384 files / 643 MB) copied
from the checkout root. The four npm-workspace junctions (`api`,
`admin-console`, `customer-website`, `window-display`) were excluded with
`robocopy /XJ` so nothing can resolve back into the checkout. The `-asrun`
suffix is deliberate: HEAD is `509d71e` but the artifact was **not rebuilt**
from it. `shared\table-config.json` is carried in the release and resolves via
the `__dirname` fallback in `tables.service.js`.

**Proof of independence:** the running API process loads 51 modules, **zero**
of them from `verdura_MVP`; its three native modules
(`msgpackr-extract`, `argon2`, `.prisma\query_engine-windows.dll.node`) all
load from the governed release. `/api/health` returns
`{"status":"ok","db":"ok","redis":"ok"}`.

Rollback: `rollback\services-20260903-api-relocation\`.

### 14.2 INCIDENT — dependent services stopped during the cutover

`Stop-Service VerduraAPI -Force` was used to stop the API. **Six services
declare a dependency on `VerduraAPI`** (`VerduraAdminConsole`,
`VerduraCustomerWebsite`, `VerduraKitchenDisplay`, `VerduraOrderTablet`,
`VerduraWindowDisplay`, `VerduraConnector`) and `-Force` stopped all of them.
`Start-Service VerduraAPI` does **not** restart dependents, so the platform sat
at 3/9 until detected and corrected. All six were restarted via SCM and
verified; total exposure was under three minutes and no orphan was produced.

**Binding rule added:** never use `Stop-Service -Force` on `VerduraAPI`.
Enumerate `(Get-Service X).DependentServices` before any stop, and if
dependents were stopped, restart them explicitly and re-verify 9/9. This is
recorded here because the INC-001 rules covered orphan creation but did not
cover dependency-cascade stops.

### 14.3 `Documents\verduradb` DELETED

The stale PostgreSQL cluster directory (1,454 files / 70.3 MB, `PG_VERSION`
present, **no** `postmaster.pid`) was deleted after all gates passed.

Dependency proof: zero Windows services, zero NSSM parameters across all eight
NSSM services, zero scheduled tasks, zero running processes, zero ProgramData
scripts or config referenced it. Live `SHOW data_directory` returns
`C:/ProgramData/Verdura/postgres/data`.

**Restore proof re-run tonight with durable evidence** —
`rollback\postgres-restore-proof-20260903\`. The earlier proof left no durable
artifact and its scratch DB had been dropped, so it was redone properly:

- fresh dump taken with the **governed** `ops\pg-backup.ps1`;
- disposable scratch DB `verdura_restore_proof_20260903` created and restored
  into (`pg_restore` exit 0);
- **30 / 30 tables exact row-count match, 0 mismatches**; 78/78 indexes;
  69/69 foreign keys; no table present on only one side;
- scratch DB dropped; production re-inventoried and **identical 30/30**,
  confirming production was never modified. All production access was
  `SELECT` / `pg_dump` only.

Post-deletion: path absent, PostgreSQL Running, `data_directory` still under
`ProgramData`, `MenuItem` 895 rows, `/api/health` ok, both governed scheduled
tasks `LastTaskResult=0`, zero residual references.

### 14.4 `verduraBridge.RETIRED-20260903` — NOT deleted, genuinely blocked

Full assessment: `rollback\retired-bridge-deletion-gate-20260903\`.

Every **dependency** gate passes — zero services, NSSM parameters, tasks,
processes or runtime config reference the tree; Bridge and Connector both run
from governed `ProgramData` releases. The blocker is **retention**, and it is
this document, section 13, committed at `a9c2d8c`:

> "Soak of at least 7 full days, retained intact. **Deletion is a separate
> later approval and is not implied by this rename.**"

together with the binding amended rollback, which makes the retired tree the
rollback target for sections 12 and 13.

**Earliest legitimate deletion requires BOTH** 7 full days from 2026-09-03
(i.e. on or after 2026-09-10) **and** a separate explicit approval. Elapsed
time alone does not unblock it.

Two additional prerequisites found tonight that section 13 does not record:

1. The **predecessor Bridge binary exists only inside the retired tree**.
   `rollback\pre-migration-20260902` holds the Bridge config, state and hashes
   but not the binary. The Connector predecessor *is* already independent
   (`rollback\connector-publish-20260826`). Rollback must be made independent
   before deletion — and must reuse the **authoritative external** state at
   `state\bridge\bridge-state.sqlite`, not the copy frozen at 2026-09-01
   inside the retired tree.
2. `verduradb-backups\` inside the retired tree holds **14 production dumps
   spanning 2026-08-26 to 2026-09-03**. `postgres\backups\` holds only
   2026-09-03 dumps. Deleting the tree today would destroy roughly eight days
   of unique backup history; it must be archived into `ProgramData` first.

### 14.5 Credential rotation — both exposed credentials rotated

Full record: `rollback\credential-rotation-20260903\`. No plaintext value was
printed, logged, committed or placed on any command line; NSSM environment
writes were made **directly to the registry** (`REG_MULTI_SZ`) rather than via
`nssm set`, so nothing appeared in a process listing. `nssm dump` was not used.
Identity is proven by SHA-256 fingerprint only.

**`IDEALPOS_BRIDGE_API_KEY`** — authority is `Bridge:ApiKey` in the config
**beside the exe** (`releases\bridge\abe301a\...exe.config`; .NET resolves
`<exePath>.config`), mirrored to `config\bridge\`. Both updated by targeted
attribute replacement: 14 appSettings and the `IpsConnection` connection
string preserved, file still 5,616 bytes with its UTF-8 BOM.
Verified: new key produced `/api/health` **200** with `bridgeRunning`,
`sqlConnected`, `assembliesLoaded`, `orderProcessingPathAvailable` all true;
**old key produced 401**. Rollback source is the fingerprint-verified
`rollback\pre-migration-20260902\config\bridge-api-key.txt`.

**`TRACER_CONNECTOR_CREDENTIAL`** — rotated through the API's own enrolment
path (`POST venues/{id}/connector/enrollments` then `POST connector/enroll`),
so the server-side argon2 hash and the client secret stay consistent by
construction. The enrol transaction atomically marked the prior installation
`replaced`. Verified: old installation `2d0993d4...` became `replaced` with
`replacedByInstallationId` set; new installation `3277d472...` is `active`
with `lastSeenAt` advancing across samples 30 s apart. Since
`ConnectorService.authenticate()` returns null unless `status === 'active'`,
the old credential is provably no longer a valid production credential.

**Side effect:** the plaintext credential files in the retired tree
(`VerduraServerOps\connector-credential.txt`, `bridge-api-key.txt`) are now
inert. The `bridge-api-key.txt` copies remain the documented rollback source
for the Bridge key and must not be deleted while that path is relied on.

### 14.6 Final architecture sweep — `verdura_MVP` is source/development only

Searched every production dependency surface: service `ImagePath`; NSSM
`Application` / `AppDirectory` / `AppParameters` / `AppStdout` / `AppStderr`;
NSSM environment blocks including secret-valued elements; **all** scheduled
tasks on the host; running process image paths and command lines;
Docker/Compose inputs; PostgreSQL paths; log and state paths.

**Result: zero production runtime or configuration dependencies on
`verdura_MVP`, and zero on any deleted or retired `Documents`-root path.**

Correctly classified as **not** dependencies:

- `MANIFEST.json` `sourceRepo` / `sourcePath` fields — build provenance.
- `rollback\**` descriptors — they record pre-migration paths *by design*.
- `README.md` and `archive\README*.md` prose.
- The running `verdura-redis-1` container's compose labels point at
  `C:\Users\Posmate\Desktop\verdura_MVP` — a path that **no longer exists**.
  These are inert metadata baked in at container creation on 2026-08-13. The
  governed `ops\ensure-verdura-redis.ps1` defaults `-ComposeFile` to
  `ProgramData\Verdura\ops\docker-compose.redis.yml`; it ran at 14:06 with
  `LastTaskResult=0` and the container was **not** recreated
  (`RestartCount=0`, created 2026-08-13, started 2026-08-27).
- The `Verdura Window Display` scheduled task (`npm run dev --workspace=...`)
  is **Disabled**, has an empty `WorkingDirectory`, last failed on 2026-08-27,
  and is superseded by the `VerduraWindowDisplay` NSSM service on port 5174.
  It is a dormant legacy path, not a live dependency. **Recommend deleting
  it** — deferred as it is a production task change outside tonight's scope.

### 14.7 Final verification

9/9 services Running; five frontends HTTP 200; `/api/health`
`status/db/redis = ok`; authenticated Bridge health 200 with all flags true;
Redis `PONG` with container identity preserved; PostgreSQL Running with
`data_directory` under `ProgramData`; both governed tasks `LastTaskResult=0`;
8/8 NSSM wrappers claimed by SCM with **zero** orphans, all parented to
`services.exe`; exactly one listener on each of 3000, 5173-5177, 5588 and
6379; Connector heartbeat advancing. Working tree clean apart from untracked
`.claude/worktrees/`.

### 14.8 Resulting target state

```
C:\Users\Posmate\Documents
    verdura_MVP\                     SOURCE / DEVELOPMENT ONLY
    verduraBridge.RETIRED-20260903\  retention gate until >= 2026-09-10 + approval

C:\ProgramData\Verdura               governed production home
    releases\  api\509d71e-asrun  bridge\abe301a
               connector\9f17006  frontends\a9c2d8c
```


---

## 15. Migration exception closure — 2026-09-04

Section 14 closed DL-114 Priority 1 but left four technical exceptions. Three
are now eliminated. The fourth is the retired-tree retention gate, which is
time-bound and cannot mature before 2026-09-10.

### 15.1 API rollback is now repository-independent

Section 14 proved the API *runtime* independent of `verdura_MVP`, but the
recorded rollback still pointed at `verdura_MVP\apps\api`, the root
`node_modules` and the checkout `.env`. The repository therefore could not
honestly be called unnecessary to production recovery. That is now fixed.

New package: `rollback\api-prerelocation-20260903\`

- `cwd\.env` — byte-identical to the pre-relocation checkout `.env`
  (sha256 `61C75C00…FFCC5F`), all 23 keys, `MEDIA_STORAGE_PATH` still the
  original relative `storage`.
- `cwd\storage\` and `cwd\apps\*\public\menu-images\` — pre-created so the
  original *relative* path semantics resolve inside ProgramData, and seeded
  with the 47 images per frontend so a rollback loses no media.
- `ROLLBACK.md` — exact SCM/NSSM steps, no secret values.
- Runtime bits come from `releases\api\509d71e-asrun`, which is proven
  byte-identical to what the service executed before the cutover (§15.2).

ACLs break inheritance and grant SYSTEM, Administrators and the host owner
only — verified identical to `rollback\pre-migration-20260902\config`. This
matters: the wider `rollback\` tree inherits `BUILTIN\Users:ReadAndExecute`
from `ProgramData`, so secret-bearing material placed there must break
inheritance explicitly.

> **icacls trap, hit twice tonight.** `icacls DIR /inheritance:r /grant
> "X:(OI)(CI)F" /T` leaves **files with an empty ACL** — `(OI)(CI)` are
> inheritance flags and do not apply to the file objects themselves, while
> `/T` strips their inherited ACEs. Apply it to the directory **without** `/T`
> and let children inherit.

**Proof (no second API server was started, nothing bound a port):** a
module-resolution smoke test with cwd set to the rollback cwd loaded
`dist/src/app.module.js`:

```
modules resolved             = 2207
resolved OUTSIDE ProgramData = 0
resolved from verdura_MVP    = 0
```

`dotenv`, `@nestjs/core`, `@nestjs/config`, `@prisma/client`, `argon2` and
`ioredis` all resolve inside the release; `shared\table-config.json` resolves
to the release copy. The identical test from the live cwd returns the same
figures.

The one pre-cutover behaviour deliberately **not** reproduced is the defect
where menu-image uploads were written into the git checkout — reproducing it
would reintroduce the very dependency this package removes.

The repository is **not** deleted and remains the canonical development source.

### 15.2 API release integrity standardized

`releases\api\509d71e-asrun\SHA256SUMS.txt` now carries **64,947 entries**,
covering every file in the release. Verification:

- coverage — 64,947 on disk vs 64,947 in manifest, **0 missing, 0 extra**;
- all 563 non-`node_modules` files hash-verified, **0 mismatch**;
- 400-file random sample across `node_modules`, **0 mismatch**.

The single exclusion is `SHA256SUMS.txt` itself, which cannot contain its own
hash. Nothing is excluded for convenience. `MANIFEST.json` was rewritten first
and is covered.

**Equivalence to the checkout is fully proven, not sampled** (`EQUIVALENCE.txt`
in the release). An independent SHA-256 pass over the checkout hashed the entire
`node_modules` closure and the whole application payload, then compared both
directions:

```
checkout files compared            : 64,945
  byte-identical in release        : 64,945
  hash differs                     :      0
  present in checkout, absent here :      0
release files with no checkout counterpart (excl. release metadata) : 0
```

So the release is not merely *believed* to be what production was executing
before the cutover — every byte of it is demonstrated to be.

### 15.3 Bridge config externalized — the immutability defect is fixed, not papered over

§14 recorded a real defect: rotating `Bridge:ApiKey` mutated a file inside a
directory declared immutable, and `SHA256SUMS.txt` went stale on exactly that
one entry. Re-hashing it would have hidden the problem rather than solved it.

**Link semantics were proven before production was touched.** A purpose-built
.NET Framework console app reading `ConfigurationManager` exactly as
`BridgeConfig.cs` does was compiled into a disposable directory and driven
through both mechanisms:

| Mechanism | reads through link | sees external in-place edit | survives target delete+recreate |
| --- | --- | --- | --- |
| Symbolic link | yes | yes | **yes** |
| Hard link | yes | yes | **NO — served stale content** |

The hard link was rejected on that third result. Preconditions confirmed:
`fsutil behavior query SymlinkEvaluation` reports local-to-local symlinks
**enabled** (the service runs as LocalSystem), and `BridgeConfig.cs` only ever
*reads* via `ConfigurationManager` — it never calls
`OpenExeConfiguration(...).Save()`, so nothing writes through the link.

Applied: `releases\bridge\abe301a\VerduraIdealposBridge.exe.config` is now a
symbolic link to `config\bridge\VerduraIdealposBridge.exe.config`. The
secret-bearing file physically exists **only** under protected ProgramData
config. `SHA256SUMS.txt` now hashes the **10 immutable payload files** and
`INTEGRITY.md` records the config as external mutable configuration that is
excluded on purpose.

All 10 payload hashes still equal their **original** recorded values — proof
the rotation and this change touched the configuration and nothing else.

Verified after restarting only the Bridge (it has no dependents, so no cascade
was possible): authenticated `/api/health` **200** with `bridgeRunning`,
`sqlConnected` (`sqlDetail` ok), `assembliesLoaded`, `ipsExeRunning` and
`orderProcessingPathAvailable` all true; rotated key accepted; pre-rotation key
**401**; unauthenticated **401**; Connector heartbeat advancing; 8/8 wrappers
claimed, zero orphans.

Rollback: `rollback\bridge-config-externalization-20260904\ROLLBACK.md`.

### 15.4 Retired-tree deletion prerequisites are now independent

The tree is **not** deleted and must not be. But nothing unique is trapped in
it any more.

1. **Predecessor Bridge binary** → `rollback\bridge-predecessor-20260831\`.
   Nine payload files, every one SHA-256 verified equal to source, 0
   mismatches. Frozen SQLite state was deliberately **not** copied — its
   README mandates using the authoritative external
   `state\bridge\bridge-state.sqlite` and warns that restoring the captured
   config's *relative* `Bridge:StateDatabasePath` would silently fork
   production state. The predecessor `exe.config` was **not** duplicated: it is
   byte-identical to `pre-migration-20260902\config\bridge-exe.config`, already
   under protected ProgramData, so the number of plaintext copies of the
   pre-rotation key does not grow.
2. **Fourteen unique historical dumps** → `archive\postgres-backups-pre-20260903\`.
   14 of 14 SHA-256 match, original filenames and timestamps preserved.
   Placed under `archive\`, **not** `postgres\backups\`, because
   `pg-backup.ps1` prunes that directory to the newest 14 and would have
   deleted this history within days.
3. **`connector-credential.txt`** — **not copied, not read, not hashed.**
   Hashing it would retain a fingerprint of a secret for no operational
   benefit. Its credential is already superseded: installation
   `2d0993d4…` is `replaced`, and `authenticate()` returns null unless status
   is `active`. It must be **securely destroyed** with the tree at deletion
   time, along with `bridge-api-key.txt` and `owner-token.txt` in that
   directory — while the separate `pre-migration-20260902\config` copy of
   `bridge-api-key.txt` **survives**, being the documented rollback source for
   the key rotation.

### 15.5 Exact retention deadline

Anchor: commit `a9c2d8c` and its evidence file
`2026-09-03-dl-114-connector-and-retirement\01-connector-and-retirement.txt`,
both timestamped **2026-09-03 11:23:31 +12:00**.

**Earliest legitimate deletion: 2026-09-10 11:23:31 +12:00 (NZST,
Pacific/Auckland).** New Zealand daylight time does not begin until the last
Sunday of September, so the offset is +12:00 on that date, not +13:00.

**A separate explicit deletion approval is still required after that
timestamp.** §13 states deletion "is a separate later approval and is not
implied by this rename", so the clock expiring does not by itself authorise
anything.

### 15.6 Closure

The retired tree is now retained for **one reason only**: the authoritative
time-bound retention clock plus the required separate approval. No unique
technical rollback or audit material depends on it.


### 15.7 Two accuracy notes recorded at change-freeze

**(a) Scope / change-control deviation — not an incident.** The Bridge config
externalization in §15.3 altered production configuration architecture and
restarted a production service. The direction immediately before that window
had asked for read-only checks unless a corrective change was genuinely
required, and under that direction the stale hash was found and reported but
deliberately left alone. The work was then explicitly requested as section C of
the following direction, including its step 5 permitting a Bridge-only SCM
restart to prove configuration loading. It is recorded as a **scope/change-
control deviation** so the transition is visible in the record, and **not** as
an incident: there was no outage, no degraded service and no failed check.
The link mechanism was proven in a disposable harness first, the hardlink was
rejected on evidence, only the Bridge was restarted (its DependentServices set
was confirmed empty, so no cascade was possible), post-change authenticated
health passed, and 9/9 services with 8/8 claimed wrappers and zero orphans were
verified after. **No rollback is requested — the resulting state is healthy and
is the accepted baseline.** Full record:
\ollback\bridge-config-externalization-20260904\ROLLBACK.md\.

**(b) "Repository-independent" is precise, but does not mean self-contained.**
The API rollback is independent of \C:\Users\Posmate\Documents\verdura_MVP\,
and its dependency resolution is wholly within governed
\C:\ProgramData\Verdura\. It does **not** carry its own duplicate dependency
closure: \ollback\api-prerelocation-20260903\ holds 143 files (the
pre-relocation \.env\, the working-directory skeleton, 141 seeded menu images
and its README) and contains no \
ode_modules\. The runtime bits and the
64,384-file closure are **referenced** in the governed release
\eleases\api\509d71e-asrun\, not duplicated. That is acceptable because the
release is governed, fully hash-manifested and proven byte-identical to the
pre-cutover payload — but the consequence must be understood: destroying that
release would disable both the live deployment and this rollback path. If
independently survivable rollback bits are ever required, a duplicated closure
would have to be created. That has not been done.

# DL-114 §0 rule 7 — `ProgramData` ACL hardening evidence (2026-09-03)

Applied and verified on **2026-09-03 02:14–02:17 +12:00**, host
`DESKTOP-SOKKOQ7`, by an elevated `DESKTOP-SOKKOQ7\Posmate` session.

**Scope — exactly one change was made.** The approved ACL model was applied to
three paths and nothing else:

- `C:\ProgramData\Verdura\releases`
- `C:\ProgramData\Verdura\state`
- `C:\ProgramData\Verdura\logs`

No service was stopped, started, restarted or reconfigured. No file was
created, moved or deleted in any of the three trees. S2, the Bridge/Connector
migration, the PostgreSQL relocation and every other DL-114 stage remain
unexecuted and unapproved.

---

## 1. Approved model

| Element | Applied as |
| --- | --- |
| Inheritance | **disabled and protected** (`SE_DACL_PROTECTED`) |
| `NT AUTHORITY\SYSTEM` (`S-1-5-18`) | FullControl, `(OI)(CI)`, explicit |
| `BUILTIN\Administrators` (`S-1-5-32-544`) | FullControl, `(OI)(CI)`, explicit |
| `BUILTIN\Users` (`S-1-5-32-545`) | **removed entirely** |
| `CodexSandboxUsers` / `CodexSandboxOffline` / `CodexSandboxOnline` | **no access of any kind** |
| `CREATOR OWNER` | **removed** — see §4 |
| Owner | **unchanged** (`BUILTIN\Administrators`) — ownership was not touched |

Resulting DACL, identical on all three roots:

```
D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)
```

Resulting DACL on every descendant (inherited, unprotected, no explicit ACEs):

```
D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)
```

---

## 2. State before the change

All three roots were **unprotected** (`D:AI`) and every ACE on them was
**inherited** from the `C:\ProgramData` default model — none was explicit:

```
D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIIOID;GA;;;CO)
    (A;OICIID;0x1200a9;;;BU)(A;CIID;DCLCRPCR;;;BU)
```

That is: SYSTEM FullControl, Administrators FullControl, `CREATOR OWNER`
GenericAll (inherit-only), `BUILTIN\Users` Read/Execute (`0x1200a9`), and
`BUILTIN\Users` **write** (`DCLCRPCR` = create files, create folders, write
extended attributes, write attributes; container-inherit).

That last ACE is the inherited `BUILTIN\Users` write access §0 rule 7 names.
It is now gone from all three trees.

All 7 descendants (`releases\{bridge,connector}`,
`state\{bridge,connector}`, `logs\{archive,bridge,services}`) were likewise
unprotected with only inherited ACEs, and all three trees were **empty of
files**. No CodexSandbox identity appeared anywhere under
`C:\ProgramData\Verdura` before the change, consistent with the runbook §S1
observation.

---

## 3. Rollback — the captured descriptors are authoritative

Re-enabling inheritance is **not** the rollback procedure. Restore from the
captured descriptors:

```powershell
# releases
icacls "C:\ProgramData\Verdura" /restore "<this dir>\pre\02-releases.save.acl"
# state
icacls "C:\ProgramData\Verdura" /restore "<this dir>\pre\03-state.save.acl"
# logs
icacls "C:\ProgramData\Verdura" /restore "<this dir>\pre\04-logs.save.acl"
```

The `.save.acl` files are `icacls /save /T` captures holding the root **and**
every descendant, with names relative to `C:\ProgramData\Verdura` — which is
why the restore target is the parent directory, not the root being restored.

Cross-check after any restore: the resulting SDDL must match the `Sddl` field
in the corresponding `pre\*.acl.json`, and the descendants must match
`pre\*.descendants.tsv`.

*Note, recorded as fact rather than relied upon:* because every pre-change ACE
on these three roots carried the `ID` (inherited) flag and none was explicit,
un-protecting would in this specific case have reproduced the original ACL.
That was verified, not assumed, and the `/restore` path above remains the
authoritative procedure.

---

## 4. Why `CREATOR OWNER` was removed

The approved model removes `CREATOR OWNER` "if it is not required once
inheritance is protected". It is not required here, and retaining it would
work against the model:

- Its only effect is to stamp an explicit FullControl ACE for the *creating
  principal* onto each newly created object. With the DACL reduced to SYSTEM
  and Administrators, any creator is already covered by an inheritable
  FullControl ACE, so it grants nothing new.
- Retained, it would cause new files to acquire an explicit per-user ACE —
  i.e. an unintended identity appearing in descendant ACLs, which is exactly
  what verification check 5 is meant to exclude.

---

## 5. Verification result — all 47 checks passed

Full output: `post\VERIFICATION.txt`. Summary:

| # | Check | Result |
| --- | --- | --- |
| 1 | Inheritance protected on all three roots | PASS (3/3) |
| 2 | SYSTEM + Administrators FullControl, explicit, `(OI)(CI)` | PASS (6/6) |
| 3 | `BUILTIN\Users` absent on roots **and** all descendants | PASS (10/10) |
| 4 | CodexSandbox identities have no effective access | PASS (6/6) |
| 5 | Resulting ACL on roots and all descendants matches the model exactly | PASS (10/10) |
| 6 | Control paths unchanged pre → post | PASS (12/12) |

**Check 4 in detail.** Absence from the ACL is necessary but not sufficient,
so effective access was established three ways:

- `icacls … /findsid /T` for each of the three Codex identities across the
  whole of `C:\ProgramData\Verdura` → **0 matching objects** for each.
- `BUILTIN\Administrators` contains only `DESKTOP-SOKKOQ7\Administrator` and
  `DESKTOP-SOKKOQ7\Posmate`, both local **users**, so there is no nested
  group through which a Codex identity could inherit the Administrators ACE.
- `CodexSandboxOffline` (`…-1008`) and `CodexSandboxOnline` (`…-1009`) were
  each confirmed **not** members of `Administrators`. They are members of
  `CodexSandboxUsers` (`…-1007`), which is referenced by no ACE on the three
  roots.

**Check 6 in detail.** These paths were captured before and after and compared
byte-for-byte; all were unchanged:
`C:\ProgramData`, `C:\ProgramData\Verdura`, `config`, `config\secrets`
(+ descendants), `backups`, `rollback`,
`rollback\pre-migration-20260902` (**the S0 baseline — all 38 entries
unchanged**), and `README.md`.

---

## 6. Production-health verification (non-invasive, read-only)

`pre\HEALTH-pre.txt` vs `post\HEALTH-post.txt` — **no differences** outside
the capture timestamp:

- All **9** `Verdura*` services `Running`, **and every ProcessId identical
  before and after**, which is direct evidence that nothing restarted.
- `GET http://localhost:3000/api/health` → `200`,
  `{"status":"ok","db":"ok","redis":"ok"}` (correct scheme per §0 rule 5 —
  the `/api` prefix, not bare `/health`).
- All five frontend listeners (`5173`–`5177`) → `200`, identical byte counts.
- PostgreSQL listening on `5432` (pid 5524, the postmaster from §4.1),
  Redis on `6379`.

The Bridge `GET /api/health` probe was **not** run: it requires
`Authorization: Bearer <key>`, and reading the Bridge API key was outside the
scope of this change. Bridge service state was verified via SCM only.

---

## 7. Consequences worth knowing before the next stage

1. **Non-elevated access is gone by design.** `Posmate` previously reached
   these three trees through `BUILTIN\Users`. Access is now solely via
   `BUILTIN\Administrators`, so **non-elevated** tooling can no longer read or
   write `releases`, `state` or `logs`. Any script that touches them must run
   elevated. This is the intended effect of the approved model, not a defect.
2. **The `SYSTEM` grant is now explicit rather than inherited**, and is
   strictly no weaker than before (FullControl `(OI)(CI)` in both states), so
   the LocalSystem write capability proven in S1 is preserved. A fresh
   LocalSystem write test was **not** performed — it would have created files
   in the trees, which is outside "apply only this ACL change".
3. **The Verdura runtime root, `backups` and `rollback` still grant
   `BUILTIN\Users` write** by inheritance from `C:\ProgramData`. They were not
   in the approved scope and were deliberately left untouched. If production
   use is later extended to `backups`, it needs its own §0 rule 7 decision.

---

## 8. File index

| File | Contents |
| --- | --- |
| `pre\SUMMARY.tsv`, `post\SUMMARY.tsv` | one line per path: protection, owner, full SDDL |
| `pre\*.acl.json`, `post\*.acl.json` | full descriptor: SDDL, owner, group, protection flags, every ACE decoded |
| `pre\*.save.acl` | **restorable** `icacls /save /T` captures — the rollback artifacts |
| `pre\*.icacls.txt`, `post\*.icacls.txt` | textual `icacls` output |
| `pre\*.descendants.tsv`, `post\*.descendants.tsv` | per-descendant protection, owner and SDDL |
| `pre\HEALTH-pre.txt`, `post\HEALTH-post.txt` | non-invasive production-health captures |
| `post\VERIFICATION.txt` | the full 47-check verification run |
| `MANIFEST-sha256.txt` | SHA-256 of every evidence file |

Numeric prefixes: `00` `C:\ProgramData` · `01` Verdura root · `02` releases ·
`03` state · `04` logs · `05` config · `06` config\secrets · `07` backups ·
`08` rollback · `09` rollback\pre-migration-20260902 (S0) · `10` README.md.

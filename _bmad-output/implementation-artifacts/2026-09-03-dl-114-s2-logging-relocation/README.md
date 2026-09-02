# DL-114 S2 — service logging relocation (2026-09-03) — **5 of 6 COMPLETE, API BLOCKED**

Executed 2026-09-03 02:29–02:38 +12:00, host `DESKTOP-SOKKOQ7`, elevated
`DESKTOP-SOKKOQ7\Posmate`, under explicit S2 approval and maintenance-window
authorization.

**Status: the five frontends are migrated and verified. `VerduraAPI` was NOT
migrated — it is blocked by a scope conflict discovered at execution time
(§4). No rollback was needed; nothing failed verification.**

---

## 1. What changed

For each of five services, **only** `AppStdout` and `AppStderr` were changed,
written as `REG_EXPAND_SZ` to preserve the original value kind:

| Service | Port | New stdout / stderr (in `C:\ProgramData\Verdura\logs\services\`) |
| --- | --- | --- |
| VerduraCustomerWebsite | 5173 | `customer-website-stdout.log` / `-stderr.log` |
| VerduraWindowDisplay | 5174 | `window-display-stdout.log` / `-stderr.log` |
| VerduraKitchenDisplay | 5175 | `kitchen-display-stdout.log` / `-stderr.log` |
| VerduraOrderTablet | 5176 | `tablet-stdout.log` / `-stderr.log` |
| VerduraAdminConsole | 5177 | `admin-stdout.log` / `-stderr.log` |

Basenames were preserved from the old paths. `AppRotateFiles` remains unset on
every service — **NSSM log rotation was not enabled**, as required.

Nothing else was touched: no PostgreSQL, Bridge, Connector, credentials,
state, binaries, ACLs, or old log files.

---

## 2. Preflight (all passed before the first restart)

- **Venue not trading.** 3 orders exist in total: `ORD-600003` and
  `ORD-600002` `preparing` (idle 33 h 36 m / 33 h 37 m), `ORD-600001`
  `cancelled`. **0** orders updated in the trailing 15 or 60 minutes, **0**
  created in 12 hours. All 3 `ConnectorCommand` rows are `succeeded` — **none
  `claimed`/`accepted`/`pending`/`dispatched`**. Local time 02:29.
- **Mapping re-derived.** All six services: wrapper `nssm.exe` → one `node.exe`
  child → expected port, port owner inside the service chain in every case. 8
  nssm wrappers on the box, all owned by a Verdura service; no orphans.
- **ACL precondition holds.** `logs` = `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`,
  `logs\services` inherits it, and was empty.
- **LocalSystem write test — genuine.** A temporary scheduled task running as
  `SYSTEM` wrote into `logs\services`; the probe recorded
  `whoami=NT AUTHORITY\SYSTEM`. Probe file and task were both removed, leaving
  the directory empty. Output: `S2-localsystem-write-test.txt`.
- **Rollback proven, not assumed.** The six S0 `.reg` exports store
  `AppStdout`/`AppStderr` as `hex(2)` (REG_EXPAND_SZ), not quoted strings. All
  12 values were decoded from the hex and compared to live: **12/12 exact
  match** (`S2-rollback-proof.csv`). Live values were independently captured to
  `S2-nssm-params-BEFORE.csv`, giving two independent rollback sources.

---

## 3. Per-service verification (each passed before moving on)

Each service was verified on all of: SCM state `Running`; wrapper holds
**exactly one** child; expected port listening and owned **within the service
chain**; **child PID changed** (proof of a real restart, not a no-op); previous
child PID gone; zero orphaned nssm wrappers; `HTTP 200` on its port; the new
log path **actually receiving output**; and the old log path **static across
two samples 6 s apart and unchanged since before the restart**.

| Service | child PID before → after | HTTP | new stdout | old files |
| --- | --- | --- | --- | --- |
| VerduraCustomerWebsite | 16828 → 17648 | 200 (521 B) | 175 B | frozen at 525 / 4508 B |
| VerduraWindowDisplay | 18384 → 22484 | 200 (1036 B) | 173 B | frozen at 519 / 4508 B |
| VerduraKitchenDisplay | 21092 → 16516 | 200 (1336 B) | 176 B | frozen at 528 / 4508 B |
| VerduraOrderTablet | 4576 → 20860 | 200 (1336 B) | 172 B | frozen at 2624 / 4508 B |
| VerduraAdminConsole | 16276 → 14996 | 200 (1336 B) | 178 B | frozen at 2534 / 4508 B |

Per-service transcripts: `S2-<service>-OK.txt`. The `-stderr.log` files are 0
bytes, which is correct — these services emit nothing on stderr at startup.

**Post-run health** (`HEALTH-after-5-frontends.txt`): all 9 Verdura services
`Running`; `/api/health` → `{"status":"ok","db":"ok","redis":"ok"}`; all five
frontends `200`; Bridge `/api/health` (Bearer) → `200` with `bridgeRunning`,
`sqlConnected`, `assembliesLoaded`, `ipsExeRunning`,
`orderProcessingPathAvailable` all true; Connector heartbeat **advanced across
two samples** (14:37:56.874 → 14:38:12.146 UTC, age < 5 s both times).

---

## 4. Why `VerduraAPI` was not migrated — scope conflict

`VerduraAPI` has **six dependent services**:

```
VerduraAPI  dependents: VerduraKitchenDisplay, VerduraWindowDisplay,
                        VerduraCustomerWebsite, VerduraOrderTablet,
                        VerduraConnector, VerduraAdminConsole
```

SCM cannot stop a service while its dependents are running. Restarting
`VerduraAPI` through SCM therefore **necessarily stops `VerduraConnector`**
along with all five frontends.

That collides with two explicit constraints of the approved S2 scope:

- "restart **only that service** through SCM"; and
- "Do not touch PostgreSQL, Bridge, **Connector**, credentials, state,
  binaries, ACLs or old log files as part of S2."

Both cannot hold simultaneously for the API step. The approved proposal
disclosed that the *frontends* depend on the API; it did **not** disclose the
Connector dependency, so that consequence was never put to the approver.

The only ways around SCM's dependency rule are prohibited or out of scope:
direct termination of the API's child process is barred by §0 rule 3 (reserved
for proven orphan recovery), and `nssm restart` routes through the same SCM
stop.

**Resolution requires a decision, not a workaround**, so execution stopped
cleanly at 5 of 6 rather than stacking an unapproved change.

**The half-migrated state is stable and safe.** The five frontends log to
`ProgramData`; the API continues logging to its original
`VerduraServerOps\api-*.log` path, which is untouched, valid and writable.
Nothing is inconsistent and nothing is at risk. It is also trivially
reversible per service.

---

## 5. Rollback (not used, but current)

Per service, restore `AppStdout`/`AppStderr` as `REG_EXPAND_SZ` from
`S2-nssm-params-BEFORE.csv` (corroborated by the S0 `.reg` exports) and
`Restart-Service` that service through SCM. The frontends have **no**
dependents, so each rolls back in isolation with no effect on any other
service. The automated rollback path is built into the execution script and
fires on any failed check; it was never triggered.

---

## 6. Correction to a runbook claim (§0 rule 6)

§S-PG.7 records "three orders parked at `submitted_awaiting_confirmation`" as
a pre-existing condition. **Observed on 2026-09-03: the three orders are 2 ×
`preparing` and 1 × `cancelled`** — the count matches, the statuses do not.
Recorded here as the machine-verified state; the runbook's status claim should
not be cited as-is.

---

## 7. File index

| File | Contents |
| --- | --- |
| `S2-nssm-params-BEFORE.csv` | live AppStdout/AppStderr + value kind, all six services (rollback source) |
| `S2-rollback-proof.csv` | S0 hex(2)-decoded vs live, 12/12 match |
| `S2-localsystem-write-test.txt` | output of the genuine SYSTEM write probe |
| `S2-oldlogs-BEFORE.csv` | old log sizes/timestamps baseline |
| `S2-<service>-OK.txt` | full per-service execution + verification transcript (×5) |
| `HEALTH-after-5-frontends.txt` | post-run health capture |

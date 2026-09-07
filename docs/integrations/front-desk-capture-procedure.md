# Front-desk physical session — passive capture procedure

**Status:** Track A prepared 2026-09-07, not yet executed. Track B prepared
2026-09-06, not yet executed. Nothing in this procedure sends input to
IdealPOS, and nothing in it transmits a byte to any IdealPOS port.

**Machine:** Front / Machine 2, `DESKTOP-70DQTGJ`, 192.168.1.199 — the till that
holds the Ideal Handheld entitlement. Back / Machine 1 (`DESKTOP-SOKKOQ7`) has
been read to exhaustion and has nothing further to give.

**Why this exists.** Every remaining native-driver decision is blocked on
evidence we do not have, and the evidence must be gathered in a specific order:
each stage's output is the input that makes the next stage safe. Running them
out of order — in particular, writing selectors before ownership is known —
would produce plausible values with nothing behind them, which is exactly the
failure mode the earlier `IPS.exe`/`replica` over-claims came from.

**The one rule for the whole session.** Read only. No click, no keystroke, no
`SetForegroundWindow`, no posted message, no `BM_CLICK`, no coordinate probing.
No TCP connection to any IdealPOS port — including "just to see if it answers".
The operator drives IdealPOS by hand; the tool only looks. If a stage's output
is empty or surprising, the answer is to record that and stop — never to widen
the search until something matches.

---

## The two tracks, and which one to run first

| | Track A — WaiterPad / network evidence | Track B — native UI ownership |
| --- | --- | --- |
| Answers | `WAITERPAD-BIND-001`, `-CHECKSUM-001`, `-REGO-001`, `-RECON-001` | which executable owns the native Table Map, and the selector tree |
| Needs | nothing on screen; the till running as it normally does | the real Table Map visible, an idle-ish moment, and the operator navigating by hand |
| Duration | one command, under a minute | several stages, operator-driven |
| Risk of disturbing service | none — it reads sockets, files and the registry | none, but it needs the operator's attention on the terminal |

**Run Track A first, and run it even if there is no time for anything else.**
It is one command, it needs no cooperation from the POS, and it is where every
open WaiterPad blocker lives. Track B can be done on any later visit; Track A's
`Ideal Handheld*.log` is the only artefact that cannot be reconstructed later if
the till rotates or truncates it.

---

# TRACK A — the one-command WaiterPad capture

## A0 — before running

- [ ] You are physically at **`DESKTOP-70DQTGJ`**, logged in as **the Windows
      user that runs IdealPOS**. This matters: the handheld log watermark lives
      in `HKCU`, so running as a different user reads someone else's registry
      and reports nothing.
- [ ] It is the **interactive desktop session**, not RDP-redirected and not a
      service context. The script records its own session id so a mistake here
      is visible afterwards rather than silently invalidating the capture.
- [ ] The till is running as it normally does. **Do not restart IdealPOS to
      "get a clean capture".** A restart destroys exactly the state we want:
      the in-process device-registration array and the current listener set.
- [ ] You have somewhere to copy the output folder to.

## A1 — run it

```
powershell -ExecutionPolicy Bypass -File .\front-passive-capture.ps1
```

The script is `scratchpad/front-passive-capture.ps1` in this repository. Copy it
to Front on a USB stick or via the same route you use for any other file. It
takes no required arguments; output lands in
`C:\verdura-capture\front-capture-DESKTOP-70DQTGJ-<timestamp>\`.

Useful switches: `-OutputRoot <path>`, `-MaxLogCopyMB <n>` (default 200),
`-SkipDatabaseCopy`.

**Keep the output path short.** A deeply nested output root can push copied log
filenames past Windows' 260-character limit; the script now uses short numbered
subdirectories to avoid it, but a short root removes the risk entirely. This is
not hypothetical — the first Back rehearsal of this script silently lost 135 of
147 log files to exactly that, which is why the copy report now lists skipped
files explicitly.

## A2 — what it collects, and why each piece is there

| Output | Answers |
| --- | --- |
| `01-identity.txt` | hostname, local and UTC timestamp, IPv4, Windows user, **session id**, OS, and whether this is the expected machine |
| `02-tcp-listeners.txt` / `.csv` | **the complete TCP listener table**, unfiltered, joined to owning PID → process → session → path → file version → **command line**; plus raw `netstat -ano` as a cross-check |
| `03-tcp-established.txt` | current connections — does Front hold one to Back's POSServer on 11000? |
| `04-idealpos-processes.txt` | every IdealPOS process with PID, path, SHA-256, version, start time, command line |
| `05-install-inventory.txt` | versions and hashes of `IPS.exe`, `IPSWorker.exe`, `IPSPrinterServer.exe`, `IPSDeploy.EXE`, `IPSClient.exe`, `VariPad.dll`, `MTIPADLIB.dll`, and **an explicit `IPS.exe` vs `IPSWorker.exe` identical-hash check** |
| `06-configuration.txt` | the IdealPOS registry trees, including **`CurrentHandheldLogDate`** — the handheld log rotation watermark — plus the list of handheld config keys to look for in the copied `ips.mdb` |
| `07-log-inventory.txt` | a full listing of every log directory, with an explicit **"is there an `Ideal Handheld*` file at all"** answer per directory |
| `09-logs/` | **copies** of `Ideal Handheld*`, `IPS*`, `POSWorker*`, `POSActivity*`, `Printing*`, `PrintJobs*`, `Webit*`, `POSServerClient*`, `IPSError*`, `IPSObjects*`, `IPSData*` — handheld first, so a size budget can never be the reason it was missed |
| `08-log-copy-report.txt` | what was copied and **what was skipped, with the reason** |
| `10-config/` | `*.config`, `*.ini`, `IdealHandheld*.xml`, and `ips.mdb` / `zz.sqlite` |
| `11-token-sweep.txt` | every WaiterPad / handheld / order / relay / pricing token, **with six lines of context either side** |
| `11-token-summary.txt` | one line per token with a match count — read this first |
| `12-licence-lines.txt` | Front's own `License Enabled` / `Options=` / `HandheldNumber` lines, plus any `Waiters=` / `WP Current Count` |
| `90-observations.txt` | what each of the above does and does not mean, per blocker |
| `99-manifest.txt` | SHA-256 of every collected file, the script's own hash, and a **passivity self-check** that greps the script for transmission and mutation primitives |

## A3 — the passivity guarantees

The script contains no `TcpClient`, `Test-NetConnection`, `Invoke-WebRequest`,
`Invoke-RestMethod`, `Start-Service`, `Stop-Service`, `Restart-Service`,
`Stop-Process`, `Set-ItemProperty`, `New-ItemProperty` or `Remove-Item`, and
**asserts that about its own text** before it tells you the capture succeeded.
If `99-manifest.txt` says the self-check FAILED, the capture is untrusted and
must not be filed as passive evidence.

It writes only inside its own output directory. It reads IdealPOS files and
never writes one. The `ips.mdb` copy is taken from a running system and may be
internally torn — that is stated in `10-config-copy-report.txt` and the copy is
taken anyway, because the handheld config-key values and the presence of the
`WaiterPads` table survive a torn read.

## A4 — read the output in this order, and read it before concluding

1. **`02-tcp-listeners.txt`.** The whole table, before any expectation.

   > **Do not go looking for 6983.** TCP 6983 is `PROVEN STATIC` from the
   > binary and has never been observed bound anywhere. The question is *which
   > ports are open and who owns them*, not *is the one we expected open*. If
   > the handheld listener is on some other port, only an unfiltered table will
   > show it.
   >
   > **And do not read 12183 as WaiterPad.** It is `IPS.exe`'s `wsPrinterError`
   > channel, whose bind failure doubles as the single-instance guard. Front's
   > `IPS.exe` will bind the same 12183 Back's did. See
   > `idealpos-back-static-investigation-2026-09-07.md` §3–§4.
   >
   > **And attribute by PID, not by binary.** `IPS.exe` and `IPSWorker.exe` are
   > byte-identical, so both contain the code for 6983, 7983 and 12183. Which
   > port a process binds is a runtime fact about that PID.

2. **`07-log-inventory.txt`.** Does an `Ideal Handheld*` file exist? If not,
   that is a finding, and `06-configuration.txt`'s `HandheldLog` key and
   `CurrentHandheldLogDate` say whether the category was ever enabled.

3. **`06-configuration.txt`.** `CurrentHandheldLogDate` is the cheap tell. On
   Back it reads `06/06/2019`, alongside FuelConsole and Smartlink — the shape
   of a category never written. A recent date on Front means the handheld path
   has run here.

4. **`11-token-summary.txt`.** Non-zero counts for `Checksum`,
   `WP Current Count`, `Waiters=`, `BAD REGO`, `WPOrder Processing STARTED` or
   `ProcessHandheldOrder` are the ones that move blockers.

5. **`90-observations.txt`.** What each of the above does and does not license.

## A5 — what a good result looks like, per blocker

| Blocker | Closed by | Where to look |
| --- | --- | --- |
| `WAITERPAD-BIND-001` | a listening port owned by an IdealPOS PID that is not 7983 / 11183 / 12183 / 13184 / 11000 / 5501 / 5502 / 808 | `02-tcp-listeners.txt` |
| `WAITERPAD-CHECKSUM-001` | a `Checksum=` line with a real value **and the packet it belonged to** | `11-token-sweep.txt`, then `09-logs/` |
| `WAITERPAD-REGO-001` | `WP Current Count=` / ` - Waiters=` / `Adding … to current devices.` / `BAD REGO` — the whole registration protocol as the till logs it, **plus the licensed slot count** | `11-token-sweep.txt`, `12-licence-lines.txt` |
| `WAITERPAD-RECON-001` | a real order logging either `WPOrder Processing STARTED` (socket path) or `ProcessHandheldOrder` (relay path) | `11-token-sweep.txt` |
| `WAITERPAD-ACKLOSS-001` | nothing on Front closes it. It is proven and is a design constraint. | — |
| `WAITERPAD-SUPPORT-001` | nothing on Front closes it. Vendor question. | — |

**A zero everywhere is a result.** It means Front's handheld feature is licensed
but unexercised, and it is written down so no future session has to rediscover
it.

## A6 — turning a real packet into a fixture

If the sweep yields genuine bytes, they belong in
`apps/api/src/pos-sync/waiterpad/fixtures/captured/` as a JSON file whose
`origin` names the machine, the source file, the observation time and the
method. The format and the rules are in that directory's `README.md`. The
loader **refuses** a capture that does not name its machine — deliberately,
because filing a Back-scoped observation as a venue fact is a mistake this
project has already made twice.

Adding a captured fixture changes no production behaviour. It changes what the
test suite can honestly assert.

## A7 — the standing prohibition, restated because Track A makes it tempting

Even with a listener observed and a checksum in hand, **nothing may be
transmitted**. Not an `ORDER`. Not a `REQUESTTABLESTATUS`, which is read-only in
the POS but is still WaiterPad transmission. Not a bare TCP connect to see if
the port answers.

There is a further, specific reason beyond the standing rule, and it is new as
of 2026-09-07: **device registration consumes a licensed handheld slot.** An
unknown `DeviceID` is auto-registered into an in-process array if — and only if
— the count of registered devices is below the licensed handheld count. Front's
licence reads `Ideal Handheld 2`. If a Verdura device registered first, a real
waiter's handheld could be refused with `NAKREGO` in the middle of service.
Connecting is not a read-only act.

---

# TRACK B — native UI ownership and selectors

Everything below is the 2026-09-06 procedure, unchanged. It answers a different
question (which executable owns the native Table Map, and what its control tree
looks like) and is not a prerequisite for Track A.

---

## Stage 0 — before anything runs

- [ ] Session is the **interactive Session 1 desktop** of the **Front desk**
      machine. Not the Back computer, not an RDP/console-redirected session, not
      a service context. A Session-0 run returns an empty snapshot by design and
      proves nothing.
- [ ] The real native IdealPOS **Table Map is visible on screen**, as it is
      during service.
- [ ] Nothing else is being done to that terminal for the duration of a capture.
- [ ] Output directory exists and is writable, e.g. `C:\verdura-capture\`.

Record for the session log: machine name, Windows user, date/time, IdealPOS
build as shown in its own UI.

---

## Stage 1 — passive native Table Map **owner** capture

**Question:** which executable actually owns the visible native Table Map?

```
set TRACER_MODE=capture
set TRACER_CAPTURE_OUT=C:\verdura-capture\01-tablemap-owner.json
dotnet VerduraIdealposTracer.Cli.dll
```

Run it **while the Table Map is on screen**.

**What to read out of the JSON:** the `desktopWindowInventory` array and the
`diagnostics` line beginning `Native terminal binding evidence:`.

The inventory enumerates *every* visible top-level window on the desktop — not
only processes already named `IPS`/`IPSClient` — and records, per window:
`handle` → `processId` → `executablePath` → `sessionId` → `className` / `title`.
That is the full binding chain, and it is why this stage can report *"something
else owns it"* rather than only *"nothing found"*.

**Decision gate:**

| Verdict in diagnostics | Meaning | Next step |
| --- | --- | --- |
| `CONSISTENT` | the expected executable owns visible VB6 windows | proceed to Stage 2 |
| `CONTRADICTION` | a different executable owns them | **stop.** Record the owners. Do **not** force the implementation back to `IPS.exe`. Re-decide the binding from this evidence first. |
| `NO EVIDENCE` | no visible VB6-class top-level window | **stop.** Check Stage 0 (wrong session/machine, Table Map not actually visible). Do not widen the class filter to make something match. |
| `INCONCLUSIVE` | windows seen, executable path unreadable | **stop.** Note the permission/bitness problem; that is the finding. |

Also record whether `sessionId` is uniform. Candidates spanning more than one
session is flagged in the verdict and means automation would never see the
window it is aiming at.

---

## Stage 2 — passive child/control capture, once ownership is known

Only after Stage 1 named an owner. Repeat the capture **once per screen**, with
the operator navigating by hand between runs and the tool run only when the
screen is already settled:

| Screen | Reach it by hand | Output file |
| --- | --- | --- |
| Table Map (`frmTables`) | as left by Stage 1 | `02-tablemap.json` |
| Sale entry (`frmSale`, "POS Screen") | operator opens a sale screen | `03-saleentry.json` |
| Table Details (`frmTableDetails`) | Table Map → Table 5 → Details | `04-tabledetails.json` |

Use a **free table** for any navigation, or a table the venue is content to have
touched by a human in the normal way. The tool changes nothing; the operator's
own navigation is ordinary POS use.

**What matters in each file:** `root`, `win32Controls`, `clientNodeCount`,
`mechanism`, `truncated`. A capture with `clientNodeCount: 0` bound a window
that renders nothing — record it and move on; do not retry with a different
mechanism hoping for a better answer.

---

## Stage 3 — no input, no action

Explicitly, for the whole session:

- no mouse or keyboard synthesis of any kind;
- no `SetForegroundWindow`, `SendInput`, `WM_COMMAND`, `BM_CLICK`, `WM_SETTEXT`;
- no writes to POSServer or any IdealPOS database;
- no configuration change, no service restart;
- no Verdura round sent to this terminal.

The mutating Win32 layer was deliberately deleted from the codebase and stays
deleted until Stage 6.

---

## Stage 4 — derive the executable / session / window bindings

Offline, from the Stage 1–2 files. Produce, in writing:

- the **executable path** that owns the native terminal UI (not the process
  name — a process name is not identity);
- the **session id** it runs in;
- the **window class and title pattern** for each of the three screens, with the
  discriminator that separates the sale screen from the back-office MDI frame;
- whether one process owns all three screens or several do.

Then, and only then, update `WindowsAutomationSettings.ExpectedExecutableFileName`
if Stage 1 contradicted `IPS.exe`.

**Also confirm here:** `PendingSaleLines.PendingSaleID`. It is the one column the
readback uses that was *not* directly observed in the sealed Table 5 capture —
it comes from `IPS.Data.SQL.dll`'s DDL via the Bridge. A read-only
`SELECT TOP 1 *` against `POSServer.dbo.PendingSaleLines` is enough to confirm
the column name.

---

## Stage 5 — derive selectors

Populate `TerminalUiSelectors` from the Stage 2 trees only. Every field must
trace to a captured node:

- sale-screen / Table Map / Table Details window criteria;
- PLU entry field, quantity field, staged-lines control;
- Table Map command, table-cell template and cell control;
- destructive controls to be avoided;
- modal dialog class pattern.

`TerminalSelectorReadiness.IsReadyForLiveExecution` refuses placeholders,
positional-only selectors, and a cell template without `{code}`. If a selector
cannot be traced to a captured node, leave it unset and let the gate refuse —
an invented selector is worse than a missing one.

---

## Stage 6 — only then, design the guarded executor primitive

Not before Stages 1–5 are complete and written up.

The open question the capture must answer first: **which input mechanism the
VB6 `cmd` control array actually honours.** `IPS.exe` exposes
`frmTables.cmd_MouseDown` with no `cmd_Click` handler, so a posted `BM_CLICK`
may do nothing at all — which would be indistinguishable, from our side, from a
send that worked. That is the specific unknown that makes a guessed executor
dangerous rather than merely unreliable.

Design constraints already fixed by the code:

- exactly one send boundary, and it is selecting the table on the Table Map;
- the action window must be **bounded and observable**, because
  `RoundAttributionBasis.GuardedActionWindow` is what licenses treating an exact
  native delta as confirmation. An executor that cannot report a bounded window
  leaves every round in the unattributed path;
- nothing mutating may follow the commit step;
- the driver must refuse, not guess, on any unexpected screen or modal.

---

## Session close-out

Record, per stage: what was run, the output file, the verdict, and anything that
did not match expectation. A stage that produced no evidence is a result worth
writing down — the next session should not have to rediscover that it was tried.

**Still blocked after this session, regardless of outcome:** physical Round 1 and
Round 2 acceptance on the real Table 5 with kitchen-printer confirmation, and
restart / lost-response certification against the live terminal. Native route
activation stays off until those pass.

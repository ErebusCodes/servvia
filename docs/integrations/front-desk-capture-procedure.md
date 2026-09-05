# Front-desk physical session — passive capture procedure

**Status:** prepared 2026-09-06, not yet executed. Nothing in this procedure
sends input to IdealPOS.

**Why this exists.** Every remaining native-driver decision is blocked on
evidence we do not have, and the evidence must be gathered in a specific order:
each stage's output is the input that makes the next stage safe. Running them
out of order — in particular, writing selectors before ownership is known —
would produce plausible values with nothing behind them, which is exactly the
failure mode the earlier `IPS.exe`/`replica` over-claims came from.

**The one rule for the whole session.** Read only. No click, no keystroke, no
`SetForegroundWindow`, no posted message, no `BM_CLICK`, no coordinate probing.
The operator drives IdealPOS by hand; the tool only looks. If a stage's output
is empty or surprising, the answer is to record that and stop — never to widen
the search until something matches.

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

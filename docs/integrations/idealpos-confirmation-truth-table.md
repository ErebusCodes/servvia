# IdealPOS confirmation — end-to-end truth table

**Audited:** 2026-09-04/05, by tracing the actual code, not the intended design.
**Outcome:** one violation found and closed. `synced` is now unreachable by any
code path, by policy, until a causal native identity exists.

---

## 1. The path traced

```
Order ──► POSSyncRecord ──► PosSyncDispatcherService (BullMQ claim/lease)
                        └─► IdealposOrderDispatcherService
                              └─► ConnectorCommand  idealpos.submit_order.v1
                                    └─► Venue Connector ──► IdealposBridge
                                                              └─► native IdealPOS

                        ┌─ readback ─────────────────────────────────────┐
POSSyncRecord ◄── IdealposConfirmationService.sweepConfirm()
                    └─► BridgeOrderStatusReader  (direct HTTP, or
                          ConnectorBridgeOrderStatusReader — a second
                          ConnectorCommand carrying the Bridge's own
                          GET /api/orders/{externalOrderId} body)
                            └─► decideConfirmation()   ← the only decision point
                                  └─► POSSyncRecord.status
                                        └─► GET /admin/orders/:id
                                              └─► OrderTabletPage status label
```

`decideConfirmation` in `apps/api/src/pos-sync/bridge-order-status.ts` is the
single place any `synced` transition could originate. Both readers converge on
it, so one policy governs both routes.

## 2. What the tablet shows

| `POSSyncStatus` | Tablet label (`OrderTabletPage.tsx`) | Terminal to the tablet? |
| --- | --- | --- |
| `not_synced` | Not yet sent to Idealpos | no |
| `queued_for_connector` | Submitting to Idealpos… | no |
| `submitted_awaiting_confirmation` | Sent — awaiting native confirmation | no |
| `synced` | **Idealpos confirmed** | yes |
| `failed` | Idealpos delivery failed — needs attention | yes |
| `not_applicable` / `unsupported` | (no integration / adapter unsupported) | yes |

`synced` is the only state that renders as an affirmative claim that IdealPOS
has the order. That is why its entry conditions are the subject of this audit.

## 3. The violation found

Before this change, exactly one path reached `synced`:

> Bridge `status == 'assigned_to_table'`
> **and** `tableMatchesRequest === true`
> **and** `posServerPendingSaleCode` non-empty
> **and** `posServerPendingSaleCode == requestedTable` (case/space-insensitive)

That is **POSServer table-code correlation alone** — one of the six grounds
explicitly disallowed. It is not causal:

- `Reconciliation.SelectTableSale` (Bridge) matches a POSServer row on
  `Code == requestedTable` at `Pos == 1` and nothing else. No column in
  `POSServer.PendingSales` or `PendingSaleLines` references a web order, so the
  Bridge structurally cannot tie a table sale to *this* order.
- A staff-created walk-in seated at the same table produces a byte-identical
  Bridge body. The decision was the same either way.
- Read-only measurement of the live venue on 2026-09-04 sharpened it further:
  `SelectTableSale` ignores `Map`, the column that separates a table-map sale
  (`Map 1`) from a takeaway/web ticket (`Map 0`), and observed takeaway ticket
  numbers include **32** — so ticket numbers and table numbers occupy
  overlapping ranges. A takeaway ticket numbered 1–19 satisfied every check.

The file's own header comment already said this evidence was correlation-grade
and that "nothing here sets any table assignment confirmed claim". The code
then set exactly that claim. Doc and behaviour disagreed; the doc was right.

## 4. The truth table, after the change

`R` = requested table, `O` = observed `posServerPendingSaleCode`.

| # | Read outcome | Bridge `status` | Other conditions | Result | Writes? |
| --- | --- | --- | --- | --- | --- |
| 1 | `unavailable` | — | any | **awaiting** | none |
| 2 | `malformed` | — | any | **awaiting** | none |
| 3 | `notFound` (404) | — | any | **awaiting** | none |
| 4 | `ok` | *(empty/missing)* | any | **awaiting** | none |
| 5 | `ok` | `rejected` | any | **`failed`** | guarded update |
| 6 | `ok` | `failed` | any | **`failed`** | guarded update |
| 7 | `ok` | `assigned_to_table` | `tableMatchesRequest !== true` | **awaiting** | none |
| 8 | `ok` | `assigned_to_table` | `tableMatchesRequest === true`, `O` empty | **awaiting** | none |
| 9 | `ok` | `assigned_to_table` | `tableMatchesRequest === true`, `R` empty | **awaiting** | none |
| 10 | `ok` | `assigned_to_table` | `O != R` | **awaiting** | none |
| 11 | `ok` | `assigned_to_table` | `O == R` | **awaiting**, `tableCorroborated: true` | none |
| 12 | `ok` | `received` / `validated` / `submitted_to_idealpos` / `pending_idealpos_processing` | any | **awaiting** | none |
| 13 | `ok` | `processed` | any | **awaiting** | none |
| 14 | `ok` | `anchored_in_idealpos` | any | **awaiting** | none |
| 15 | `ok` | `paid` / `closed` (Bridge-documented heuristics) | any | **awaiting** | none |
| 16 | `ok` | `uncertain` | any | **awaiting** | none |
| 17 | reader **throws** | — | any | **awaiting**, sweep continues | none |
| 18 | connector probe `expired` | — | any | **awaiting**, fresh probe raised | none |
| 19 | connector probe `failed` (bridge unreachable) | — | any | **awaiting** | none |

**Row 11 is the change.** It previously read `synced`. It now records the
corroboration for operators and telemetry, and transitions nothing.

**No row yields `synced`.** The only terminal transitions remaining are rows 5
and 6 — an explicit, attempted-and-rejected outcome. Fail-closed is not
fail-silent: a real rejection is still reported as a real failure.

### The six disallowed grounds, and where each is refused

| Ground | Refused at |
| --- | --- |
| Connector acceptance alone | never reaches `decideConfirmation`; acceptance only moves the record to `submitted_awaiting_confirmation` |
| WebOrder `processed` alone | row 13 |
| Requested table echoed back | `body.table` is Verdura's own input and is never compared; only `posServerPendingSaleCode` is read (rows 7–11) |
| POSServer table-code correlation alone | row 11 — **the violation that was fixed** |
| Absence of an error | rows 4, 12; no default-to-success branch exists |
| Timeout / retry exhaustion | rows 1, 3, 17–19; exhaustion never transitions, and `notFound` after a Bridge reinstall is explicitly not failure |

## 5. Product consequence — state this plainly

Staff will now **never** see "Idealpos confirmed" on the tablet. Every
successfully delivered order rests at "Sent — awaiting native confirmation".

That is the honest rendering of what this integration can currently prove, and
it is a deliberate regression in apparent completeness. It is preferable to the
alternative, which was telling staff an order was confirmed on IdealPOS when
the evidence was equally consistent with a stranger sitting at that table.

`synced` becomes reachable again only when a causal native identity exists —
vendor questions 3, 4, 5 and 13. It is not something this module can resolve.

## 6. Tests proving it

`src/pos-sync/idealpos-confirmation.service.spec.ts` and
`src/pos-sync/connector-bridge-order-status.reader.spec.ts` (178 tests in
`src/pos-sync`, 910 across the API unit suite, all passing):

- matching table but no causal identity → remains awaiting, `tableCorroborated: true`, **no write at all**
- an unrelated walk-in on the requested table is indistinguishable → remains awaiting
- malformed result → remains awaiting
- unavailable result → remains awaiting
- `notFound` → remains awaiting
- duplicate reconciliation calls → no double transition
- concurrent sweeps → exactly one terminal transition, the loser counted as `raced`
- terminal state cannot regress (every write guarded on `status = submitted_awaiting_confirmation`)
- **property test**: no Bridge status × no `tableMatchesRequest` value × no requested-table value reaches `synced`
- **property test**: no non-`ok` read outcome reaches `synced`
- **property test** (connector route): no sequence of connector reports reaches `synced`
- an explicit Bridge rejection is still terminal — fail-closed is not fail-silent

Nothing was deployed.

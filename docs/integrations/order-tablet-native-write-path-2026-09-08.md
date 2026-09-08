# Order Tablet — native table-attached write path (2026-09-08, Back-only session)

**Product correction that scopes this doc.** The Order Tablet must behave like
the native table flow in the reference screenshots: select an existing IdealPOS
table (e.g. Table 5) → open that table → add items (optionally per seat) →
*Send to Kitchen* → items land on **that same IdealPOS pending sale** → the
native table bill shows them. **WebOrder / Ecommerce / Doshii-Webit order
creation is NOT an acceptable Order Tablet write mechanism** and is being
removed from that path. This reopens the native WaiterPad investigation as the
production target.

Evidence labels: `RUNTIME-PROVEN` `HASH-PROVEN` `STATIC-PROVEN`
`CAPTURE-PROVEN` `INFERENCE` `UNKNOWN`. Front and Back provenance kept separate.
Raw evidence stays under ignored `.tmp-*` dirs and is never committed.

---

## P0 #2 — the three native order implementations, and which is "correct"

| Impl | Locus | Line semantics | Kitchen dispatch | Live status (Back) |
|---|---|---|---|---|
| **A. Managed `HandheldOrder` (`IHORDER`)** | `POSServer.Communication.dll` → `POSServer` PID 9000, **:11000** | **APPEND** `STATIC-PROVEN` | **None in handler** — sets `Printed=true` at insert, broadcasts `~SENDSTAT`; no IKM call in the routine | Handler **loaded** `RUNTIME-PROVEN`; :11000 live `RUNTIME-PROVEN`; an actual `IHORDER` packet **not** captured → exercised `UNKNOWN` |
| **B. Native `WPOrder`** | `IPS.exe` socket (`WPParsePacket→CheckWPOrder→buffer→WPOrder`) | **APPEND** (no DELETE) `STATIC-PROVEN` | **Integral** — `"Ready to Print!"`→`"Finished sending to IKM"`→`Printed`-after | `IPS.exe` **not listening on Back**; runs on the handheld host (Front). Live `UNKNOWN` from Back |
| **C. Native `ProcessHandheldOrder`** | `IPS.exe`, reached only via `POSServerMessages` `IH-DATA` relay | **DELETE-ALL + REBUILD** `STATIC-PROVEN` | (relay consumer) | Relay mechanism exists `STATIC-PROVEN`; used here `UNKNOWN` (not inferring absence) |

**Consequence for the product requirement (append round + KOT on the same
table):** only **B (`WPOrder`)** demonstrably does *both* the table append and
the kitchen dispatch in one routine. **A** appends to the sale but shows **no
kitchen-print trigger in the handler** (it sets `Printed=true` immediately and
only broadcasts `~SENDSTAT`), so an order sent to :11000 `IHORDER` may land on
the table **without a KOT** — `UNKNOWN`/`INFERENCE`, and a hard caveat. **C** has
the wrong (replacement) semantics for an append round.

**Therefore the correct native-equivalent path is most likely B (`WPOrder`), the
IPS handheld socket** — but proving it is *live and reachable for Verdura*
requires **Front** evidence (IPS.exe listener + a real handheld round), which is
`UNKNOWN` tonight because Front is powered off. **Do not implement against A, B,
or C merely because it exists statically.** Transport stays gated (below).

---

## P0 #1 — native transaction contract (the APPEND paths)

Field set the append handler consumes (`STATIC-PROVEN`: managed
`POSServer.Communication.decompiled.cs:9125–9210`; native per
`idealpos-waiterpad-protocol-contract-2026-09-06.md` §5, addresses cited there).

| Field | Native source | Consumed as |
|---|---|---|
| Table id | `<Table>` | `PendingSales.Code` (bare table number) |
| POS/terminal | `<POSTerminal>` | lock owner; sale pinned `Pos == 1` |
| Clerk | `<Clerk>` | `PendingSales.ClerkID` / line `ClerkID` |
| Guests/covers | `<Guests>` | `TableMapSetups.Seats`/`GuestsSaved` (9999/0 = no change) |
| Map | derived by POS (`HandheldDefaultMap`), **not a request field** | `PendingSales.Map` — Verdura cannot choose it over this protocol |
| Location | `<Location>` | `PendingSaleLines.LocationSold` (0→1) |
| Per line — StockItem | `<StockItem>` | PLU → `Col1` |
| Per line — Quantity | `<Quantity>` | `Col3` |
| Per line — Description | `<Description>` (≤50) | `Col2` |
| Per line — Price | `<Price>` (`-9999` sentinel = let POS price) | `Col4` |
| Per line — PriceLevel | `<PriceLevel>` | `Col6` |
| Per line — Seat | `<Seat>` | `SeatNumber` |
| Per line — Type | `Text`/empty → `Col0="H"`; else `Col0="SI"` | line-type discriminator |
| Per line — Tax | `<TaxString>` | `Col5` |
| Line number | **server-assigned** `Line=(short)++existingCount`; client emits `@Index=""` | — |
| Checksum | `<Checksum>` (sender-supplied) | **volatile** dedup only (below) |
| DeviceID | `<DeviceID>` | lock owner + dedup key |
| Lock/unlock | `TableMapLocks.SetLockedBy`/`ClearLocked`; `EncapsulateLockedBy` if already locked | required around the write |
| Ack sequence | `~IHORDER … ACKDATA/NAKDATA/DUPLICATE` (managed); native `ACK` when XML parked in buffer, **before DB write** | ACK ≠ durability |
| KOT trigger | **B**: integral IKM dispatch; **A**: none in handler | see P0 #2 |

**Append across rounds — `STATIC-PROVEN`:** a new round adds only its lines,
continuing `Line` from the existing count; prior lines are untouched (no delete,
no merge, no renumber). Managed proof: `int num6 = …Count; … AddNew(); Line =
(short)++num6` (`:9173–9177`). Native proof: exhaustive xref shows **no** DELETE
on the `WPOrder` path.

**Genuine-client full-state-vs-delta:** `INFERENCE`, still `UNKNOWN` until a
Front capture. Server append is `STATIC-PROVEN`; the client sending a *delta* is
strongly implied (server self-numbers; VariPad emits `@Index=""`; Back manual
Table-5 R1/R2 appended with one KOT per round) but was a native-UI test, **not a
real handheld round**. Sending *full state* into an append path would duplicate
every prior line.

---

## P0 #3 — idempotency / causality (unchanged, `STATIC-PROVEN`)

No durable per-submission token exists in IdealPOS. Dedup is
`HandheldHelper.IsDuplicate` — in-memory `string[100]` + `DateTime[100]`, **10-min
TTL** (`:861–905`; cross-confirmed on Back runtime reflection). The `Checksum`
reaches **no** DB column; native `ACK` precedes durable DB write. A repeat is
caught only within ≤10 min AND ≤100 newer submissions AND no restart —
otherwise a resend **appends a duplicate round**. `OrderedTime` is the only
per-round partitioner in the DB and is **not** returned by the readback.

---

## What was implemented tonight (test-covered, vendor-free, transport GATED)

New, dependency-free core under `apps/idealpos-bridge/Orders/NativeTable/`, plus
14 CI tests (`Tests/NativeTableRoundTests.cs`). Build + run: **69/69 pass**;
`node scripts/check-bridge-governance.mjs` passes.

- `TableRound` / `TableRoundLine` / `TableRoundIdempotencyContext` — the append
  round payload model (only new lines; no "replace" flag can be expressed).
- `TableRoundPlan.PlanAppend(existingLineCount, round)` — mirrors the native
  `Line=++count` append in pure, testable form.
- `ITableRoundWriter.SubmitTableRound(round)` + `TableRoundFactory.Create(...)` —
  the requested `SubmitTableRound(tableCode, pos, clerk, guests, items, seats,
  idempotencyContext)` contract (seats carried per line). Implementations MUST
  NOT create a WebOrder, use the Ecommerce GUID, or produce a `WB*` sale.
- `DisabledTableRoundWriter` — **the shipping default.** Performs no I/O; returns
  `TransportDisabled`. No native ingress is wired, because A/B/C is not proven.
- `NativeSubmissionDecider` (+ `NativeSubmissionState`) — the durable safety
  machine: `SendInitiated` before the one bounded submission; success →
  reconcile; timeout/lost/crash/restart → `Uncertain`; **`ShouldAutoResend`
  returns false for every state**; `JudgeAfterInterruption` always `DoNotResend`
  and flags operator verification. This is Verdura's durable compensating
  control for IdealPOS's volatile dedup.

Tests prove: append second round continues after existing lines (never
replaces); seat carried per line; duplicate `externalOrderId` refused
pre-submit; timeout → uncertain; restart → no resend; disabled transport sends
nothing. "No WebOrder dependency" is structural — the whole core compiles in the
vendor-free CI project, which cannot reference `IdealPos.Webit`.

---

## Goal 1 (remove/isolate WebOrder from the Order Tablet path) — READY DIFF, not applied

The live writer (`OrderService` → `IdealposOrderSubmitter` → `WebOrder`) is in
the **net48, vendor-DLL-coupled main project**, which **cannot be built or
test-covered in a Back-only session** (no `IdealPos.Webit.Core.dll`; see
`lib/PUT_DLLS_HERE.txt`). Per the "repo changes only when covered by tests" rule,
this rewire is delivered as a reviewed diff to apply on the Windows build host,
**not** committed blind tonight.

Smallest cut (the WebOrder-ness is entirely inside the bridge; the connector and
the `POST /api/orders` contract are already native `{externalOrderId, table,
items, notes}`):

1. `BridgeConfig`: add `OrderTablet:WriteMode` (default `native`; legacy
   `weborder` retained only for explicit opt-in).
2. `BridgeHost`: construct `ITableRoundWriter tableWriter = new
   DisabledTableRoundWriter();` and pass it to `OrderService` (keep `submitter`
   only for the legacy opt-in branch).
3. `OrderService.SubmitOrder`: when `WriteMode == native`, build a `TableRound`
   from the request (Pos/Clerk/Guests/Location from config defaults) and call
   `_tableWriter.SubmitTableRound(...)`; map `TransportDisabled` →
   `NativeSubmissionState.TransportDisabled` and return a clear "native transport
   not enabled — nothing sent" outcome. Do **not** call the WebOrder submitter or
   any `TableAssignmentStrategy` on this path.
4. `OrderLifecycleWatcher`: the WebOrder anchor/`WB*` reconciliation
   (`ObserveWebPendingOrder`, `BuildNativeWebCode`) does not apply to the native
   path; gate it behind `WriteMode == weborder`. Native reconciliation is a P0
   follow-up (requires the proven ingress + `OrderedTime`-based round matching).

Result once applied: `POST /api/orders` no longer creates a WebOrder; with the
transport disabled it honestly refuses to place a native order rather than
faking one. **Do not** wire a real ingress until A/B/C is proven.

---

## What capture is required next (Front, currently powered off)

To lift the transport gate and choose A/B/C for real:
1. **Front `Ideal Handheld*.log`** with a genuine `Checksum=` paired to its
   `DeviceID` and the order body — proves the client's delta-vs-full-state and a
   real checksum shape (closes P0 #1 client half).
2. **Front listeners** — confirm whether `IPS.exe`/`IPSWorker.exe` listens
   (ingress B) and on which port the real handheld connects (A vs B).
3. **One real handheld round on a known table** with a DB readback — confirms
   append + KOT end-to-end and whether `IHORDER`→:11000 (A) prints a KOT at all.

Until then: `FULL-STATE VS DELTA (genuine client): UNKNOWN`; `LIVE INGRESS
(A/B/C): UNKNOWN`; native transport **disabled**. Not production-ready.

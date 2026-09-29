# ADR 0001: Servvia is the operational POS

- **Status:** Accepted
- **Date:** 2026-09-28
- **Decision log entry:** [DL-115](../decisions-log.md)
- **Supersedes:** [Target Operating Model](../target-operating-model.md) §1 system responsibilities, and DL-060, DL-061, DL-064 and DL-072 in the [decisions log](../decisions-log.md). DL-062, DL-063 and DL-105 are partially superseded. See [Supersession](#supersession).

## Context

Since 2026-08-15 the repository has treated IdealPOS as the system of record for
the POS transaction, tables, tenders, in-person EFTPOS and statutory tax.
Servvia was the "system of engagement" that handed orders to IdealPOS through
the venue connector and the IdealPOS Bridge, or over the WaiterPad Order2
handheld protocol.

In practice that path has not delivered an order to IdealPOS:

- The Bridge write path is `DisabledTableRoundWriter` (`apps/idealpos-bridge/BridgeHost.cs:58`).
- The native WaiterPad route is blocked on a handheld licence seat that the vendor has not provided.

Canonical order creation meanwhile carries IdealPOS transport decisions,
POS-specific enums and a second copy of POS state. Servvia has no first-class
TableSession, Check, Payment, Settlement or KitchenTicket, because those were
assumed to live in IdealPOS.

The approved technology standard (DL-105, `architecture.md` §10) already
assigns the core transactional platform to Go. This decision changes **who
owns the POS**, not the language standard.

## Decision

1. **Servvia owns canonical restaurant transaction state.** Servvia Core is the
   operational POS for:
   - Venue, Table, TableSession, Order, OrderLine, OrderRound, KitchenTicket
   - Check, Payment, Settlement, Shift, Terminal, Device
   - Idempotency, Audit and Outbox
2. **PostgreSQL is authoritative.** No client and no edge process mutates it
   directly; every surface goes through Servvia Core contracts.
3. **External POS integration is not part of the canonical transaction model.**
   IdealPOS is legacy integration only, kept running while the Servvia-native
   path replaces each dependency. It is then retired
   ([retirement plan](../migration/idealpos-retirement.md)). No new canonical
   concept may be shaped around it.
4. **Order, TableSession, Check, Payment, Settlement and KitchenTicket are
   distinct concepts.**
   - An Order is what was requested.
   - A TableSession is the dining visit.
   - A KitchenTicket is what the kitchen must prepare.
   - A Check is the financial obligation.
   - A Payment is money tendered.
   - Settlement is whether the obligation is satisfied. It is distinct from a
     processor's merchant batch settlement.
5. **Pricing is server-authoritative.** Clients submit product, modifier,
   quantity and notes. Servvia Core computes price, tax, discount, service
   charge, rounding and total. Client totals are display estimates only.
6. **Every surface is a client of Servvia Core.**

   | Surface | Technology |
   |---|---|
   | Windows POS terminal | C#/.NET |
   | Waiter tablet, Order Tablet, Kiosk, KDS, Window Display | Kotlin/Android |
   | Admin Console, Customer Website | React/TypeScript |

   None of them owns canonical business rules.
7. **Venue Edge handles local hardware and resilience, not canonical POS
   state.** It covers printers, payment terminals, cash drawers and customer
   displays, plus the offline command queue, sync, retry and diagnostics. It
   reuses the ConnectorCommand protocol semantics (enrollment, lease, CAS,
   idempotency, report idempotency, `unknown`, expiry).
8. **Python stays outside the critical transaction path.**

## Consequences

- **Transition period.** The NestJS API remains the running implementation.
  Go Core replaces it capability by capability (strangler). Prisma stays the
  only schema-migration authority until an explicit cutover is approved.
  Two permanent owners of one capability are not allowed (DL-105 governance
  rule).
- **Legacy code quarantine.** IdealPOS delivery code is isolated behind a
  temporary boundary, `apps/api/src/legacy-external-pos/`. Canonical order
  creation may not import `pos-sync/` or `connector/` directly; a test
  enforces this.
- **Native venues.** A venue with `posAdapterType = none` is the
  Servvia-native path. IdealPOS configuration can no longer refuse its orders.
- **New work required.** Servvia must build what IdealPOS was assumed to
  provide:
  - TableSession, Check, Payment, Settlement and KitchenTicket
  - an in-person payment-terminal path through Venue Edge
  - NZ GST-compliant receipts
  - shifts and cash management
  - real KOT printing
- **Legacy data.** POS-specific schema (`POSSyncRecord`, `Order.posSyncStatus`,
  `POSAdapterType`, `posTableCode`, `posProductCode`, `PosProductIdentity`, the
  IdealPOS enums) becomes legacy. It is removed additively and in dependency
  order, after its data has been archived. Historical migrations are never
  edited.
- **Go-live plan.** The 11 October 2026 go-live plan in
  `_bmad-output/planning-artifacts/2026-08-18-october-11-recovery-plan.md`
  assumed IdealPOS authority. It needs its own decision. This ADR does not
  decide it.

## Supersession

Older documents stay in place and are marked; they are not rewritten.

| Record | Effect |
|---|---|
| Target Operating Model §1–3 (IdealPOS as POS, tender and EFTPOS system of record; Idealpos-first order invariant) | **Superseded** |
| DL-060 (Verdura engagement layer; Idealpos POS authority) | **Superseded** |
| DL-061 (Idealpos-first standard order flow) | **Superseded** |
| DL-062 (online payment provider-neutral) | **Partially superseded.** Provider neutrality stands; mapping to an Idealpos `PREPAID / ONLINE` transaction does not. |
| DL-063 (Verdura owns kitchen delivery) | **Retained.** The clause about IdealPOS not duplicating tickets applies only while the legacy integration runs. |
| DL-064 (Idealpos vendor-discovery gate) | **Superseded as a product gate.** It governs only the legacy integration while it exists. |
| DL-072 (Idealpos owns statutory tax, rounding and final payable total) | **Superseded for authority.** Servvia owns tax, rounding and the payable total. Its NZ facts stand: prices are GST-inclusive, GST is shown as `gross × 3 / 23`, and no additive 15%. |
| DL-105 (technology ownership) | **Amended.** C#/.NET is also the Windows POS terminal technology. Kotlin/Android is the target for every dedicated venue device app, and existing React device runtimes are migration sources. Everything else stands. |

## Open questions (not decided here)

- Which in-person payment terminal and acquirer replaces IdealPOS-integrated EFTPOS.
- The NZ tax invoice / receipt obligations Servvia must now meet.
- What happens to the 11 October 2026 Sila Dunedin go-live.

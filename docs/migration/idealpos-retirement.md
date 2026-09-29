# IdealPOS retirement map

Retirement is approved as the target by [ADR 0001](../adr/0001-servvia-is-the-operational-pos.md). Each step happens only after the Servvia-native path has replaced what that step removes. Production service uninstalls, data archival and schema drops each need explicit approval.

## Current state (audited 2026-09-28)

There are three routes from an order to IdealPOS. None of them currently delivers:

| Route | Code | State |
|---|---|---|
| Legacy BullMQ | `pos-sync/pos-sync-dispatcher.service.ts` → `queue/processors/pos-sync.processor.ts` | No-op classifier. Off by default (`POS_SYNC_DISPATCH_ENABLED`). Races the Webit dispatcher if turned on. |
| Webit / Bridge | `pos-sync/idealpos-order-dispatcher.service.ts` → `ConnectorCommand idealpos.submit_order.v1` → `apps/venue-connector` → `apps/idealpos-bridge` | The Bridge write is `DisabledTableRoundWriter` (`BridgeHost.cs:58`), so the route fails closed. |
| Native WaiterPad | `pos-sync/waiterpad/*`. The API opens TCP 6983 to the till. | Blocked on a handheld licence seat. |

Order creation reaches all three only through `apps/api/src/legacy-external-pos/`.

## Retirement order

1. **Servvia-native venues first.** Set `posAdapterType = none` for every venue. Order creation then writes no `POSSyncRecord`, and Servvia's own PrinterJob and KDS outbox rows are created unconditionally.
   - **Prerequisite:** real KOT printing via Venue Edge. Today `PrintKotCommandHandler.cs` is not wired into `ConnectorPollingLoop`, so KOT commands expire.
2. **Stop the IdealPOS workers** by setting their env flags off. The workers are:
   - the IdealPOS dispatcher and confirmation
   - native reconcile and recovery
   - the legacy dispatcher

   Then remove `PosSyncModule` from `app.module.ts`.
3. **Frontend.** Remove IdealPOS UI:
   - the pos-sync panel and native-round UI in `OrderTabletPage.tsx`, and `nativeRoundView.ts`
   - `PosCatalogReviewPage.tsx` and `posCatalog.store.ts`
   - the IdealPOS price comparison in `MenuManagementPage.tsx`
   - the IdealPOS wording in `PaymentsPage.tsx`
   - the POS-sync and POS-catalog routes and nav entries in `App.tsx` and `AdminLayout.tsx`
   - the `posSyncRecord` types in `shared/orders.ts`
4. **Delete the legacy boundary.** Replace its calls in `OrdersService` with the `none` behaviour, then delete `apps/api/src/legacy-external-pos/` (see its README).
5. **API code.** Delete:
   - `apps/api/src/pos-sync/**` and its specs
   - `queue/processors/pos-sync.processor.ts` and the `pos-sync` queue
   - the IdealPOS integration specs: `idealpos-order-dispatch`, `idealpos-order-submission-bridge-e2e`, `pos-sync`, `pos-sync-dispatcher`, `sync-pos-catalog`, `tables-pos-mapping`, `native-round-recovery`
   - `Table19ValidationRun` handling in `orders.service.ts`
   - the `IDEALPOS_*`, `POS_SYNC_DISPATCH_*` and `TABLE19_*` keys from the env schema (`app.module.ts`) and `.env.example`
6. **Scripts and tooling.** Delete:
   - `apps/api/prisma/scripts/*idealpos*`, `*pos*` and `*plu*`, and `correct-fabricated-pos-sync-records.ts`
   - `scripts/verify-order2-roundtrip.mjs`, `scripts/waiterpad-acceptance/` and `scripts/site-config/`
   - `scripts/check-bridge-governance.*` and `bridge-test-inventory.json`
   - the root `check:bridge-governance` script
   - `windows-deploy/ops/idealpos-table-capture*.ps1`
7. **Venue host (production; approval required).** Uninstall the `VerduraIdealposBridge` Windows service, and remove the vendor DLLs from the host.
8. **.NET projects.** Delete:
   - `apps/idealpos-bridge`, `apps/idealpos-bridge-ci` and `apps/idealpos-harness`
   - the IdealPOS-only parts of `apps/venue-connector`: `Discovery`, `Terminal`, `PosServer`, `OrderSubmission`, `Automation`

   Keep `Protocol`, `Hosting`, `Persistence` and `Printing` until `services/venue-edge` replaces them.
9. **Schema (approval required).**
   - Stop writing, then archive with `pg_dump`: `POSSyncRecord`, `NativeTableRound`, `NativeSendAttempt`, `PosProductIdentity`, `Table19ValidationRun`.
   - Then, in new migrations only, drop:
     - those tables
     - `Order.posSyncStatus`, `OrderItem.nativeRoundId`, `Venue.posAdapterType`/`posConfig`, `Table.posTableCode`, `MenuItem.posProductCode` and their unique constraints
     - the enums `POSSyncStatus`, `PosSubmissionStrategy`, `POSAdapterType`, `PosSourceSystem`, `PosSourceLifecycleStatus`, `PosCandidateConfidenceTier`, `NativeRoundState`
   - Rename `IdealposEvidenceTier`, or drop it if payment observation is replaced by Servvia Payments.
10. **Docs.** Mark `docs/integrations/*` and DL-106 to DL-114 as historical. Do not rewrite them.

## Keep and reuse

- the `apps/api/src/connector/` protocol: poll, lease, accept, report, sweep, `unknown` and cancel, plus its four CHECK constraints
- connector enrollment and identity, and `ConnectorAuthGuard`
- the outbox and CAS patterns used by `PrinterJob`, `KdsDeliveryRecord` and `POSSyncRecord`
- the uncertain-result recovery design
- the pure round model in `orders/rounds/order-round.model.ts`
- the connector's `DurableLocalLog` and `PrintKotCommandHandler`

## Operational assumptions to unwind

- IdealPOS prints the KOT at Bridge venues (`LegacyExternalPosHandoff.externalPosPrintsKitchenTicket`).
- In-person payment happens in IdealPOS/EFTPOS. Staff orders are created `confirmed` with no payment.
- The API host shares a LAN with the till (WaiterPad TCP).
- The IdealPOS route is fixed when the order is created.

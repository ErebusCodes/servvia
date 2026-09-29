# legacy-external-pos (temporary)

This module holds the IdealPOS handoff that canonical order creation used to
own directly. It is **migration scaffolding, not architecture**. Servvia is the
operational POS ([ADR 0001](../../../../docs/adr/0001-servvia-is-the-operational-pos.md)).
The target order model has no external-POS handoff.

## What it owns

| Method                              | Former location                                       | Purpose                                                                        |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `planForNewOrder`                   | `OrdersService.persistOrder` (strategy decision)      | Decides the IdealPOS route before any row exists; refuses on bad native config |
| `initialOrderPosSyncStatus`         | `persistOrder` (`Order.posSyncStatus`)                | Sets the legacy column's initial value                                         |
| `recordHandoffInTransaction`        | `persistOrder` (`POSSyncRecord` create)               | Writes the outbox row inside the order transaction                             |
| `externalPosPrintsKitchenTicket`    | `persistOrder` (KOT suppression)                      | For Bridge venues, stops Servvia from creating PrinterJobs                     |
| `stopHandoffForCancelledOrder`      | `OrdersService.attemptCancelPosDispatch`              | Best-effort dispatch stop on cancel                                            |
| `LEGACY_EXTERNAL_POS_ORDER_INCLUDE` | the `posSyncRecord: true` includes in `OrdersService` | Keeps the legacy relation in the response shape                                |

## Rules

- `orders/` may import **only** from this module for anything POS-related.
  `orders/orders.service.ts` must not import from `pos-sync/` or `connector/`.
  `legacy-external-pos-boundary.spec.ts` enforces this.
- Do not add methods, callers or adapter types. Do not rename it to something
  that sounds permanent.
- A venue with `posAdapterType = none` is the Servvia-native path. It never
  consults IdealPOS configuration.

## Removal

Delete this module as part of IdealPOS retirement (docs/migration/idealpos-retirement.md), in this order:

1. No venue has `posAdapterType ≠ none`, and the IdealPOS dispatchers are off.
2. The Order Tablet and admin console no longer read `posSyncRecord`.
3. Replace every call in `OrdersService` with the `none` behaviour. That means
   no plan, `posSyncStatus = not_applicable` (until the column is dropped), no
   handoff row, no KOT suppression and no cancel stop. Then delete this directory
   and the `LegacyExternalPosModule` import in `orders.module.ts`.

# DL-097 — Resolve IdealPOS Table Mapping Contract

Contract-clarification pass only. No hardware accessed, no order submitted, no code changed. Worktree
`/private/tmp/verdura-order-tablet-reconcile`, branch `order-tablet-idealpos-reconciled` (`04bf7cc`,
unchanged by this pass).

## 1. Contract Decision

> **`Table.posTableCode` = IdealPOS `dbo.TableMapSetups.Caption`** (the string table label
> `VerduraIdealposBridge`'s `GET /api/tables` returns as `TableDto.Table`, and the exact string
> `OrderValidator`/`OrderService` require the request's `table` field to match) — **never**
> `TableMapSetups.Code` (the internal integer identifier), and never derived from Verdura's own
> `Table.tableNumber`.

This is **not a new decision** — it was already made, correctly, in commit `76c0200`
(2026-08-22, part of the originally-rescued lineage, predating DL-094/095/096) and is already the
behaviour of every line of code that touches this field today. This pass's job was to verify that
prior conclusion against the actual Bridge source independently (not just trust the existing comment),
and it holds up completely — see §2. DL-096 (2026-08-23) restated the Bridge's own still-genuinely-open
internal question (see "What remains open" below) in a way that could be misread as "Verdura's
`posTableCode` contract is unresolved" — it is not, and never has been since 76c0200. This entry exists
to make that distinction unambiguous going forward.

## 2. Evidence

### Verdura source (this repository)

- `apps/api/prisma/schema.prisma:250-269` — `Table.posTableCode String?`, doc comment (commit
  `76c0200`, 2026-08-22) already states Caption, already cites the exact Bridge files below, and
  already warns never to derive it from `tableNumber`.
- `apps/api/src/pos-sync/idealpos-order-payload-mapper.ts:70-71,98-102` — `IdealposMappingInput.tableCode`
  is documented as "`Table.posTableCode` for this order's resolved table," and `mapOrderToIdealposPayload`
  throws `unmapped_table` (fails closed) when it is null — no transformation, no fallback, no derivation.
- `apps/api/src/pos-sync/idealpos-order-dispatcher.service.ts:283` —
  `tableCode: order.table?.posTableCode ?? null` — direct passthrough from the `Table` row into the
  mapper input. No other code path sets or reads this field's semantic meaning.
- `apps/api/src/tables/dto/create-table.dto.ts:37-40` / `update-table.dto.ts:25-29` —
  `posTableCode` is `@IsString() @MaxLength(200)`, an arbitrary free-form string — consistent with a
  vendor label (Caption), not constrained as numeric (which a `Code` mapping would need to be).
- `apps/api/test/tables-pos-mapping.integration-spec.ts:58,72` — the real-Postgres integration test's
  own test value is literally named `PHASE2_CAPTION_${Date.now()}`, and its own comment states
  "reusing the same real Idealpos table **Caption** would silently misroute an order at the bridge."
  This test already encoded the Caption semantic before this pass existed.
- `apps/api/src/pos-sync/idealpos-order-payload-mapper.spec.ts:65` — `'rejects with unmapped_table when
  the table has no posTableCode — never guesses from tableNumber'` — the fail-closed, no-derivation
  invariant is already a named, tested behaviour.
- No BMAD artifact prior to this one stated a different semantics for this field; DL-096's report
  raised the question again without a prior artifact having asserted "Code" — the ambiguity DL-096
  flagged was real as a *documentation gap* (no top-level decisions-log entry existed), not a *code*
  ambiguity.

### Bridge source (`/Users/sarwarkhan/Documents/IdealposBridge`, read-only, unmodified)

- `Idealpos/IdealposReadRepository.cs:84-116` — `GetTables()` runs
  `select Code, Type, [Index], Caption, Seats, Status, Amount, GuestsSaved from dbo.TableMapSetups`
  and maps `TableDto.Table = reader.GetString(3).Trim()` — column index 3 is `Caption`. `Code` (column
  0, `int`) is also present on the DTO but under its own separate `Code` property, never used as
  `Table`.
- `Orders/OrderService.cs:61-62` — `validTableNames = new HashSet<string>(tables.Select(t => t.Table), ...)`
  — the validation set is built from `TableDto.Table` (Caption), not `TableDto.Code`.
- `Orders/OrderValidator.cs:47-53` — rejects the request unless
  `validTables.Contains(request.Table.Trim())` — i.e., unless the client's `table` string is a live
  Caption value.
- `Api/Endpoints.cs:69-90` (`TablesEndpoint`) — `GET /api/tables` serializes the same `TableDto` list
  `GetTables()` returns, so a client (or a human) reading that endpoint's response sees exactly the
  Caption values the validator will accept.
- `docs/table12-preflight/table-assignment-review.md` (external repo, dated 2026-08-19) — states this
  exact fact explicitly: *"The validator checks against Caption, not Code."*

### What remains open (Bridge-internal, not part of this contract)

The same document also raises a **separate, deeper, Bridge-internal** question: whether the five
`ITableAssignmentStrategy` implementations, having received the validated Caption string, correctly
cause native Idealpos's `dbo.PendingSales.Code` (an `int`, in `TableMapSetups.Code`'s own identifier
space) to match the requested table. That is a question about the Bridge's own internal translation
from Caption to native state — it does not change, and cannot change, what value Verdura's
`posTableCode` must hold to pass the Bridge's own request validation. It remains tracked exactly where
it already was: the external repository's own `table-assignment-review.md` and the Table 12 preflight
experiment (Phase A of DL-096's plan), unaffected by this pass.

## 3. Risk Assessment

- **What would break if `posTableCode` held the wrong value (e.g. `Code` or `tableNumber` instead of
  Caption):** every submission for that table would receive a Bridge `400 validation_failed` ("table
  ... does not exist in Idealpos's current table map") — immediate, deterministic, loud. It would
  **not** silently misroute an order to the wrong physical table; `OrderValidator` has no fuzzy-match
  or fallback path (confirmed by full read of `OrderValidator.cs`).
- **Is current code safe?** Yes. The mapper already fails closed on a null/unmapped `posTableCode`
  (`unmapped_table`), never derives a guess from `tableNumber`, and the Bridge's own validation is a
  second, independent backstop against a wrong value ever reaching native Idealpos.
- **Would hardware validation have produced misleading results if this had been wrong?** No — it would
  have produced an immediate, obvious `400` on the very first submission attempt, not a false-positive
  "success" discovered later. The risk this pass closes is *wasted hardware-access time re-deriving an
  already-correct answer*, not *a latent correctness bug that would have passed testing undetected*.

## 4. Required Changes

**No code change required. No schema change required.** The existing implementation, DTO validation,
and test suite already match the confirmed contract exactly.

**Documentation only:** a formal, top-level decisions-log entry did not exist before this pass — only a
schema-file code comment. Added below (§5) so this cannot be reinterpreted differently in a future
session that doesn't happen to read `schema.prisma`'s comment first.

## 5. BMAD Update

- This artifact (`dl-097-table-posTableCode-contract.md`).
- `docs/decisions-log.md` — new `DL-097` entry (below), the first top-level decisions-log record of
  this contract; cross-references the pre-existing `76c0200` schema comment and DL-096.
- `sprint-status.yaml` — no status transition; a one-line cross-reference added to the existing 15-5
  entry pointing at DL-097, consistent with that line's existing running-log style.

## 6. Production Readiness Impact

**PLU/Table Mapping: unchanged tier (PROVEN, software/source-review evidence only)** — refined
annotation: the Verdura→Bridge contract for `Table.posTableCode` is now confirmed by direct,
independent source review on both sides (not merely internal consistency), closing the documentation
gap DL-096 flagged. This is still software/static evidence, not hardware evidence — it does not, and
cannot, promote Native IdealPOS Consumption or Native KOT Printing, both correctly left
**NOT YET VERIFIED**, unchanged.

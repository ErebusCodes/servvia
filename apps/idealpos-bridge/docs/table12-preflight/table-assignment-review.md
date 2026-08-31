# Table 12 assignment strategy review

Independent review of `TableAssignment/ITableAssignmentStrategy.cs` and
`TableAssignment/Strategies.cs`, prepared 2026-08-19 as part of the
pre-Windows preflight. No code changes were made here — every open question
below requires live Idealpos evidence, which this environment does not
have.

## How the requested code enters the bridge

1. Verdura's `POST /api/orders` request carries `"table": "<string>"`
   (`Orders/OrderModels.cs`'s `OrderRequest.Table`).
2. `OrderValidator.Validate()` rejects the request (400) unless that exact
   string matches a `TableDto.Table` value — which is `TableMapSetups
   .Caption`, trimmed (`Idealpos/IdealposReadRepository.cs GetTables()`,
   column list confirmed: `Code, Type, Index, Caption, Seats, Status,
   Amount, GuestsSaved`). **The validator checks against Caption, not
   Code.**
3. `OrderService.SubmitOrder()` passes that same raw string into
   `ITableAssignmentStrategy.Apply(order, table, webReference)`.
4. Exactly one of five strategies (config: `Idealpos:TableAssignmentStrategy`,
   no default, bridge refuses to start unset) mutates one `WebOrder` field
   with that raw string, or leaves it as a `WebOrder.OrderReference` prefix:

   | Strategy | `WebOrder` field set | Value |
   |---|---|---|
   | `NoHint` | none | — (control/baseline) |
   | `DeliverTo` | `DeliverTo` | raw `table` string |
   | `Message` | `Message` | `"Table " + table"` |
   | `ReferencePrefix` | `OrderReference` (mutated) | `"T" + table + "-" + originalReference"` — also changes the `WebReference` used for correlation/idempotency, deterministically (verified: `Tests/TableAssignmentStrategyTests.cs` proves the same inputs always derive the same output) |
   | `HostReference` | `HostReference` | raw `table` string |

5. Native Idealpos (opaque — inside `IPS.exe`, never decompiled by this
   investigation) is expected to read one of these fields and set the
   resulting `dbo.PendingSales.Code` to match. **This is the one open
   question this whole document, and tomorrow's experiment, exists to
   answer** — none of the five has been confirmed against a live Idealpos
   instance by this bridge's own investigation or by this preflight.

## The open question this preflight surfaced, not previously documented

**`PendingSales.Code` is expected (per this repo's own investigation
comments in `Idealpos/Dto.cs`) to live in the same identifier space as
`TableMapSetups.Code` — an `int` — not `TableMapSetups.Caption` — a
`string` label.** But every strategy above writes the RAW REQUEST STRING
(validated against `Caption`) into the `WebOrder` field, not the resolved
integer `Code`.

If, for the table you intend to test, `Caption` and `Code` happen to be the
same value as a string (e.g. `Caption = "12"`, `Code = 12`), this ambiguity
is invisible — everything "just works" by coincidence, and this document's
concern is moot for that specific table. If they differ (e.g. `Caption =
"T12"` or `"Bar 3"` while `Code` is some unrelated integer, or `Caption`
includes padding/formatting Idealpos's own UI doesn't display literally),
submitting `"table": "12"` could:

- fail bridge-side validation entirely (no `TableMapSetups.Caption` equals
  the literal string `"12"`), or
- pass validation and reach Idealpos, but never produce `PendingSales.Code
  = 12`, because the field Idealpos actually keys off (if any) never saw
  the value `12` — it saw whatever `Caption` string was requested instead.

**Action before submitting anything tomorrow**: run
`evidence-queries.sql` section `0a` and read `Caption` and `Code` for the
table you intend to test. If they are not the same value as a string, this
document's open question is live — pick a table where they DO match (or a
future story owns extending the request contract to disambiguate Caption
vs. Code explicitly) for the first controlled experiment specifically, so a
mismatch here doesn't get misread as a table-assignment-strategy failure.

## Outcome-specific diagnostics for tomorrow

### If `PendingSales.Code` equals the requested table

Record the active strategy as **provisionally proven** for this Idealpos
version — but only once the native UI (Table 12 active, correct items) is
also visually confirmed. A DB-level match alone is not sufficient per this
repo's own Phase 3 rule ("`PendingSales.Code = 12` does not by itself prove
native UI visibility"). Flip `Idealpos:TableAssignmentConfirmed=true` only
after both checks pass, and only for this exact Idealpos version — this
flag is a labelling claim, not a behavioural switch (`Config/BridgeConfig.cs`
/ `Idealpos/AvailabilityChecker.cs`).

### If the order is consumed (`Processed=1`) but `PendingSales.Code`
### differs from the requested table

Per this task's own scope boundary: limit correction to
`ITableAssignmentStrategy`/its factory, not the wider bridge, unless
evidence proves otherwise. Concretely, before writing any code:

1. Re-run `evidence-queries.sql` section `5` — confirm whether the actual
   `Code` matches the table's `TableMapSetups.Code` (int) rather than
   `Caption` (string) — if so, that confirms this document's open
   question above, and the fix is either (a) resolve `Code` bridge-side
   before calling `Apply()`, still passing a string but the *correct*
   one, or (b) extend the strategy interface to receive both `Caption` and
   `Code` and let strategies choose.
2. If `Code` doesn't match either, try each of the other four strategies
   in turn (`Idealpos:TableAssignmentStrategy` is a config change, no code
   change, no rebuild) against a FRESH `externalOrderId` each time — the
   five strategies exist precisely so this is a config sweep, not a code
   change, for the first several attempts.
3. Only if all five fail should a genuinely new WebOrder field or a
   post-consumption association mechanism (if Idealpos exposes one) be
   investigated — that is new-evidence-gathering work, not a preflight
   deliverable, and should be scoped as its own follow-up once tomorrow's
   evidence exists.
4. **Do not directly patch `PendingSales.Code`** via SQL. Native Idealpos
   owns that row; this bridge's entire design principle (see
   `IdealposReadRepository`'s own doc comment: "This class never writes to
   WebPendingOrder, PendingSales, or PendingSaleLines") is that the only
   legitimate write path is `LocalDataHelper.InsertOrders()`. A direct
   UPDATE would be an unproven, unsupported operation against a vendor's
   live transactional table — treat it as out of bounds unless a future,
   separate, explicit decision proves it safe.

### If no consumption occurs at all (`Processed` never flips)

This is not a table-assignment-strategy question — diagnose per the
runbook's Outcome C before submitting a second order. Do not iterate
strategies while native consumption itself is unconfirmed; that would
conflate two independent unknowns.

## Assumptions this document could NOT verify from macOS

- Whether native Idealpos reads `DeliverTo`/`Message`/`HostReference`/
  `OrderReference` at all during `WebPendingOrder` consumption, and if so,
  which one. (Requires live Idealpos — the whole point of tomorrow.)
- Whether `PendingSales.Reference` is actually populated from
  `WebOrder.OrderReference` on this specific Idealpos version (v6.05.0001
  per the local reference install checked during this preflight — confirm
  the actual disposable Windows machine's installed version matches or is
  close, since this behaviour could differ across Idealpos releases).
- Whether `TableMapSetups.Caption` and `.Code` coincide as strings for any
  given table — venue-specific configuration, not something a preflight
  without live DB access can determine.

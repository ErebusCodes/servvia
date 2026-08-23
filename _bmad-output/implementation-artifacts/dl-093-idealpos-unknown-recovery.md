# Implementation prompt: IdealPOS stale-`unknown` recovery (DL-093)

Frozen from the user's task brief (2026-08-23). Continues from isolated worktree
`/private/tmp/verdura-15-4-worktree`, HEAD `bfef6d7`.

## Acceptance criteria (verbatim intent)

1. Generic `ConnectorCommandStatus.unknown` remains terminal/immutable — no new transition out of it.
2. `connector.self_test.v1` behavior unchanged.
3. A late report against an already-`unknown` command is durably audited (org/venue/connector-scoped) but never mutates the command; 409 unchanged.
4. `IdealposOrderDispatcherService` can auto-recover a stale `idealpos.submit_order.v1` `unknown` command after a bounded grace period.
5. Recovery creates a NEW `ConnectorCommand` row (attempt-qualified idempotency key) — the original row is never reopened/mutated.
6. Recovery preserves `externalOrderId = order.id`.
7. Recovery payload is byte-identical to the original unknown command's stored payload — never rebuilt from current `Table.posTableCode`/`MenuItem.posProductCode`.
8. Concurrent sweeps create at most one recovery attempt (CAS + idempotent `createCommand`).
9. Process restart doesn't block recovery (no in-memory state).
10. Recovery is bounded by the existing `maxDispatchAttempts`/`POSSyncRecord.attemptCount` ceiling — no new counter.
11. Exhaustion after an `unknown`-only history is truthfully distinguished (via `errorMessage`, not a new enum value) from exhaustion after a proven transient failure — never claims a fabricated native rejection.
12. Late original success racing an in-flight recovery stays duplicate-safe (Bridge's own `externalOrderId` dedup) and both attempts stay audit-visible via `sourceRecordId=order.id`.
13. No manual admin recovery/abandon endpoint in this commit.
14. No payment/GST/billing/modifier/KOT logic.
15. Main checkout untouched, nothing pushed.

## Payload-safety decision (fixed)

**Option A — reuse the original unknown command's stored `payload` column verbatim.**

Evidence: `buildIdealposOrderPayload` (idealpos-order-payload-mapper.ts) is pure/deterministic and its
full output — `{externalOrderId, table, items:[{productCode,quantity}], notes?}` — is exactly what
`createCommand` persists to `ConnectorCommand.payload` (`Prisma.InputJsonValue`, stored verbatim, no
further transform). That column is already the complete, self-contained Bridge request. Reusing it
requires no new DB lookup and makes payload drift *structurally impossible* rather than merely
detected — strictly safer and smaller than Option B's rebuild-and-compare. Order items/notes are
immutable post-creation (no update path exists in `orders.service.ts` besides status transitions), so
the only drift risk was ever in `Table.posTableCode`/`MenuItem.posProductCode`, and Option A sidesteps
it entirely by never re-reading those tables for a recovery attempt.

## Design

- **Generic layer (`connector-command.service.ts`, `report()`):** add one branch, only for
  `existing.status === ConnectorCommandStatus.unknown`, between the current `isAlreadyTerminal` branch
  and the final generic `ConflictException`. Audit action `CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN`,
  `after: { attemptedOutcome, attemptedResultType, attemptedFailureReason, reportingInstallationId,
  sameInstallationAsAccepted }` (no `resultPayload` dump — matches the existing
  `CONNECTOR_COMMAND_CONFLICTING_REPORT` precedent). Still throws `ConflictException`, still no mutation.
  Cross-venue is already structurally impossible (the `existing` lookup is pre-scoped to
  `identity.organizationId`/`identity.venueId`).

- **`IdealposOrderDispatcherService`:** new config `IDEALPOS_UNKNOWN_RECOVERY_GRACE_MS`
  (`ConfigService.get` default, `Joi.number().integer().min(60_000).optional()` in `app.module.ts`,
  matching the existing `IDEALPOS_RETRY_*` optional-with-service-default pattern). Default
  **600_000 (10 min)** = 2× `TERMINAL_REPORT_WINDOW_MS` (5 min, `connector-command.service.ts`) — long
  enough that it is clearly a *second, additional* wait after the generic protocol's own 5-minute
  reconciliation window, not overlapping it, and matches the same "10-minute safety-net scale" already
  established in this exact file's own `retryMaxDelayMs` default (line ~111) — not an invented number.

  Staleness is computed from `ConnectorCommand.updatedAt` (the sweep's own `unknown`-transition write is
  the only writer of an unknown row, so `@updatedAt` deterministically records "became unknown at" — no
  new column needed, per the brief's own instruction).

  In `sweepReconcile()`'s `processReconcileCandidate`, replace the `unknown` case inside the existing
  catch-all (currently folded into "pending / claimed / accepted / unknown" → `stillPending`) with an
  explicit branch calling a new `processUnknownCandidate()`:
  1. Not stale yet (`updatedAt + graceMs > now`) → `stillPending++`, no write.
  2. Stale, `attemptCount >= maxDispatchAttempts` → terminal `failed`, `retryExhaustedAt` set,
     `errorMessage` explicitly states the last command ended `unknown` (native outcome unproven, not a
     rejection) — CAS `updateMany({ where: { id, status: queued_for_connector, connectorSubmitCommandId:
     command.id } })`. Counted under `result.failed` (truthful — status really becomes `failed`).
  3. Stale, budget remains → mint `idealpos-submit-order:${orderId}:retry:${attemptCount}` via the
     existing `createCommand()` (idempotent P2002-safe), payload = `command.payload` verbatim,
     `sourceAggregateType:'Order'`, `sourceRecordId:orderId`, `correlationId:orderId`. Then CAS
     `pOSSyncRecord.updateMany({ where: { id, status: queued_for_connector, connectorSubmitCommandId:
     command.id }, data: { connectorSubmitCommandId: recovery.id, requestPayload: command.payload,
     attemptCount: {increment:1}, lastAttemptAt: now } })`. New result field `recovered: number` on
     `IdealposReconcileSweepResult` (additive, not a redesign).

  Concurrency: two racing ticks compute the identical idempotency key (same `attemptCount` read from the
  same candidate row) → `createCommand` dedups to one row; the CAS on `connectorSubmitCommandId: command.id`
  (the *old* id) ensures only one tick's `updateMany` actually links it — the other is a safe no-op,
  exactly mirroring `processDispatchCandidate`'s existing documented guarantee.

  `connector.self_test.v1` is untouched — this logic lives entirely inside
  `IdealposOrderDispatcherService`, which only ever reads commands reachable via
  `POSSyncRecord.connectorSubmitCommandId`, never self-test rows.

## Explicitly out of scope this commit

- Any generic `ConnectorCommandService` state-machine change beyond the one audit call in `report()`.
- Manual admin recovery/abandon endpoint.
- New Prisma migration (existing columns are sufficient).
- Reconciling `sprint-status.yaml`'s stale 15-5 status line beyond a brief decisions-log note.

## Verification

Unit (`connector-command.service.spec.ts`, `idealpos-order-dispatcher.service.spec.ts`), real-Postgres
integration (`connector-command.integration-spec.ts`, `idealpos-order-dispatch.integration-spec.ts`),
`tsc --noEmit`, `npm run build --workspace=backend` (or equivalent), lint on touched files.

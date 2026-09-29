# ConnectorCommand state machine (as built)

This document describes the durable command lifecycle between Servvia Core and a venue agent.
A Go port of the server must reproduce everything here, including the quirks listed at the end,
unless a later decision changes them on purpose. HTTP shapes are in
[`../openapi/connector-protocol.yaml`](../openapi/connector-protocol.yaml).

The only writer of `ConnectorCommand` is `ConnectorCommandService`. A search of `apps/api/src` for
`connectorCommand.update|updateMany|upsert|delete|create` and raw `"ConnectorCommand"` SQL found no other
writer outside `connector/connector-command.service.ts`, excluding spec files.
Every status change is a single-row compare-and-set: a Prisma `updateMany` whose `where` clause is the
guard. `count === 1` means this caller won the transition. `count === 0` means another caller won, or the
row was never eligible.

Source files:
- `apps/api/src/connector/connector-command.service.ts` (service, constants at lines 16-27)
- `apps/api/src/connector/connector-command-sweeper.service.ts` (timer)
- `apps/api/prisma/schema.prisma:245-254` (enum), `:1538-1633` (model)
- `apps/api/prisma/migrations/20260816150000_connector_command_protocol/migration.sql`
- `apps/api/prisma/migrations/20260816140000_connector_identity/migration.sql`

## 1. States

Source: `apps/api/prisma/schema.prisma:245-254` and the migration's `CREATE TYPE "ConnectorCommandStatus" AS ENUM ('pending', 'claimed', 'accepted', 'succeeded', 'failed', 'expired', 'unknown', 'cancelled')`.

| State | Terminal | Meaning (from schema comments) |
|---|---|---|
| `pending` | no | Created, not yet claimed by any connector. |
| `claimed` | no | Claimed by a specific active installation under a time-bound lease. Not yet accepted. |
| `accepted` | no | CONNECTOR_ACCEPTED. The connector durably persisted responsibility. This is **not** evidence of any downstream success. |
| `succeeded` | yes | Terminal success reported by the connector, with an operation-specific `resultType`. |
| `failed` | yes | Terminal failure reported by the connector. |
| `expired` | yes | The claim or redelivery budget ran out before the command reached `accepted`. Nothing was ever confirmed accepted. |
| `unknown` | yes (in this layer) | Reached `accepted`, but no terminal report arrived within the report window. Needs reconciliation and is never auto-retried. |
| `cancelled` | yes | Cancelled by an admin while still `pending` or `claimed`. |

No code path moves a row out of a terminal state. A domain owner may react to `unknown` by creating a **new**
command with a new idempotency key. For example, `IdealposOrderDispatcherService` uses
`idealpos-submit-order:${orderId}:retry:${attemptCount}`
(`apps/api/src/pos-sync/idealpos-order-dispatcher.service.ts:1061`).

## 2. Timing constants

Source: `apps/api/src/connector/connector-command.service.ts:21-27` unless noted.

| Constant | Value | Effect |
|---|---|---|
| `MAX_PAYLOAD_BYTES` | 4096 | `Buffer.byteLength(JSON.stringify(payload), 'utf8')` must be ≤ 4096 at create, or the API returns 400 "Command payload exceeds the maximum allowed size" (`:200-203`). |
| `COMMAND_TTL_MS` | 3 600 000 (1 h) | `expiresAt = createdAt + 1h`. After this, poll never offers the command. |
| `CLAIM_LEASE_MS` | 120 000 (2 min) | `leaseExpiresAt = claim time + 2 min`. |
| `TERMINAL_REPORT_WINDOW_MS` | 300 000 (5 min) | `terminalReportDeadline = acceptedAt + 5 min`. |
| `MAX_POLL_BATCH` | 5 | Maximum number of commands returned per poll. Poll over-fetches `5*3 = 15` candidates. |
| `MAX_OUTSTANDING_PER_INSTALLATION` | 20 | Maximum `claimed`+`accepted` rows one installation may hold. |
| `SWEEP_BATCH_LIMIT` | 200 | Rows selected per sweep tick, per transition kind. |
| `maxClaimAttempts` | column default 5 (`schema.prisma`, migration `DEFAULT 5`) | Claim budget per command. No code sets any other value. |
| `CONNECTOR_COMMAND_SWEEP_INTERVAL_MS` | env, default 15 000 | Sweeper tick (`connector-command-sweeper.service.ts:22`). Disabled when `NODE_ENV=test` (`:26`). |

## 3. Transitions

`now` is `new Date()` in the Node process, not the database `now()`. Several predicates call `new Date()` again
at query time instead of reusing the tick's `now`.

```
            poll (T1)                 accept (T4)              report (T5)
 pending ─────────────▶ claimed ─────────────────▶ accepted ───────────────▶ succeeded | failed
   │  ▲                  │  │ ▲                       │
   │  │                  │  │ └─ poll reclaim (T2)    └─ sweeper (T9) ──▶ unknown
   │  │                  │  └─ poll/sweeper (T3/T8) ──▶ expired
   │  └──────────────────┘ (no transition back to pending)
   ├─ sweeper (T7) ──▶ expired
   └─ admin cancel (T6, also from claimed) ──▶ cancelled
```

### T0. create → `pending`
- **Trigger:** a producer: the admin tracer endpoint, `PrinterDispatcherService`, `IdealposOrderDispatcherService`, `ConnectorBridgeOrderStatusReader`, or `ConnectorNativeEvidenceReader`.
- **Write:** `prisma.connectorCommand.create`, with `status` taking its default `pending` and `expiresAt = now + COMMAND_TTL_MS`.
- **Idempotency:** a unique violation on `(organizationId, venueId, idempotencyKey)` (Prisma `P2002`) is caught. The API reads and returns the **existing** row's status view, whatever its current status. Source: `connector-command.service.ts:186-241`.

### T1. `pending` → `claimed` (agent, poll)
### T2. `claimed` (lease expired) → `claimed` (agent, poll reclaim)
Both use the same compare-and-set. Source: `connector-command.service.ts:303-319`.
```ts
where: {
  id: candidate.id,
  expiresAt: { gt: new Date() },
  OR: [
    { status: 'pending' },
    { status: 'claimed', leaseExpiresAt: { lt: new Date() } },
  ],
}
data: {
  status: 'claimed',
  claimedByInstallationId: identity.installationId,
  claimedAt: new Date(),
  leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
  claimAttemptCount: { increment: 1 },
}
```
Checks the application runs before this write, with no database guard (`:249-301`):
- The installation's outstanding count (`claimed`+`accepted` where `claimedByInstallationId = me`) must be below 20.
- The candidate's `organizationId` and `venueId` must equal the authenticated identity's. This is in the candidate SELECT but **not** in the compare-and-set `where`.
- If `requiredCapability` is non-null, it must be a key of `ConnectorInstallation.reportedCapabilities`. Rows that fail this check are skipped silently.
- For a stale `claimed` row, `claimAttemptCount < maxClaimAttempts` is required. Otherwise T3 runs instead.
- Candidates are taken in `createdAt ASC` order.

### T3. `claimed` (lease expired, attempts exhausted) → `expired` (agent-triggered, inside poll)
Source: `connector-command.service.ts:290-298`.
```ts
where: { id: candidate.id, status: 'claimed', leaseExpiresAt: { lt: now } }
data:  { status: 'expired' }
```
The attempt check (`claimAttemptCount >= maxClaimAttempts`) is made against the candidate read. It is **not** part of the predicate.

### T4. `claimed` → `accepted` (agent)
Source: `connector-command.service.ts:360-373`.
```ts
where: {
  id: commandId,
  organizationId: identity.organizationId,
  venueId: identity.venueId,
  status: 'claimed',
  claimedByInstallationId: identity.installationId,
}
data: {
  status: 'accepted',
  acceptedAt: new Date(),
  terminalReportDeadline: new Date(Date.now() + TERMINAL_REPORT_WINDOW_MS),
}
```
- **No-op success:** if the compare-and-set misses but the row is `accepted` with `claimedByInstallationId = me`, the API returns 200 (`:387-392`).
- **Other failures:** row not in the caller's org and venue → 404. Anything else → 409.
- **Not checked:** `leaseExpiresAt` and `expiresAt`. A holder whose lease expired can still accept, provided nobody has reclaimed the row.

### T5. `accepted` → `succeeded` | `failed` (agent)
Source: `connector-command.service.ts:414-430`.
```ts
where: {
  id: commandId,
  organizationId: identity.organizationId,
  venueId: identity.venueId,
  status: 'accepted',
  claimedByInstallationId: identity.installationId,
}
data: {
  status: outcome === 'succeeded' ? 'succeeded' : 'failed',
  resultType, resultPayload,
  failureReason: outcome === 'failed' ? (failureReason ?? null) : null,
  reportedAt: new Date(),
  reportIdempotencyKey: dto.idempotencyKey,
}
```
**Not checked:** `terminalReportDeadline`. A report that arrives after the deadline but **before** the sweeper runs T9 still succeeds.

Report idempotency, applied when the compare-and-set misses (`:443-512`):

| Existing row | Condition | Result | Audit action |
|---|---|---|---|
| not in caller org/venue | – | 404 | – |
| `succeeded`/`failed`, same installation | `reportIdempotencyKey`, target status, and `resultType` all equal | 200, no-op | – |
| `succeeded`/`failed`, same installation | any of those three differ | 409 "A different terminal outcome was already recorded for this command" | `CONNECTOR_COMMAND_CONFLICTING_REPORT` |
| `unknown` (any installation) | – | 409 "Command already transitioned to unknown …", row **not** mutated | `CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN` |
| any other state, or terminal by another installation | – | 409 "Command is not currently accepted by this connector installation, or is no longer reportable" | – |

`resultPayload` and `failureReason` are **not** compared in the identical-repeat check.

### T6. `pending` | `claimed` → `cancelled` (admin)
Source: `connector-command.service.ts:523-535`.
```ts
where: { id: commandId, organizationId, venueId, status: { in: ['pending', 'claimed'] } }
data:  { status: 'cancelled', cancelledAt: new Date(), cancelledByStaffId }
```
If `count !== 1`, the API returns 404, not 409. This covers a live-lease `claimed` row too, so a later accept from the holder gets 409.

### T7. `pending` → `expired` (sweeper)
Source: `connector-command.service.ts:581-590`.
```ts
where: {
  status: 'pending',
  expiresAt: { lt: now },
  id: { in: <≤200 ids from findMany({ where: { status: 'pending', expiresAt: { lt: now } }, take: 200 })> },
}
data: { status: 'expired' }
```

### T8. `claimed` (lease expired, attempts exhausted) → `expired` (sweeper)
Source: `connector-command.service.ts:592-611`. The sweeper selects up to 200 ids of `claimed` rows with `leaseExpiresAt < now`, re-reads each row, and only if `claimAttemptCount >= maxClaimAttempts` runs:
```ts
where: { id, status: 'claimed', leaseExpiresAt: { lt: new Date() } }
data:  { status: 'expired' }
```
Rows under budget are left `claimed`. Poll (T2) is the only redelivery mechanism.

### T9. `accepted` → `unknown` (sweeper)
Source: `connector-command.service.ts:613-642`.
```ts
where: { id, status: 'accepted', terminalReportDeadline: { lt: new Date() } }
data:  { status: 'unknown' }
```
When it wins, it audits `CONNECTOR_COMMAND_MARKED_UNKNOWN`. The actor is the synthetic `connector-command-system+<orgId>@verdura.internal` staff row (`:100-117`).

### Who triggers what

| Actor | Transitions |
|---|---|
| Agent (connector credential) | T1, T2, T3 (poll), T4 (accept), T5 (report) |
| Admin (staff JWT, role `admin` or `owner`) | T0 (tracer only), T6 (cancel) |
| Server producers (dispatchers and readers) | T0 |
| Sweeper (`setInterval`, 15 s default) | T7, T8, T9 |

## 4. Database constraints (must be reproduced)

### Four CHECK constraints
Source: `apps/api/prisma/migrations/20260816150000_connector_command_protocol/migration.sql`.
```sql
ALTER TABLE "ConnectorCommand"
  ADD CONSTRAINT "ConnectorCommand_claim_fields_consistent"
  CHECK ((("claimedByInstallationId" IS NULL) = ("claimedAt" IS NULL))
     AND (("claimedAt" IS NULL) = ("leaseExpiresAt" IS NULL)));

ALTER TABLE "ConnectorCommand"
  ADD CONSTRAINT "ConnectorCommand_accepted_has_claim_owner"
  CHECK ("status" != 'accepted' OR "claimedByInstallationId" IS NOT NULL);

ALTER TABLE "ConnectorCommand"
  ADD CONSTRAINT "ConnectorCommand_terminal_report_requires_acceptance"
  CHECK ("status" NOT IN ('succeeded', 'failed') OR "acceptedAt" IS NOT NULL);

ALTER TABLE "ConnectorCommand"
  ADD CONSTRAINT "ConnectorCommand_cancelled_has_cancelledAt"
  CHECK ("status" != 'cancelled' OR "cancelledAt" IS NOT NULL);
```
The FK `ConnectorCommand_claimedByInstallationId_fkey` is `ON DELETE SET NULL`, but it would leave `claimedAt` and `leaseExpiresAt` set. Deleting an installation that holds claims would therefore violate `claim_fields_consistent`. Installations are never deleted in code; they are revoked or replaced.

### Idempotency uniqueness
Same migration:
```sql
CREATE UNIQUE INDEX "ConnectorCommand_organizationId_venueId_idempotencyKey_key"
  ON "ConnectorCommand"("organizationId", "venueId", "idempotencyKey");
```
Supporting indexes: `("venueId","status","createdAt")` and `("status","expiresAt")`.
`reportIdempotencyKey` has **no** unique index. It is compared in the application only.

### One active installation per venue
Source: `apps/api/prisma/migrations/20260816140000_connector_identity/migration.sql`.
```sql
CREATE UNIQUE INDEX "ConnectorInstallation_one_active_per_venue"
  ON "ConnectorInstallation"("venueId")
  WHERE "status" = 'active';

ALTER TABLE "ConnectorInstallation"
  ADD CONSTRAINT "ConnectorInstallation_revoked_has_revokedAt"
  CHECK ("status" != 'revoked' OR "revokedAt" IS NOT NULL);
```
Enrolment uses these indexes to rotate the installation: the previous `active` row becomes `replaced` and the new row is inserted in one transaction. A `P2002` becomes 409 (`connector.service.ts:200-289`). Also unique: `ConnectorInstallation.enrollmentId` and `replacedByInstallationId`.

## 5. Known commandType values

Found by searching `'<x>.<y>.v<n>'` literals in `apps/api/src` and `"…v1"` in `apps/venue-connector/src`. `ADR docs/adr/0001-servvia-is-the-operational-pos.md` (Decision 3) makes IdealPOS "legacy integration only … then retired". Every `idealpos.*` type below is therefore **legacy**.

Server paths are relative to `apps/api/src/`. C# paths are relative to `apps/venue-connector/src/VerduraIdealposTracer.Core/`.

| commandType | Class | Server producer (Source) | requiredCapability | Agent handler (C#) | Advertised by C# agent |
|---|---|---|---|---|---|
| `connector.self_test.v1` | generic | admin tracer, `connector/connector-command.service.ts:17-18,124-166` | same | `Discovery/DiscoveryTracerService.cs:36` | yes (`ConnectorPollingLoop.cs:59`) |
| `printer.print_kot.v1` | generic | `PrinterDispatcherService`, `printer/printer-connector-command.constants.ts:7-9`, `printer/printer-dispatcher.service.ts:326-340`; key `printer_job:${id}:attempt:${n}` | same | `Printing/PrintKotCommandHandler.cs:12` | **no**: not in `SupportedCapabilities` and not dispatched by `ConnectorPollingLoop`, so the shipped loop never claims it |
| `idealpos.submit_order.v1` | legacy IdealPOS | `pos-sync/idealpos-order-dispatch.constants.ts:16-18`, `pos-sync/idealpos-order-dispatcher.service.ts:562-573,1063-1074`; key `idealpos-submit-order:${orderId}[:retry:${n}]` | same | `OrderSubmission/IdealposOrderSubmissionService.cs:29` | yes |
| `idealpos.order_status.v1` | legacy IdealPOS | `pos-sync/idealpos-order-status.constants.ts:22-24`, `pos-sync/connector-bridge-order-status.reader.ts:276-286`; key `idealpos-order-status:${externalOrderId}:${attempt}` | same | `OrderSubmission/IdealposOrderStatusService.cs:41` | yes |
| `idealpos.native_table_round.v1` | legacy IdealPOS | `pos-sync/dine-in-route.ts:75-77`, `pos-sync/idealpos-order-dispatcher.service.ts:550-561` | same | none found | no. The schema comment says no connector advertises it, which keeps the route inert (`dine-in-route.ts:67-73`). |
| `idealpos.native_round_evidence.v1` | legacy IdealPOS | `pos-sync/waiterpad/native-round-evidence.constants.ts:23-25`, `pos-sync/waiterpad/connector-native-evidence.reader.ts:232-246`; key `native-round-evidence:${attemptId}:${probe}` | same | payload gatherer `Terminal/PosServer/NativeRoundEvidenceGatherer.cs` exists; not dispatched by `ConnectorPollingLoop` | no |
| `idealpos.payment_status.v1` | legacy IdealPOS (**capability name only**) | `payment-observation/payment-observation.constants.ts:27` defines `PAYMENT_OBSERVATION_REQUIRED_CAPABILITY`; no `createCommand` call uses it | – | none | no |

Every producer sets `requiredCapability` equal to `commandType`. Capability gating is therefore effectively "the agent advertises the command types it handles".

## 6. Observed behaviours a port must decide on (not bugs by fiat)

1. **Claimed rows stuck past the TTL.** Take a `claimed` row whose lease expired, with `claimAttemptCount < maxClaimAttempts`, and whose `expiresAt` has passed. Poll never reclaims it (`expiresAt > now` filter). The sweeper only expires claimed rows that have used up their attempts (T8). The row stays `claimed` until an admin cancels it.
2. **Sweeper can starve.** The T8 candidate query (`idsForSweep`, `take: 200`, no `orderBy`) keeps re-selecting the stuck rows from point 1. With more than 200 of them, exhausted rows can starve.
3. **Accept ignores the lease and the TTL.** Accept (T4) checks neither `leaseExpiresAt` nor `expiresAt`. Report (T5) does not check `terminalReportDeadline`.
4. **Two lease timestamps.** Poll returns a `leaseExpiresAt` computed separately from the stored one. It is a few ms later.
5. **Caller org and venue are not in the claim guard.** They appear in the candidate SELECT only, not in the T1/T2 compare-and-set.
6. **Revocation leaves claims in place.** Revoking or replacing an installation does not release its claims. They age out via lease expiry, and `accepted` rows become `unknown`.
7. **Audit is best-effort.** Audit writes run after the compare-and-set commits and are best-effort (`logAuditEventSafely`).

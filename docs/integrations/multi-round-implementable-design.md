# Multi-round table ordering — the implementable design

**Written:** 2026-09-05 (offline). Supersedes §4–§6 of
[`multi-round-ordering-model-gap.md`](./multi-round-ordering-model-gap.md),
which stays valid as the gap analysis. This document is the exact minimal
architecture, traced against the real schema and the real call sites.

**Status: designed and partially implemented in source; NOT migrated, NOT
deployed.** The vendor-independent domain core is committed as
`apps/api/src/orders/rounds/order-round.model.ts` with 49 unit tests. The
Prisma diff below is a **proposal**. No migration was generated, applied or
deployed.

---

## 1. What was traced

| Traced | Finding |
| --- | --- |
| `apps/api/prisma/schema.prisma` | `Order`, `OrderItem`, `POSSyncRecord`, `ConnectorCommand`, `Table`, `Payment`, `Venue` in full |
| Every `prisma.order*` call site | **12 sites, all non-spec**, listed in §5 |
| `apps/api/src/orders/orders.controller.ts` | 8 routes; **no route mutates the items of an existing order** |
| `apps/api/src/orders/orders.service.ts` | `validateTableForOrder` + `persistOrder`'s `FOR UPDATE` recheck |
| `apps/api/src/reporting/` | **an empty module stub** — no controller, no provider |
| Whole API for `.aggregate(` / `.groupBy(` | **zero occurrences** |
| `apps/admin-console/src/pages/order-tablet/billing.ts` | seat-split billing computed from one order's lines |

Two of those findings dominate the decision and are stated up front:

1. **"One active order per table" already exists.** `validateTableForOrder`
   (`orders.service.ts:1130`) rejects a second order on a table whose existing
   order is `pending`/`confirmed`/`preparing`/`ready`, and `persistOrder`
   re-checks it under a `FOR UPDATE` row lock inside the transaction. So
   `Order` **already behaves as one-per-open-table-session**. The concept the
   product needs is not missing; only *rounds* are missing.
2. **Verdura has no accounting layer of its own.** `ReportingModule` is an
   empty `@Module({})`. There is not one `aggregate` or `groupBy` in the API.
   Nothing in Verdura would ever reconcile several orders back into one
   session — so a wrong choice here is not "a report shows the wrong number",
   it is "the wrong number is the only number, and IdealPOS's day-end
   inherits it".

---

## 2. The decision: A, B or C

> Should the current `Order` be **A.** one per table session, **B.** one per
> round, or **C.** replaced/augmented by a new round entity?

### **C — augment. Keep exactly one `Order` per table session; add `OrderRound` as the delivery unit.**

`Order` takes on A's *semantics* (one per session, the accounting aggregate),
and C's *mechanism* (a new entity owns round identity and delivery). Neither A
nor B alone is viable, for reasons that are structural rather than aesthetic.

### Why not A alone (one Order per session, no round entity)

**It is impossible against the current schema.** Two uniqueness constraints
forbid it outright:

```prisma
model POSSyncRecord {
  orderId                  String  @unique   // one delivery record per order, forever
  connectorSubmitCommandId String? @unique   // one submit command per delivery record
}
```

One `Order` can therefore carry **exactly one** POS delivery, ever. Round 2 has
nowhere to record that it was queued, submitted, rejected or retried. Forcing
it means round 2 overwrites round 1's delivery state — destroying the only
evidence of what the kitchen already has. That is worse than not shipping.

### Why not B (one Order per round)

B is the only option the schema permits today, and it is what happens right now
if staff order twice. It is also the failure the product exists to avoid. Six
concrete consequences, each traced:

| # | Consequence | Traced to |
| --- | --- | --- |
| 1 | `Order.totalCents` becomes a per-round figure. **No row anywhere represents the party's bill.** | `Order.subtotalCents/taxCents/totalCents` are stored scalars |
| 2 | A single payment settling three rounds can attach to **one** of them. | `Order.paymentProviderTransactionId @unique`; `Payment` is keyed to `Reservation`, not `Order`, so it cannot rescue this |
| 3 | A retried round 2 collapses onto the wrong thing. | `@@unique([venueId, idempotencyKey])` identifies the *order*; `resolveIdempotentOutcome` compares order-level fields |
| 4 | The order FSM runs N times per meal; KDS shows N tickets that look like N tables' worth of demand. | `OrderStatus` pending→confirmed→preparing→ready→completed, driven per `Order` |
| 5 | A seat-split bill silently omits earlier rounds. | `billing.ts:163` reduces over **one** order's lines |
| 6 | Native IdealPOS receives N independent sales. | Already observed: `WBORD-600002`, `WBORD`, `WBORD-600003` are separate `PendingSales` rows at `Map 0` |

And the aggravating factor: **there is no reporting layer to correct any of
this later.** With a reporting layer, B would be a presentation bug. Without
one, B *is* the accounting record.

This is precisely the brief's concern — "we must not accidentally turn one
restaurant table session into several unrelated customer orders just because
several kitchen rounds were sent." B does exactly that, by construction.

### Why C works, and why it is small

- The session identity **already exists** and is already transactionally
  enforced (§1, finding 1). C does not introduce it; it names it.
- `OrderRound` absorbs everything that is genuinely per-round: identity,
  idempotency, payload freeze, lifecycle, delivery record.
- `Order` keeps everything that is genuinely per-session: table, service mode,
  totals, payment reference, status, the customer-facing order.
- Blast radius is 12 call sites (§5), and the additive steps touch none of them.

### The simplification: **no `TableSession` entity**

The earlier gap analysis proposed three entities. Two are enough.

Once `Order` is one-per-session, a separate `TableSession` row would be in
strict 1:1 correspondence with it, carrying `venueId`, `tableId`, an open/closed
lifecycle and timestamps that `Order` **already has** (`tableId`, `status`,
`submittedAt`, `completedAt`, `cancelledAt`). That is a join with no
information in it. The brief says not to invent unnecessary abstractions;
this is the one to decline.

`NativeSaleLink` is likewise collapsed into fields on `Order`, for the same
reason: it would be 1:1 with the session.

**When the third entity becomes necessary** — state it now so the decision is
revisitable rather than forgotten:

- if a session must survive its `Order` being cancelled and re-created;
- if a session must span two tables (a table move mid-meal);
- if two parties share one table with separate bills (`Order` is one-per-table
  today, so this is already unrepresentable and is a separate problem).

None of those are in scope. If any becomes so, `TableSession` is extracted then,
and `Order.tableSessionId` replaces the identity role — a mechanical change,
because every round already points at a session id.

---

## 3. Exact fields and invariants

Every invariant below is marked **[DB]** (a database constraint), **[TX]** (a
transactional check under a lock) or **[CODE]** (enforced in the domain model,
with the test that proves it). Anything not marked [DB] or [TX] is *not* safe
against a second writer, and is labelled so deliberately.

### 3.1 Durable table-session identity — `Order` (existing, unchanged)

| Requirement | Field | Enforcement |
| --- | --- | --- |
| durable session identity | `Order.id` | **[DB]** primary key |
| at most one open session per table | `Order.tableId` + `Order.status` | **[TX]** `validateTableForOrder` + `FOR UPDATE` recheck in `persistOrder`. **Not [DB].** See §3.8 |
| session-scoped idempotency | `@@unique([venueId, idempotencyKey])` | **[DB]**, existing |

**No new fields.** The session is the order.

### 3.2 tableId / requested native table code — existing, unchanged

| Field | Meaning |
| --- | --- |
| `Order.tableId` → `Table.id` | the Verdura table |
| `Order.tableNumber` | denormalised display copy |
| `Table.posTableCode` | **the requested native table code.** Nullable; `@@unique([venueId, posTableCode])` |

**Invariant [CODE]:** `posTableCode` is never derived from `tableNumber`.
Already enforced and documented at
`idealpos-confirmation.service.ts::resolveRequestedTable`, which returns `null`
rather than falling back. Do not weaken it when rounds arrive.

### 3.3–3.7 The round — `OrderRound` (new)

| # | Requirement | Field | Enforcement |
| --- | --- | --- | --- |
| 3.3 | immutable round identity | `id` | **[DB]** pk |
| 3.4 | round sequence number | `sequence Int` | **[DB]** `@@unique([orderId, sequence])`; **[CODE]** `nextRoundSequence` derives from the max ever used, never the count, so an abandoned round never causes reuse |
| 3.5 | round idempotency key | `idempotencyKey String` | **[DB]** `@@unique([venueId, idempotencyKey])`. **Minted at round OPEN, never at submit** — the fix for the restart hole |
| 3.6 | immutable submitted payload snapshot | `payloadFrozenAt DateTime?` + `submittedPayload Json?` | **[CODE]** `setRoundLines` throws unless `state = drafting` **and** `payloadFrozenAt = null`; **[DB]** see §3.8 for the constraint that makes it enforceable |
| 3.7 | round lifecycle | `state RoundState` | **[CODE]** explicit transition table |

**`RoundState`** — the exact enum, as implemented:

```
drafting
submitting
awaiting_native_confirmation
confirmed
rejected
failed
unresolved
abandoned
```

Two design points the brief asked about specifically:

- **`unresolved` is included, and it is not optional.** It is distinct from
  `submitting`: `submitting` means "the send is in progress", `unresolved`
  means "the send produced no definite outcome at all and we do not know
  whether the kitchen has it". It is the only state with **no automatic exit** —
  every edge out of it is a decided outcome a human supplied. This is the state
  that stops staff unknowingly reconstructing a round.
- **`rejected` and `failed` are separate.** A rejection is the POS refusing a
  payload a human can fix and resubmit under the same identity. A failure is
  exhausted delivery of an unchanged payload. They license different
  recoveries, so collapsing them would either forbid a legitimate repair or
  permit an illegitimate retry.

`rejected` is deliberately **not** an in-flight state: it does not block the
session, because its resolution is a transition of the *same* round back to
`drafting`, not a new round.

### 3.8 Two constraints that must be [DB], not [CODE]

The design has exactly two invariants that a service-level check cannot hold,
because two devices can race:

```sql
-- (a) At most one non-terminal round per order.
--     This is what stops device B opening round 2 while device A's round 1
--     is still unresolved. Today's localStorage marker is per-DEVICE and
--     cannot do this.
CREATE UNIQUE INDEX order_round_one_open_per_order
  ON "OrderRound" ("orderId")
  WHERE "state" IN ('drafting','submitting','awaiting_native_confirmation','unresolved');

-- (b) A frozen payload is immutable.
--     Postgres cannot express "this column may not change once non-null" as a
--     constraint, so it is a trigger, not a CHECK. Without it, immutability is
--     a convention the ORM happens to respect.
CREATE OR REPLACE FUNCTION order_round_payload_is_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD."payloadFrozenAt" IS NOT NULL
     AND (NEW."submittedPayload" IS DISTINCT FROM OLD."submittedPayload"
          OR NEW."payloadFrozenAt" IS DISTINCT FROM OLD."payloadFrozenAt") THEN
    RAISE EXCEPTION 'OrderRound % payload is frozen and may not be modified', OLD."id";
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
```

Constraint (a) also **subsumes** the existing per-device `localStorage` guard:
that guard blocks one browser, this blocks the venue.

**Note on (a) and today's session guard:** the equivalent invariant for
*sessions* (§3.1) is [TX] rather than [DB]. That asymmetry is deliberate and
should be closed separately — a partial unique index on
`Order (tableId) WHERE status IN ('pending','confirmed','preparing','ready')`
would make it [DB] too — but it is a pre-existing condition, not something this
design introduces, and changing it touches the kiosk path. Flagged, not bundled.

### 3.9 Native sale identity, once causally known — fields on `Order`

| Field | Meaning |
| --- | --- |
| `nativeSaleStore String?` | `'ipstransaction' \| 'posserver'` — which native store the identity came from |
| `nativeSaleId String?` | the native sale's own primary identity |
| `nativeSaleCode String?` | the native `Code` column value observed |
| `nativeSaleMap Int?` | the native `Map` value. **Recorded because `Reconciliation.SelectTableSale` ignores it**, and `Map` is the column that separates a table-map sale (`Map 1`) from a takeaway/web ticket (`Map 0`) |
| `nativeSaleEvidenceTier String?` | `'correlated' \| 'causal'` |
| `nativeSaleEstablishedAt DateTime?` | |

**Invariant [CODE], the load-bearing one:** only `causal` may drive a
confirmation. `correlated` is recorded and displayed, never acted on. This is
the same rule `decideConfirmation` already enforces for `POSSyncRecord` —
expressed once, not reinvented weaker. Proven by
`order-round.model.spec.ts`: *"a CORRELATED identity never confirms, however
matching"*.

Held on `Order` (the session), not on `OrderRound`, because a table session has
one native sale that several rounds append to. That is the entire point of the
requirement.

### 3.10 Native line identities / delta — `OrderRound`

| Field | Meaning |
| --- | --- |
| `nativeLineIds Json?` | native per-line identities for this round's lines, if the interface exposes them |
| `nativeLineDelta Json?` | the observed before/after line-set delta attributable to this round |

**Both nullable, and expected to stay null.** No locally identified interface
returns per-line identities (§ the ingress investigation). `nativeLineDelta` is
populated from a *capture* — the before/after diff around a submission — which
is corroboration, not causation, and must be tiered as such.

### 3.11 Native prices observed — `OrderRound`

| Field | Meaning |
| --- | --- |
| `nativePricesObserved Json?` | per-line native price actually recorded by the POS |

**Invariant [CODE]:** this field is **observation only**. Nothing computes
`Order.totalCents` from it, and nothing sends it back. `RoundLine` names its
own field `expectedUnitPriceCents` for exactly this reason: it is what Verdura
displayed and submitted *for verification*, never an instruction to charge. If
observed ≠ expected, that is a reconciliation alert for a human — never a
silent correction in either direction.

### 3.12 KOT evidence / result — `OrderRound`

| Field | Meaning |
| --- | --- |
| `kotEvidence Json?` | whatever the supported interface exposes about kitchen-ticket emission |
| `kotEvidenceTier String?` | `'queued' \| 'flag_set' \| 'emitted'` |

`kotEvidenceTier` exists because the KOT guarantee boundary is genuinely
three-valued and **must not be collapsed** (see the ingress investigation's KOT
section):

- `queued` — handed to an internal queue;
- `flag_set` — the native `Printed` flag was written;
- `emitted` — a physical kitchen ticket definitely came out.

No locally identified interface yields `emitted`. The field exists so that a
future one can be recorded *as* `emitted` rather than a `flag_set` being
silently promoted.

---

## 4. Proposed Prisma diff

**Not applied. No migration generated.**

```diff
+enum RoundState {
+  drafting
+  submitting
+  awaiting_native_confirmation
+  confirmed
+  rejected
+  failed
+  unresolved
+  abandoned
+}
+
+/// One batch of items sent, or about to be sent, as a unit to the kitchen.
+/// The session is the Order; this is the delivery unit within it.
+model OrderRound {
+  id             String     @id @default(uuid())
+  orderId        String
+  venueId        String
+  sequence       Int
+  /// Minted at round OPEN, never at submit. Durable before any send is
+  /// attempted, which is what makes a post-restart retry idempotent.
+  idempotencyKey String
+  state          RoundState @default(drafting)
+
+  /// The immutable payload snapshot. Set with payloadFrozenAt, once, on the
+  /// drafting -> submitting edge; a trigger forbids later modification.
+  submittedPayload Json?
+  payloadFrozenAt  DateTime?
+
+  /// Native observation. All nullable; all tiered; none of it may confirm
+  /// unless the tier on the parent Order is `causal`.
+  nativeLineIds        Json?
+  nativeLineDelta      Json?
+  nativePricesObserved Json?
+  kotEvidence          Json?
+  kotEvidenceTier      String?
+
+  createdAt DateTime @default(now())
+  updatedAt DateTime @updatedAt
+
+  order         Order          @relation(fields: [orderId], references: [id])
+  venue         Venue          @relation(fields: [venueId], references: [id])
+  items         OrderItem[]
+  posSyncRecord POSSyncRecord?
+
+  @@unique([orderId, sequence])
+  @@unique([venueId, idempotencyKey])
+  @@index([orderId, state])
+  @@index([state, createdAt])
+}

 model Order {
   ...
+  /// Native sale identity for THIS TABLE SESSION -- one sale, many rounds.
+  /// evidenceTier is load-bearing: only `causal` may drive a confirmation.
+  nativeSaleStore         String?
+  nativeSaleId            String?
+  nativeSaleCode          String?
+  nativeSaleMap           Int?
+  nativeSaleEvidenceTier  String?
+  nativeSaleEstablishedAt DateTime?
+
+  rounds OrderRound[]
 }

 model OrderItem {
   id                String  @id @default(uuid())
   orderId           String
+  /// Nullable is what keeps the migration additive: every existing item
+  /// stays valid with no round.
+  orderRoundId      String?
   ...
   order    Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
+  round    OrderRound? @relation(fields: [orderRoundId], references: [id])
+
+  @@index([orderRoundId])
 }

 model POSSyncRecord {
-  orderId String @unique
+  orderId      String
+  /// THE POINT OF NO RETURN. Moving delivery identity from the order to the
+  /// round is what admits more than one delivery per order.
+  orderRoundId String? @unique
   ...
+  @@index([orderId])
 }

 model Venue {
   ...
+  orderRounds OrderRound[]
 }
```

Plus the two raw-SQL objects in §3.8, which Prisma cannot express and which go
in the migration body by hand.

### Indexes and uniques, and why each exists

| Object | Why |
| --- | --- |
| `OrderRound @@unique([orderId, sequence])` | rounds are ordered and non-duplicated within a session |
| `OrderRound @@unique([venueId, idempotencyKey])` | matches `Order`'s existing venue-scoped shape; a retry presents the same key and collapses |
| `order_round_one_open_per_order` (partial unique) | **the cross-device guard.** At most one non-terminal round per session |
| `OrderRound @@index([orderId, state])` | "what is open on this table" — the tablet's hot read |
| `OrderRound @@index([state, createdAt])` | the dispatcher/confirmation sweeps |
| `OrderItem @@index([orderRoundId])` | payload build is per-round |
| `POSSyncRecord @@unique([orderRoundId])` | one delivery record per round, replacing one per order |
| `POSSyncRecord @@index([orderId])` | preserves today's lookup after `@unique` is relaxed |
| payload-freeze trigger | immutability that survives a writer that is not the ORM |

---

## 5. Every affected code path

All 12 non-spec `prisma.order*` call sites, with the step at which each is
touched:

| File | Touched at step |
| --- | --- |
| `orders/orders.service.ts` (findFirst/findMany/findUnique/update) | 6 |
| `orders/kds-dispatcher.service.ts` (findUnique) | 6 |
| `pos-sync/idealpos-order-dispatcher.service.ts` (findUnique) | 5 |
| `pos-sync/idealpos-confirmation.service.ts` (findUnique) | 5 |
| `pos-sync/connector-bridge-order-status.reader.ts` (findUnique) | 5 |
| `pos-sync/pos-sync-records.service.ts` (findFirst) | 5 |
| `printer/printer-jobs.service.ts` (findFirst) | 6 |
| `payment-observation/payment-observation.service.ts` (findFirst) | untouched |
| `queue/processors/pos-sync.processor.ts` (updateMany) | untouched |

Steps 1–4 touch **none** of them.

---

## 6. Migration sequence

**No production migration was generated or applied. This is the plan.**

| # | Step | Reversible? | Gate |
| --- | --- | --- | --- |
| 1 | Create `OrderRound` + `RoundState`; add the six `nativeSale*` columns to `Order`; add nullable `OrderItem.orderRoundId`. All additive, all nullable. | yes — drop | none |
| 2 | Add `order_round_one_open_per_order` and the payload-freeze trigger. | yes — drop | none |
| 3 | Backfill: one `OrderRound` (sequence 1) per historical dine-in `Order`, `state` derived from the existing `POSSyncStatus`; point that order's `OrderItem`s at it. Takeaway orders left unrounded. | yes — delete backfilled rows | none |
| 4 | Write rounds from the service layer; keep `POSSyncRecord.orderId @unique`. Every session still has exactly one round, so behaviour is unchanged. | yes | none |
| 5 | **Relax `POSSyncRecord.orderId @unique` → index; add `@@unique([orderRoundId])`.** | **no** | **native append mechanism confirmed supported** |
| 6 | Move the tablet from cart-per-order to round-per-session. | yes | step 5 |

**Step 5 is the point of no return.** Steps 1–4 are safe to take before any
vendor answer: they add a faithful representation of "this session had one
round", change no behaviour, and are individually reversible.

The `POSSyncStatus` → `RoundState` backfill mapping, stated exactly so the
backfill is not improvised later:

| `POSSyncStatus` | `RoundState` |
| --- | --- |
| `not_synced` | `drafting` |
| `queued_for_connector` | `submitting` |
| `submitted_awaiting_confirmation` | `awaiting_native_confirmation` |
| `synced` | `confirmed` |
| `failed` | `failed` |
| `cancelled` | `abandoned` |
| `not_applicable`, `unsupported` | `abandoned` |

Note `synced` → `confirmed` maps **zero rows**: `synced` has been unreachable
since the fail-closed change, and no production record ever reached it.

---

## 7. What is implemented tonight, and what is not

**Implemented, committed, tested, unused:**
`apps/api/src/orders/rounds/order-round.model.ts` — the vendor-independent
domain core: `RoundState`, the transition table, round identity, payload
freeze, the causal-vs-correlated confirmation rule, `linesToSend`,
`sentLines`, `reopenRejectedRound`. 49 unit tests
(`order-round.model.spec.ts`), all passing.

It imports no Prisma, defines no HTTP surface, mentions no vendor, and is
reachable from no controller. Adding it changes no behaviour.

**Deliberately not implemented:** the Prisma models, any migration, any service
wiring, any tablet change.

**Why the split is exactly here.** The rules above are true regardless of what
tomorrow's capture shows — they are statements about Verdura's own domain, and
they have a test oracle today. The *mapping from a round to a native
operation* has no test oracle until the native round transition is observed.
Committing the first and deferring the second is what stops this design
repeating the class of error that produced the withdrawn table-`Code` premise
and the correlation-grade `synced` promotion.

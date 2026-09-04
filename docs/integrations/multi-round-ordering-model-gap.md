# Multi-round table ordering — data-model gap analysis

**Audited:** 2026-09-05 (offline). Source of truth: `apps/api/prisma/schema.prisma`,
`apps/api/src/orders/orders.service.ts`, `apps/api/src/orders/orders.controller.ts`,
`apps/api/src/pos-sync/*`, `apps/admin-console/src/pages/order-tablet/OrderTabletPage.tsx`.
**Nothing was implemented.** This records the gap and the design; the migration is
deliberately deferred — see §6 for why.

---

## 1. The requirement

The product requirement is not "one Order maps to IdealPOS". It is:

```
table session → Round 1 → confirmed native delta → Round 2 → confirmed native delta → …
```

A party sits down, orders, eats, orders again, and eventually pays — once, for
everything. Verdura must be a trustworthy frontend to *one* native sale across
that whole arc.

## 2. What the model has today

### What represents a dine-in table session?

**Nothing.** There is no session entity. The nearest things are:

- `Table` — venue configuration (number, capacity, `posTableCode`, position on
  a floor plan). Long-lived furniture, not an occupancy.
- `Order.tableId` / `Order.tableNumber` — a pointer from one order to that
  furniture.
- `Reservation` — a booking, with its own lifecycle, unrelated to ordering.
- `TableActivity` (native IdealPOS, not Verdura) — the venue's own durable
  record of table occupancy, which Verdura does not read.

So "party currently seated at table 5" exists nowhere in the schema. Two orders
on table 5 an hour apart are indistinguishable from two rounds of one meal.

### Is `Order` immutable after submission?

**Effectively yes, by omission.** The controller exposes:

| Endpoint | Effect |
| --- | --- |
| `POST /admin/orders` | create |
| `GET /admin/orders`, `GET /admin/orders/:id` | read |
| `PATCH /admin/orders/:id/status` | status only |

There is **no endpoint that adds, removes or edits `OrderItem`s** on an existing
order. `OrderItem` has no version, no round, no immutability flag, and
`onDelete: Cascade` — the model was written for write-once.

Immutability is therefore a property of the *API surface*, not an invariant the
schema enforces. Nothing in the database would reject a second write.

### Can it safely receive later items?

**No.** Three separate reasons, any one of which is fatal:

1. `subtotalCents` / `taxCents` / `totalCents` are stored scalars on `Order`.
   Adding items later silently invalidates them unless recomputed atomically.
2. `POSSyncRecord.orderId` is `@unique` — **one sync record per order, forever**.
   A second round has nowhere to record its own delivery state.
3. `POSSyncRecord.connectorSubmitCommandId` is `@unique` — **one submit command
   per sync record**. A second round cannot get its own `ConnectorCommand`.

### Is `POSSyncRecord` one-per-order?

**Yes** — `orderId String @unique`. Its whole state machine (`not_synced` →
`queued_for_connector` → `submitted_awaiting_confirmation` → terminal) describes
a single delivery of a single payload.

### Is `ConnectorCommand` one submit command per order?

**Yes**, transitively. `ConnectorCommand` itself is generic and keyed
`@@unique([organizationId, venueId, idempotencyKey])`, but the submit path uses
the order's own id as the idempotency key and pins the result into the unique
`POSSyncRecord.connectorSubmitCommandId`. One order ⇒ at most one live submit
command.

### What happens if Round 2 mutates the same Order?

- It cannot be expressed through the API (no such endpoint).
- If added, `POSSyncRecord`'s uniqueness blocks a second delivery record, so
  round 2 would either overwrite round 1's delivery state — destroying the only
  evidence of what was already sent — or require a second record the schema
  forbids.
- The order's idempotency key (`@@unique([venueId, idempotencyKey])`) identifies
  the *order*, not the round. A retry of round 2 would collapse onto the order
  and be treated as a duplicate of round 1.
- Every already-`Printed` line would be resubmitted, because the payload is
  built from the order's full item list.

**Verdict: structurally impossible, and unsafe if forced.**

### What happens if Round 2 is a second Order?

This is the only thing the current model *permits* — and it is what would happen
today if staff simply ordered again.

- Two `Order` rows, two `POSSyncRecord`s, two `ConnectorCommand`s, two Bridge
  submissions, two `WBORD-*` web orders in IdealPOS.
- Native IdealPOS therefore gets **two independent sales**, not one table sale
  with two rounds. Confirmed by the live evidence: Verdura's three orders are
  `WBORD-600002`, `WBORD`, `WBORD-600003` — separate `PendingSales` rows at
  `Map 0`, never appended to anything.
- The party's bill is split across two native sales. Staff must reconcile by
  hand at payment time.
- Nothing in Verdura links the two orders as one session.

**Verdict: expressible, but it does not meet the requirement.** It produces
exactly the failure mode the product is trying to avoid.

### How does the tablet distinguish the four item states?

| State | Represented as | Durable? |
| --- | --- | --- |
| unsent cart items | `useState<TabletCartItem[]>([])` | **no — in-memory only** |
| unresolved submitted round | `localStorage` pending-submission marker (context + timestamp) | yes |
| confirmed prior-round items | *not represented at all* | — |
| newly-added Round 2 items | *not represented at all* | — |

Only the first two exist. The tablet has no concept of "these lines are already
with the kitchen and these are not" — because it has never needed one: a
submission ends the cart's life.

### What survives a browser restart?

- **Survives:** the order itself, its `POSSyncRecord`, its `ConnectorCommand`
  (all backend-persisted); the `localStorage` pending-submission marker; and
  `createdOrderRef`, which is re-derived from the live orders query for the
  selected table.
- **Does not survive:** the cart contents, and `orderIdempotencyKey`.

The idempotency key is the important loss. It is React state, and the code says
so explicitly: after a restart "the in-memory idempotencyKey is gone and a
genuinely new idempotencyKey is generated — creating a second real Order". The
durable `localStorage` marker exists precisely to stop staff blind-resubmitting
into that hole (a real fix, committed 2026-09-04) — but it *blocks*, it does not
*recover*. There is no way to resume an interrupted submission.

### What prevents confirmed Round 1 lines being included in Round 2?

**Nothing — because rounds do not exist.** If round 2 is a second order, its
payload is built from its own cart, so round 1's lines are not *re-sent* — but
only because the two orders share no state at all. That is separation by
accident, not by design. The moment anything links them (the obvious next step),
there is no marker saying which lines have already gone to the kitchen.

Native IdealPOS has exactly that marker — `PendingSaleLines.Printed` — and
Verdura reads it nowhere. Its precise transition point is itself unproven
(see the KOT-semantics analysis).

### What prevents an uncertain Round 2 retry becoming a second native round?

At order granularity: `@@unique([venueId, idempotencyKey])` plus
`resolveIdempotentOutcome`, and the Bridge's own `externalOrderId` handling.
That is real and it works — for one submission of one order.

At **round** granularity: **nothing exists**, because the round is not a
first-class thing with its own identity. A retried round can only present the
order's key, which cannot distinguish "resend round 2" from "round 1 again".

## 3. Gap table

| # | Required semantic | Today | Gap |
| --- | --- | --- | --- |
| 1 | A table session spanning multiple rounds | no entity | **Missing** |
| 2 | A round as a first-class, addressable thing | no entity | **Missing** |
| 3 | Every round has an immutable unique idempotency identity | key is per-order, and lives in React state | **Missing** |
| 4 | Round payload frozen once submission begins | no lifecycle; cart is mutable to the last instant | **Missing** |
| 5 | Prior confirmed rounds cannot be re-sent | no sent/unsent marker anywhere in Verdura | **Missing** |
| 6 | New items editable until *their* round starts submitting | cart is all-or-nothing | **Missing** |
| 7 | An unresolved round blocks reconstruction/resubmit | `localStorage` marker blocks at *device* granularity | **Partial** |
| 8 | Later rounds only when product state permits | no state machine to consult | **Missing** |
| 9 | Native sale identity attached to the session, not re-guessed per round | re-guessed per order, by table-code correlation | **Missing** (and now fails closed) |
| 10 | One delivery record per round | `POSSyncRecord.orderId @unique` | **Blocked by schema** |
| 11 | One connector command per round | `connectorSubmitCommandId @unique` | **Blocked by schema** |
| 12 | Totals correct as rounds accrue | scalars on `Order` | **Missing** |
| 13 | Cart survives restart | in-memory only | **Missing** |
| 14 | Interrupted submission resumable | marker blocks, cannot resume | **Partial** |

Nine missing, two schema-blocked, two partial. The model is not one refactor
away from multi-round; it does not represent the domain at all.

## 4. The smallest clean source model

Three entities. Names chosen to say what they are, not to match a suggestion.

### `TableSession`

One party's occupancy of one table, from seating to settlement.

```
id, venueId, tableId
openedAt, closedAt?
status: open | settling | closed | abandoned
nativeSaleLinkId?          -- see below; null until strongly known
@@index([venueId, tableId, status])
-- at most one `open` session per (venueId, tableId), DB-enforced
```

The partial-unique on open sessions is what stops two devices opening two
sessions on the same table. It must be a database constraint, not a service
check.

### `OrderRound`

One batch of items sent, or about to be sent, as a unit.

```
id, tableSessionId, sequence (1,2,3… unique within session)
idempotencyKey        -- IMMUTABLE, generated at round OPEN, never at submit
state: draft | submitting | delivered_unconfirmed | confirmed | failed | abandoned
payloadFrozenAt?      -- set when state leaves `draft`; payload immutable after
posSyncRecordId?      -- one per ROUND, not per order
@@unique([tableSessionId, sequence])
@@unique([idempotencyKey])
```

Two properties carry most of the weight:

- **`idempotencyKey` is generated when the round is opened**, persisted server-side
  immediately, and returned to the tablet. This is the fix for the restart hole:
  the key is durable before any submission is attempted, so a retry after any
  failure — including a browser restart — presents the same key. Today's key is
  born in React state at submit time and dies with the tab.
- **`payloadFrozenAt`** makes immutability an enforced transition rather than a
  convention. Items may be added to a `draft` round; the moment it enters
  `submitting`, its lines are closed and new items open the *next* round.

`OrderItem` gains a nullable `orderRoundId`. Nullable is what keeps the migration
additive: every existing item stays valid with no round.

### `NativeSaleLink`

The causal identity, held **once per session**.

```
id, tableSessionId (unique)
nativeStore: ipstransaction | posserver
nativeSaleId, nativeSaleCode, nativeMap?
evidenceTier: correlated | causal      -- never conflate the two
establishedAt, establishedBy
```

`evidenceTier` is the point of this entity. Today the equivalent knowledge is
re-derived per order from table-code correlation. Here it is resolved **once**,
attached to the session, and carries an explicit statement of how strongly it is
known. Only `causal` may drive a confirmation; `correlated` is recorded and
displayed, never acted on. That mirrors the fail-closed policy now enforced in
`decideConfirmation`, rather than reinventing a second, weaker rule.

### How the invariants land

| Invariant | Mechanism |
| --- | --- |
| immutable unique round identity | `OrderRound.idempotencyKey`, generated at open, unique, never regenerated |
| payload immutable once submitting | `payloadFrozenAt` + state guard on item writes |
| prior confirmed rounds not re-sent | payload built from `orderRoundId` only; `confirmed`/`delivered_unconfirmed` rounds are never rebuilt |
| new items editable until their round submits | items attach to the current `draft` round |
| unresolved round blocks reconstruction | at most one non-terminal round per session, DB-enforced — server-side, so it holds across devices, unlike today's per-device `localStorage` marker |
| later rounds only when state permits | opening round N+1 requires round N terminal |
| native identity per session, not per round | `NativeSaleLink`, one per session, with `evidenceTier` |

## 5. What this does *not* solve

The model above is entirely vendor-independent: it describes Verdura's own
domain and would be correct even if IdealPOS were replaced.

But it **cannot make round 2 append to a native table sale.** That is a vendor
capability, not a schema question. Today's Bridge produces `WBORD-*` web orders
at `Map 0`; nothing observed appends to a table sale, and no supported write
mechanism for doing so has been identified locally. `OrderRound` would faithfully
model two rounds and then hand both to a mechanism that creates two independent
native sales.

So this model is necessary and not sufficient. It should be built when the
native append mechanism is known — vendor questions 6, 7 and 13 — because the
shape of `NativeSaleLink` and of the round→native mapping depends on the answer.

## 6. Why this was not implemented tonight

The brief's condition was: implement only if clearly vendor-independent **and**
coverable by tests.

The first half holds. The second does not, in the way that matters. The entities
are testable in isolation, but the thing they exist to guarantee — that round 2
appends to round 1's native sale and re-sends nothing — has no test oracle until
tomorrow's capture establishes what a native round transition actually looks
like. Shipping three new tables, a migration, service-layer rewrites and a tablet
state machine against an unobserved target, hours before the observation, would
be building on the same class of assumption that produced the withdrawn
table-`Code` premise and the correlation-grade `synced` promotion.

The migration is additive and low-risk whenever it is taken:

1. Create `TableSession`, `OrderRound`, `NativeSaleLink`.
2. Add nullable `OrderRound.posSyncRecordId`, nullable `OrderItem.orderRoundId`.
3. Backfill: one `TableSession` and one `OrderRound` (sequence 1, state derived
   from the existing `POSSyncStatus`) per historical dine-in `Order`; leave
   takeaway orders unsessioned.
4. Relax `POSSyncRecord.orderId @unique` to a plain index, and add
   `@@unique([orderRoundId])` in its place.
5. Only then move the tablet from cart-per-order to round-per-session.

Steps 1–3 are safe to take before the vendor answers. **Step 4 is the point of
no return** — it is the change that admits more than one delivery per order, and
it should not land until the native append mechanism is confirmed supported.

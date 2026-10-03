# Servvia realtime (WebSocket) contract

**NEW SERVVIA-NATIVE (Phase D12).** Served by Servvia Core (Go, `services/core-platform/internal/realtime`). No client is switched to it yet. The NestJS Socket.IO `orderUpdate` channel ([orders-socket.md](orders-socket.md)) stays as it is for existing clients until each client's own cutover. This contract does not reproduce it.

Machine-readable messages: [`servvia-realtime.schema.json`](servvia-realtime.schema.json). What each fact means: [`../events/catalog.md`](../events/catalog.md).

## Principle

PostgreSQL is the truth, and HTTP (`contracts/openapi/*`) is how a client reads it. A realtime event is a **notification**: what changed, and which resource to refetch. It is not a resource representation, a command or history. A client that has missed anything refetches over HTTP; it never reconstructs state from events.

## Connection

`GET /api/realtime`, upgraded to WebSocket (RFC 6455). Text frames, one JSON message per frame.

1. **Authenticate.** Send the credential either as `Authorization: Bearer <credential>` on the upgrade request (Kotlin, C#, Go) or as `token` in the first message (browsers, which cannot set headers). The credential is a staff, tablet or KDS access token (`../schemas/auth-token-claims.schema.json`) or a Phase D8 device credential (`sdv1.…`). It is never logged or echoed.
2. **Subscribe.** Within 10 s, send exactly one message: `{"type":"subscribe","venueId":"<id>"}`, plus `token` if not sent in the header. Any other property is refused, including an `organizationId` (that comes from the server).
3. The server answers `{"type":"subscribed","venueId","organizationId","streams":[…],"serverTime"}`. Then it sends `{"type":"event","event":<envelope>}` frames.
4. **Nothing else may be sent.** Any client data frame after `subscribed` closes the connection with 1008 (policy violation). A subscription cannot be widened or re-pointed; open another connection instead. Pings are answered automatically. The server pings every 30 s.

An `Origin` header, if present, must be one of the HTTP API's CORS origins. Native clients send none.

## Authorization

Streams are granted by identity. The client never chooses them.

| Stream | Facts |
|---|---|
| `kitchen` | `kitchen_ticket.*` |
| `operations` | `table_session.*`, `order.*`, `kitchen_ticket.*`, `promotion.*` |
| `financial` | `check.*`, `payment.*`, `refund.*`, `reversal.*`, `shift.*` |

| Identity | Streams |
|---|---|
| Staff login, role owner, admin, manager or cashier | operations, financial |
| Tablet elevated by a staff or manager PIN (`tablet_staff`, `tablet_manager`), same roles | operations, financial |
| Staff with role `kitchen` | kitchen |
| KDS token (`kds_device`, the NestJS KDS PIN) | kitchen |
| D8 device credential of kind `kds` | kitchen |
| Role `viewer`; an unelevated customer-mode tablet (`tablet_device`) | **refused** (4403) |
| D8 `order_tablet`, `pos_terminal` or `payment_adapter` credential | **refused** (4403). A device kind grants no staff authority. A POS installation subscribes with its operator's staff token; the payment adapter has no subscriber need. |

**Venue and organization isolation** is server-side and total:
- The venue must belong to the credential's organization. Otherwise the connection closes with 4404 (the same answer as an unknown or malformed id).
- A venue-pinned token (KDS or tablet) or device may subscribe only to its own venue. Naming another venue gives 4403; the server never silently corrects it.
- A staff identity (a staff login, or a tablet elevated by a staff or manager PIN) may subscribe only to a venue of its organization for which the staff member holds a `VenueAccess` grant. Every role is covered, owner and admin included. Without a grant the connection closes with 4403 `FORBIDDEN`. If the grant cannot be checked, the connection closes with 1011 `INTERNAL` and is never admitted.
- An event is delivered only when its `venueId` **and** `organizationId` match the subscription and its type is in a granted stream.

**Credential lifetime:**
- The connection closes (4401 `TOKEN_EXPIRED`) when its access token expires.
- Tablet and device credentials are re-checked every 60 s, and revocation closes the connection (4401).
- A re-check that cannot be completed (the credential cannot be verified) closes the connection with 1011 `INTERNAL`, never 4401. Reconnect; a revoked credential is then refused with 4401.
- Reconnect with a fresh credential.

## Envelope

```json
{
  "eventId": "7c9e…",            // uuid; the same fact redelivered keeps it
  "eventType": "check.settled",
  "occurredAt": "2026-09-30T01:02:03.004Z",   // the change's transaction time
  "organizationId": "…",         // server-derived from the venue
  "venueId": "…",
  "aggregateType": "check",
  "aggregateId": "…",
  "version": 3,                  // the aggregate's version after the change, or null
  "payload": { "checkId": "…", "status": "settled", "settlementId": "…", "cycle": 1 }
}
```

Payloads carry identifiers, statuses and summary amounts only. They never carry credentials, JWTs, provider or result references, card data, staff financial detail, eligibility lists or whole rows. The bound is 8 KiB.

## Delivery semantics

- **Durable publication.** Every fact is written in the **same database transaction** as the change it announces. A committed change always has its fact. A rolled-back change never has one. Delivery happens after commit, so a delivery failure never affects the change.
- **At most once per connection.** No acknowledgements, no replay. Across reconnects, completeness comes only from the **HTTP refetch**.
- **Duplicates are possible** (for example with several server instances). Deduplicate by `eventId`.
- **No global order.** Within one server connection, events arrive in the order their transactions became visible. For one aggregate, `version` increases, so a client may drop an event whose version is not greater than what it holds. Orders have no version; refetch.
- **Backpressure.** 256 events are buffered per connection. A connection that falls behind is closed with 4008 `SLOW_CONSUMER`. It is never waited for, and nothing else slows down.
- **Shutdown.** New upgrades get 503. Open connections close with 1001 `SHUTTING_DOWN`.

## Reconnect and resync

```
connection lost / 4008 / 1001 / 4401 TOKEN_EXPIRED
  → reconnect (backoff 1–30 s, with jitter)
  → authenticate (fresh credential if expired)
  → subscribe
  → on `subscribed`: REFETCH the resources you display over HTTP
  → apply events from then on (dedupe by eventId, drop stale versions)
```

Refetch **after** `subscribed`, not before. Then no change can fall between the refetch and the first event.

## Errors

The server sends `{"type":"error","code","message"}` and then closes:

| Code | Close | When |
|---|---|---|
| `BAD_REQUEST` | 4400 | Missing, late, malformed or extra-property `subscribe` message; no venue |
| `UNAUTHENTICATED` | 4401 | Missing, invalid or expired credential; a revoked device |
| `TOKEN_EXPIRED` | 4401 | The credential expired during the connection |
| `FORBIDDEN` | 4403 | An identity with no realtime grant, or a pinned identity naming another venue |
| `VENUE_NOT_FOUND` | 4404 | The venue is not in the credential's organization |
| `SLOW_CONSUMER` | 4008 | The connection fell behind |
| `SHUTTING_DOWN` | 1001 | The server is draining |
| `INTERNAL` | 1011 | A server fault; reconnect |

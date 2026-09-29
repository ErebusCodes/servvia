# Orders realtime contract (socket.io), as built

This is the one realtime channel the NestJS API exposes today. It pushes whole `Order` rows to the
Admin Console (Orders page and Order Tablet) and to the Kitchen Display. The document records the
existing behaviour so that a Go replacement can be wire-compatible, or can break compatibility
deliberately. Where this document says "must", it means "the current clients depend on it".

Sources:
- Server: `apps/api/src/orders/orders.gateway.ts`
- Clients: `apps/admin-console/src/shared/orders.ts:316-384` (`useLiveOrders`) and `apps/window-display/src/pages/KdsPage.tsx:130-191`
- Libraries: `socket.io ^4.8.3` and `@nestjs/platform-socket.io ^11.1.27` (`apps/api/package.json:44,60`); `socket.io-client ^4.8.3` (`apps/admin-console/package.json:22`, `apps/window-display/package.json:55`)

## 1. Transport

| Aspect | Value | Source |
|---|---|---|
| Protocol | Socket.IO v4 (Engine.IO v4) | package.json versions above |
| Server | `@WebSocketGateway({ cors: { origin: '*' } })`. There is no `port`, `path` or `namespace` option, and no custom `IoAdapter` is registered. | `orders.gateway.ts:39-43`; searched `apps/api/src` for `IoAdapter`/`useWebSocketAdapter` and found none |
| Port | Same HTTP server as the REST API (`PORT`, default 3000) | `apps/api/src/main.ts:153-161` |
| Path | `/socket.io/`, the Socket.IO default. The REST global prefix `api` does **not** apply to gateways. | NestJS / Socket.IO default. **x-unverified**: this is the library default, not configured in code. |
| Namespace | `/`, the default | `orders.gateway.ts:39` (no namespace option) |
| Server transports | Server default (`polling` and `websocket`) | No `transports` option on the gateway. **x-unverified**: library default. |
| Client transports | `['websocket']` only. HTTP long-polling is never used by the shipped clients. | `orders.ts:360`, `KdsPage.tsx:162` |
| Client URL | `VITE_API_URL`. An empty value means same origin (`io(undefined)` in Admin Console). | `orders.ts:179,359`; `KdsPage.tsx:8,161` |
| CORS | `origin: '*'` on the socket server. It is independent of the enumerated REST CORS allow-list in `main.ts`. | `orders.gateway.ts:40-42` |
| Heartbeat and ping | Socket.IO defaults; nothing is configured | **x-unverified** |

Client reconnection settings:
- Admin Console: `reconnection: true`, all other values default (`orders.ts:359-363`).
- KDS: `reconnection: true`, `reconnectionAttempts: Infinity`, `reconnectionDelay: 1000`, `reconnectionDelayMax: 5000`, `timeout: 10000` (`KdsPage.tsx:161-169`).

## 2. Handshake authentication

Source: `orders.gateway.ts:31-37,55-69`, `apps/api/src/auth/auth.service.ts:155-163`.

1. Token lookup order:
   - `handshake.auth.token` (Socket.IO `auth` payload). Both shipped clients use this.
   - Otherwise `Authorization: Bearer <jwt>` in the handshake headers.
2. `AuthService.verifyAccessToken(token)` runs `jwt.verify` with `JWT_ACCESS_SECRET`. This is the same secret as REST access tokens. It checks the signature and `exp` only. It does **not** check the database: no staff `isActive` lookup and no tablet-device revocation check.
3. On a missing or invalid token the server calls `client.disconnect(true)` inside `handleConnection`. There is no `connect_error` with a reason. The client sees a server-initiated disconnect (`io server disconnect`). socket.io-client does **not** auto-reconnect after a server-initiated disconnect.
4. On success the decoded `JwtPayload` is stored in `socket.data.user`.
5. **The token is verified only at connect.** A socket stays authenticated, and stays in its rooms, after the JWT expires or after the device or staff member is revoked. The TTLs are:
   - Staff access token: `JWT_ACCESS_EXPIRY`, default `15m` (`auth.service.ts:121`).
   - KDS token: `KDS_TOKEN_EXPIRY`, default `12h` (`auth.service.ts:145`).

Accepted token kinds. The field is `JwtPayload.kind` (`apps/api/src/auth/interfaces/jwt-payload.interface.ts`):

| `kind` | Minted by | Carries `venueId` | Accepted at handshake |
|---|---|---|---|
| absent (staff login) | `AuthService.signAccessToken` (`auth.service.ts:113-123`) | no | yes |
| `kds_device` | `AuthService.signKdsDeviceToken` (`auth.service.ts:133-147`), `role: kitchen` | yes | yes |
| `tablet_device` / `tablet_staff` / `tablet_manager` | `apps/api/src/tablet/tablet-auth.service.ts:133,149,170` | yes | yes. They are signed with `JWT_ACCESS_SECRET` (`tablet-auth.service.ts:136-137,152-153,174`). |
| `staff` | declared in the type, not minted by the paths above | – | yes, if presented |

Connector credentials (`<installationId>.<secret>`) are not JWTs, so they are rejected here.

## 3. Client → server events

### `joinVenue`
Source: `orders.gateway.ts:75-98,106-115`.

Payload:
```json
{ "venueId": "<uuid string>" }
```
Handler results. These are delivered only as a Socket.IO acknowledgement, and **neither shipped client passes an ack callback**, so the clients never see them:

| Condition | Return (ack payload) |
|---|---|
| no `socket.data.user` | `{ "error": "Unauthorized" }` |
| missing payload or empty `venueId` (no UUID format check) | `{ "error": "Invalid venueId" }` |
| not authorised for venue | `{ "error": "Unauthorized for this venue" }` |
| success | `{ "status": "joined", "rooms": ["venue:<venueId>:orders", "venue:<venueId>:kds"] }` |

Authorisation rules, by token kind (`isAuthorizedForVenue`):
- **`kds_device`:** allowed only if `user.venueId === venueId`. There is no database lookup.
- **Every other kind, including all `tablet_*` kinds:** allowed if the `Venue` row exists and `venue.organizationId === user.organizationId`. **Role is not checked** and the token's own `venueId` is ignored.

A socket that succeeds joins **both** rooms. There is no `leaveVenue` event. A client may call `joinVenue` repeatedly for different venues and receive all of them. Both shipped clients emit `joinVenue` on every `connect`, including reconnects, then refetch over REST (`orders.ts:364-368`, `KdsPage.tsx:171-175`).

No other `@SubscribeMessage` handlers exist.

## 4. Rooms

| Room | Joined by | Emitted to |
|---|---|---|
| `venue:{venueId}:orders` | every successful `joinVenue` | every `sendOrderUpdate` |
| `venue:{venueId}:kds` | every successful `joinVenue` | every `sendOrderUpdate` |

The two rooms always have identical membership (`orders.gateway.ts:93-96`).

## 5. Server → client events

### `orderUpdate`
Emitted by `OrdersGateway.sendOrderUpdate(venueId, order)` (`orders.gateway.ts:117-122`):
```ts
this.server.to(`venue:${venueId}:orders`).emit('orderUpdate', order);
this.server.to(`venue:${venueId}:kds`).emit('orderUpdate', order);
```
- **Payload:** a single Prisma `Order` object serialised by Socket.IO. DateTimes become ISO strings and `Json` columns pass through as-is.
- **Scalar fields:** all `Order` scalars (`apps/api/prisma/schema.prisma` `model Order`, line 826): `id, venueId, tableId, tableNumber, status, posSyncStatus, subtotalCents, taxCents, totalCents, notes, source, serviceMode, guests, takeawayReference, idempotencyKey, paymentProviderTransactionId, submittedAt, confirmedAt, preparingAt, readyAt, completedAt, cancelledAt, createdAt, updatedAt`.
- **Included relations:** these vary by emit site (next table).
- **`OrderItem` fields** (`model OrderItem`, line 921): `id, orderId, menuItemId, menuItemTitle, menuItemCategory, unitPriceCents, quantity, lineTotalCents, selectedModifiers (Json), notes, seat, nativeRoundId`.
- **Payload is sometimes `null`.** Two sites emit whatever `findUnique` returned without a null check, so if the order vanished the payload is `null`: `orders.service.ts:1873-1877` and `kds-dispatcher.service.ts:216-220`.

### Emit sites (every caller of `sendOrderUpdate`)

Found by searching for `sendOrderUpdate` and `server.to`. The only `server.to` calls are inside the gateway.

| # | Trigger | Caller (Source) | `include` shape |
|---|---|---|---|
| 1 | Kiosk order created (`OrdersService.create`) | `apps/api/src/orders/orders.service.ts:236` → `broadcastOrder` (`:1872-1878`) | `{ items, posSyncRecord }` |
| 2 | Staff/tablet order created (`OrdersService.createStaffOrder`) | `orders.service.ts:393` → `broadcastOrder` | `{ items, posSyncRecord }` |
| 3 | Order status change (`OrdersService.updateStatus`, from `PATCH` in `orders.controller.ts:106`) | `orders.service.ts:946`; row from `:922-926` | `{ items, table, posSyncRecord }` |
| 4 | KDS outbox sweep (re-push) | `apps/api/src/orders/kds-dispatcher.service.ts:216-220` | `{ items }` only (no `table`, no `posSyncRecord`) |
| 5 | Legacy IdealPOS `POSSyncRecord` transition | `apps/api/src/pos-sync/idealpos-order-dispatcher.service.ts:202-215` (`broadcastPosSyncUpdate`), called at `:391, 467, 591, 673, 817, 836, 860, 900, 922` | `{ items, table, posSyncRecord }` |

`LEGACY_EXTERNAL_POS_ORDER_INCLUDE = { posSyncRecord: true }` (`apps/api/src/legacy-external-pos/legacy-external-pos-handoff.ts:55`).

**The payload shape is not uniform.** A client that replaces its cached order with the pushed object can lose `table` or `posSyncRecord`, depending on which site emitted.

## 6. Delivery semantics

- **At-most-once per emit.** There is no acknowledgement, no sequence number, no event id and no replay. Clients rely on a REST refetch on `connect` and on polling:
  - Admin Console refetches every 15 s while disconnected (`orders.ts:342`).
  - KDS refetches only on connect.
- **Each emit arrives twice.** `sendOrderUpdate` makes two separate `emit` calls, one to each room, and every joined socket is in both rooms. A connected client therefore receives each `orderUpdate` **twice**. The clients stay correct only because they upsert by `order.id` (`orders.ts:370-377`, `KdsPage.tsx:179-189`).
- **Durable KDS backstop (`KdsDeliveryRecord`).** Every order gets one `KdsDeliveryRecord` in the order-creation transaction (`orders.service.ts:1820-1834`). `KdsDispatcherService.sweepDispatch` (`kds-dispatcher.service.ts:109-260`) re-pushes on a timer:
  - **Timer:** `KDS_DISPATCH_SWEEP_INTERVAL_MS`, default 5000. Batch size `KDS_DISPATCH_BATCH_SIZE`, default 50.
  - **Eligible rows:** `queued` rows with no live claim, **and** `pushed` rows whose `pushedAt` is older than `KDS_DISPATCH_SAFETY_NET_MS` (default 10 min). The `pushed` rows are re-pushed on purpose, as a guard against dropped emits.
  - **Claim:** a compare-and-set that sets `dispatchClaimId`, with lease `KDS_DISPATCH_CLAIM_LEASE_MS` (default 30 s).
  - **Push, then confirm:** it emits, then sets status to `pushed`, `pushAttemptCount + 1`.
  - **Cancelled orders:** these move to `cancelled` and are never pushed again.
  - **Exhaustion:** at `pushAttemptCount >= KDS_DISPATCH_MAX_ATTEMPTS` (default 5) the row moves to `exhausted`.
  - **Consequence:** an order that is still not cancelled is re-broadcast about every 10 min, up to 5 pushes in total. Each re-broadcast reaches both rooms, so it also reaches Admin Console clients, not only KDS. The row then ends `exhausted`, even though every push "succeeded". `pushed` is **not** evidence of receipt (`schema.prisma` `enum KdsDeliveryStatus`, lines 163-179).
- **No ordering guarantee between sites.** A KDS re-push (site 4) or a POS-sync push (site 5) can arrive after a newer status push and carry a stale `status`. Clients do not compare `updatedAt`. **x-unverified**: this is inferred from the code; no ordering mechanism exists to prevent it.

## 7. Known issues (as of this reading)

1. **CORS is open.** `origin: '*'` on the gateway, while REST uses an allow-list (`main.ts`). A token is still required, but any web origin holding a token can connect.
2. **Duplicate delivery.** Every event is delivered twice per socket (section 6). KDS re-pushes add up to 5 more copies per order.
3. **Prices and payment identifiers reach the KDS.** The KDS receives `subtotalCents`, `taxCents`, `totalCents`, item `unitPriceCents` and `lineTotalCents`, plus `paymentProviderTransactionId` and `idempotencyKey`. The payload is the full `Order` row, and no per-audience projection exists.
4. **Tablet tokens are not pinned to a venue.** `tablet_device`, `tablet_staff` and `tablet_manager` tokens carry a `venueId`, but `isAuthorizedForVenue` pins only `kds_device`. A tablet token can join any venue in its organisation.
5. **The socket bypasses REST role checks.** A bare `tablet_device` token (role `viewer`) is rejected by `GET /api/admin/orders` (`orders.ts:308-314`). Over the socket it receives the same data. Role is never checked.
6. **No re-validation after connect.** Expiry, device revocation (the REST `TabletTokenActiveGuard`) and staff deactivation are not re-checked for a connected socket.
7. **Reconnects use the old token.** Both clients build `auth: { token }` once, at `io()` construction (`orders.ts:362`, `KdsPage.tsx:168`). A reconnect after the token has expired (15 min for staff) presents the old token and is rejected. After that server-side disconnect the client does not retry, and Admin Console falls back to 15 s REST polling. **x-unverified**: this was not reproduced at runtime.
8. **`joinVenue` failures are invisible.** Clients never register an acknowledgement, so an unauthorised join looks connected (`isRealtimeConnected = true`) but receives nothing.
9. **Inconsistent payload shape** across emit sites (section 5), and a possible `null` payload.
10. **Two rooms do the work of one.** `venue:{id}:orders` and `venue:{id}:kds` are redundant today, and are the direct cause of issue 2.

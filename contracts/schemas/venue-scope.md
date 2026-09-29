# Venue scope: how organization and venue context are resolved

This describes how the Servvia NestJS API decides, on each request, which organization and which venue a caller may act on. A Go service that takes over any of these routes must apply the same rules. Token claims are defined in `auth-token-claims.schema.json`.

## 1. Where the context comes from

- **Organization:** always `req.user.organizationId`, taken from the verified access-token claim `organizationId`. No header, query or body field overrides it. Every org-scoped service query filters on it.
  Source: apps/api/src/auth/strategies/jwt.strategy.ts:27
- **Venue:** comes from one of three places, depending on the route:
  1. a route/query/body `venueId` supplied by the caller (for example `/api/venues/:venueId/...`, `?venueId=`, `CreateStaffOrderDto.venueId`), and
  2. the token claim `venueId`, which exists only on device kinds, and
  3. the helper `resolveVenueScope(user, requestedVenueId)`, which reconciles 1 and 2 on the routes that call it.
- **Connector principal:** a venue connector is not a JWT principal. `ConnectorAuthGuard` sets `req.connector = { installationId, organizationId, venueId }` from the DB row matched by the `Authorization: Bearer <installationId>.<secret>` credential. It never populates `req.user`.
  Source: apps/api/src/auth/guards/connector-auth.guard.ts:27, apps/api/src/connector/connector.service.ts:328

## 2. `resolveVenueScope` rules (exact)

```
resolveVenueScope(user, requestedVenueId?) -> string | undefined
```

| Token kind (`user.kind`) | Pinned to one venue? | Return value | Throws |
|---|---|---|---|
| absent (staff login token) or `staff` | No, org-wide | `requestedVenueId` unchanged (may be `undefined`, which means all venues in the org) | never |
| `kds_device` | Yes, `user.venueId` | `user.venueId` | 403 if `requestedVenueId` is truthy and `!== user.venueId` |
| `tablet_device` | Yes | `user.venueId` | same 403 |
| `tablet_staff` | Yes (elevation does not widen reach) | `user.venueId` | same 403 |
| `tablet_manager` | Yes | `user.venueId` | same 403 |
| any other string (not issuable without the secret) | No, treated like staff | `requestedVenueId` | never |

The error on mismatch is a Nest `ForbiddenException`:

```json
{ "statusCode": 403, "message": "This device is not authorized for the requested venue", "error": "Forbidden" }
```

Source: apps/api/src/auth/utils/resolve-venue-scope.ts:5, apps/api/src/auth/utils/resolve-venue-scope.ts:26-37

Notes on exact behaviour:
- The comparison is exact string equality. An empty-string `requestedVenueId` is falsy, so a device then gets its own venue silently.
- For staff tokens the helper does **not** check that `requestedVenueId` belongs to `user.organizationId`. That check, where it exists, is done by the service query, which filters on `organizationId`. For example, `createEnrollment` returns 404 `Venue not found in your organization`.
  Source: apps/api/src/tablet/tablet-auth.service.ts:188, apps/api/src/connector/connector.service.ts:129
- Some call sites discard the return value and use it only as a guard, then pass the caller-supplied `venueId` onward. Examples: `TablesController.findAll`/`findOne` and `OrdersController.createStaffOrder`. The two forms behave the same, because a device either matches or gets 403.
  Source: apps/api/src/tables/tables.controller.ts:50, apps/api/src/tables/tables.controller.ts:61, apps/api/src/orders/orders.controller.ts:87

## 3. Routes that call `resolveVenueScope`

- orders: apps/api/src/orders/orders.controller.ts:63, :73, :87, :105, :120
- tables: apps/api/src/tables/tables.controller.ts:50, :61
- venues tax-config: apps/api/src/venues/venues.controller.ts:62
- tablet orders: apps/api/src/tablet/tablet-orders.controller.ts:58, where the venue comes only from the token and `undefined` is passed
- printer jobs: apps/api/src/printer/printer-jobs.controller.ts:46, :58, :69, :91
- pos-sync records: apps/api/src/pos-sync/pos-sync-records.controller.ts:46, :57; native rounds apps/api/src/pos-sync/native-rounds.controller.ts:655
- payment observation: apps/api/src/payment-observation/payment-observation.controller.ts:69, :81, :109; fixture injection apps/api/src/payment-observation/payment-observation-fixture-injection.controller.ts:63

Venue pinning is **opt-in per call site**. Controllers that read `req.user.organizationId` without calling `resolveVenueScope` are scoped to the organization only. Examples: menu, categories, reservations, staff, media assets, pos-catalog, connector admin, connector-command admin and tablet-devices admin. On those routes a device-kind token is limited only by `@Roles` and any other guards on the route, not by its `venueId` claim.
Source: `grep -rln "user.organizationId" apps/api/src` minus the list above.
`x-unverified: true`: this document does not audit, route by route, whether a device kind's `role` passes each of those routes' `@Roles` list.

Two admin surfaces in this contract block device kinds by other means:
- `/api/venues/:venueId/tablet-devices/*` applies `StaffSessionOnlyGuard`, which returns 403 `This action requires a genuine staff login session` for any `kind` other than absent or `staff`.
  Source: apps/api/src/tablet/tablet-devices-admin.controller.ts:21, apps/api/src/auth/guards/staff-session-only.guard.ts:21
- `/api/venues/:venueId/connector/*` does **not** apply `StaffSessionOnlyGuard`. See the known issues below.
  Source: apps/api/src/connector/connector-admin.controller.ts:18

## 4. Tablet revocation is layered on top of scope

A tablet token's signature stays valid after the device is revoked. Revocation is enforced only by:
- `TabletDeviceGuard`, which returns 403 for non-tablet kinds, then 401 `This device has been revoked or is unknown` when the `TabletDevice.status !== 'active'`.
  Source: apps/api/src/tablet/guards/tablet-device.guard.ts:23, apps/api/src/tablet/tablet-auth.service.ts:384
- `TabletTokenActiveGuard`, which does nothing for staff and kds tokens and returns the same 401 for tablet kinds.
  Source: apps/api/src/auth/guards/tablet-token-active.guard.ts:33

Routes without either guard honour a revoked tablet token until `exp`.

## 5. WebSocket `joinVenue` is inconsistent with REST

The socket.io gateway (`OrdersGateway`, default namespace) authenticates the handshake with `AuthService.verifyAccessToken`, using `handshake.auth.token` or `Authorization: Bearer`. It disconnects when there is no token or the token is invalid.
Source: apps/api/src/orders/orders.gateway.ts:31-37, apps/api/src/orders/orders.gateway.ts:55-69

The `joinVenue` message, with payload `{ venueId }`, is acknowledged with one of:
- `{ error: 'Unauthorized' }` when there is no socket user,
- `{ error: 'Invalid venueId' }`,
- `{ error: 'Unauthorized for this venue' }`,
- `{ status: 'joined', rooms: ['venue:<id>:orders', 'venue:<id>:kds'] }`.

The authorization rule in `isAuthorizedForVenue` is:
- `kind === 'kds_device'` → allowed only if `user.venueId === venueId`.
- **every other kind**, including `tablet_device`, `tablet_staff` and `tablet_manager` → allowed for **any venue whose `organizationId` equals the token's `organizationId`**.

Source: apps/api/src/orders/orders.gateway.ts:75-97, apps/api/src/orders/orders.gateway.ts:106-115

**Inconsistency:** REST `resolveVenueScope` pins all four device kinds to their venue. The gateway pins only `kds_device`, so any tablet token can subscribe to `orderUpdate` events for every venue in its organization. The gateway also checks no tablet revocation: a revoked device's token can still connect and join until `exp`. A Go replacement that aims for parity must decide whether to keep this behaviour or fix it, and must record that decision explicitly.

## 6. Known issues (current behaviour)

- The WebSocket `joinVenue` pins only `kds_device` and not the `tablet_*` kinds (section 5).
- The gateway performs no tablet revocation check (section 5).
- `ConnectorAdminController` has no `StaffSessionOnlyGuard`. A `tablet_manager` token whose `role` is `admin`, or any token with role `owner` because of the RolesGuard owner bypass, can create connector enrollments. Its org-only scoping means the `venueId` claim is not enforced there either.
  Source: apps/api/src/connector/connector-admin.controller.ts:18, apps/api/src/auth/guards/roles.guard.ts:42
- Venue pinning depends on each controller remembering to call `resolveVenueScope`. It is not enforced globally: there is no `APP_GUARD`.
- `TabletAuthService.elevateStaff` and `managerStepUp` pick candidate staff from the whole organization (`organizationId`, active, PIN set) and do **not** filter by venue access, even though the doc comment says they do. A staff member of another venue in the same organization can therefore elevate on this venue's tablet. The resulting token is still pinned to the device's venue.
  Source: apps/api/src/tablet/tablet-auth.service.ts:463-470, apps/api/src/tablet/tablet-auth.service.ts:521-529

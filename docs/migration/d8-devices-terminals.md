# D8 implementation note: devices and terminals

Status: implemented 2026-09-29, tested against disposable databases only. Not applied to production; no client, adapter, tablet or KDS is switched. The results are in [README.md](README.md#phase-d8-result).

## CURRENT (audited 2026-09-29)

| Concept | Where | What it does | D8 classification |
|---|---|---|---|
| Order Tablet identity | `TabletEnrollment` + `TabletDevice` (`tablet/tablet-auth.service.ts`) | An admin/manager creates a one-time, expiring enrollment code (argon2id hash, `StaffSessionOnlyGuard`). Redeeming it creates a `TabletDevice`, and the device then authenticates with a Nest-signed `tablet_device` JWT whose revocation `TabletTokenActiveGuard` re-checks on every request. The `secretHash` it generates is never returned or used. | **Transitional.** Good parts kept: hashed credential, one-time plaintext, per-request revocation, staff-session-only administration. It is superseded by `Device(kind=order_tablet)` and retired after the Android Order Tablet migrates. Not deleted, not switched. |
| KDS identity | `kds-auth.service.ts` | A per-venue PIN from the environment variable `KDS_VENUE_PINS` issues a `kds_device` JWT with `sub = kds-device:<venueId>`. There is no registry: one identity per venue, not revocable individually. | **Transitional.** Superseded by `Device(kind=kds)` when the Android KDS migrates. |
| Venue connector | `ConnectorEnrollment` + `ConnectorInstallation` | The IdealPOS bridge agent: an enrollment code redeemed for a hashed secret, plus command polling (`ConnectorCommand`). | **Transitional**, not touched. Venue Edge identity is decided in the Venue Edge phase. No `venue_edge` kind is added now. |
| Printers | `Printer` | Transport configuration (host, port, protocol). Not an identity. | Unchanged; out of scope. |
| Payment adapter | D6 `SERVVIA_CORE_PAYMENT_ADAPTER_TOKEN` | One global secret for every venue. | **Removed.** Replaced by `Device(kind=payment_adapter)`, one per venue. Nothing used the secret (no adapter exists), so no compatibility path is kept. |
| Terminal / till / workstation | none | — | New: `Terminal`. |
| Token kinds | `contracts/schemas/auth-token-claims.schema.json` | `staff` (session), `kds_device`, `tablet_device`, `tablet_staff`, `tablet_manager`. | Unchanged. Device credentials are **opaque**, not JWTs (below). |

## Canonical (D8)

| Concept | Decision |
|---|---|
| **Device** | An enrolled installation that authenticates to Servvia. Fields: venue, `kind` (what it is, never who may act), display name, status (`active`/`revoked`), credential verifier, rotation time, and who created and revoked it. **The permanent registry**; `TabletDevice` is compatibility only. |
| Kinds | Only those with a use now: `payment_adapter` (the D6 result route), `pos_terminal` (bindable to a Terminal), `order_tablet` and `kds` (so the Android migrations enrol here instead of in a second registry). Waiter tablet, kiosk, window display and Venue Edge are added additively when their phases need an identity. |
| **Terminal** | A logical POS station at a venue ("Front Counter"). Fields: name, a code unique per venue, status (`active`/`disabled`), and an optional bound `pos_terminal` Device. Not hardware. A venue has any number. |
| Device ↔ Terminal | At most one terminal per device (unique `deviceId`). A terminal has one device or none. Composite foreign key `(deviceId, deviceKind, venueId)` → `Device(id, kind, venueId)` plus a CHECK that `deviceKind = pos_terminal`: the database guarantees the bound device is a POS device of the same venue. |
| Shift ↔ Terminal | Optional `Shift.terminalId` (composite foreign key to the same venue). A new shift may name an **active** terminal, checked under a `FOR SHARE` lock that a disable (`FOR UPDATE`) waits for. Existing shifts keep NULL. D7's rule stays: one open shift per (venue, staff), not per terminal. Disabling a terminal does not change historical shifts. |
| Credential | Opaque: `sdv1.<deviceId>.<secret>`, where the secret is 32 random bytes in base64url. Only `sha256(secret)` is stored (unique). A 256-bit random secret needs no slow hash. Verified by loading the device by id and comparing digests in constant time. Returned **once**, at enrollment and rotation. Never in list/get responses, logs, audit rows or URLs. |
| Authentication | Each request loads the device: it must be active, of the route's kind, and at the path's venue. The venue comes from the stored device, never from the caller. Revocation and rotation take effect on the next request. |
| Enrollment | Owner, admin or manager, from a **staff login session only** (as Nest's tablet administration: no tablet, even elevated). The request key is unique per venue. A replay returns the device **without** a credential; recover with a rotation. |
| Lifecycle | Revoke (final; idempotent). Rotate (active only; version-checked). Terminal: disable (final; idempotent), bind device, unbind device (version-checked). |
| Payment adapter | The result route authenticates only an active `payment_adapter` device of the path's venue. The result's actor is the device id. Staff JWTs, other device kinds, revoked or rotated credentials, and other venues' adapters are refused. |
| Authorization | Devices: owner/admin/manager, staff login session. Terminals: those may manage; a cashier may read. KDS and devices: no administration. A device credential on a staff route is refused (it is not a JWT), and a staff JWT on the device route is refused (not a device credential). |
| Audit | `AuditLog` (staff actors): `DEVICE_ENROLLED`, `DEVICE_REVOKED`, `DEVICE_CREDENTIAL_ROTATED`, `TERMINAL_CREATED`, `TERMINAL_DISABLED`, `TERMINAL_DEVICE_BOUND`, `TERMINAL_DEVICE_UNBOUND`. There are no secrets in them. Device-authenticated calls are not audited unless they change state (a payment result is already payment history). |
| Not done | Hardware of any kind, Venue Edge, KDS/tablet migration, printers, per-device JWT exchange. |

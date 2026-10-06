---
title: 'Story 15.1: Core audit records the real actor class, and the device a staff action was taken on'
type: 'feature'
created: '2026-10-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

> **FREEZE CANDIDATE — NOT YET FROZEN.** Prepared 2026-10-06 against baseline `5d5772d8ad172a6374beb5892a22a389ac34c8af` (its Core, Prisma, Nest and evaluator trees are those of `6526159`). Implementation is **not authorized**. The orchestrator alone freezes the objective (`_bmad-output/implementation-artifacts/objectives/README.md`). The freeze-candidate packet, its evidence and the generator are in `_bmad-output/implementation-artifacts/objective-drafts/story-15-1-core-audit-actor-attribution/`.

<intent-contract>

## Intent

**Problem:** Core writes its audit records (the existing `AuditLog`) in eight places, each with its own SQL that fills only the staff columns (`actorId`, `actorEmail`, `actorRole`). The table already has the truthful actor shape (`actorType` staff, device or system, `deviceKind`, `deviceId`, `systemActor`; CHECK `AuditLog_actor_shape_check`; migration `20261010000000_audit_actor_types`), and Nest already uses it. Core does not. In particular, a staff member acting on a PIN-elevated tablet (`tablet_staff`, `tablet_manager`) is recorded without the tablet, on every tablet-reachable audited route: table sessions, orders, checks, payments, refunds and shifts. Core also has no model in which a device or system actor could be recorded without borrowing a staff identity (INV-3; O-21 item 4; DEC-OPS-21).

**Approach:** Add one Core audit package, `services/core-platform/internal/audit` (the target named in Part C §30.3). It holds an actor model that can express exactly the three shapes the database enforces: a staff member, optionally acting through a device; a device acting on its own, never with a staff identity; and a system process, with nothing else. It validates the actor before writing and has the only `INSERT INTO "AuditLog"` in Core. The eight writers delegate to it. The six tablet-reachable handlers derive the device context from the verified principal only (a `tablet_staff` or `tablet_manager` token names its TabletDevice; every other principal names none) and pass it with the staff actor. No production path records a device or system actor in this story, because no Core audit writer is device- or system-initiated today.

The package's API is fixed by this contract (the evaluator's own test calls it):

```go
package audit // servvia/services/core-platform/internal/audit

const DeviceKindTablet = "tablet_device"
type Device struct{ Kind, ID string }              // the zero value is no device
func DeviceOf(p identity.Principal) Device          // tablet_staff / tablet_manager: {DeviceKindTablet, p.DeviceID}; otherwise Device{}
type Actor struct{ /* unexported */ }               // the zero value is not an actor
func Staff(id, email, role string, via Device) Actor
func ByDevice(d Device, role string) Actor          // role: the device credential's role, or ""
func System(name string) Actor
var ErrInvalidActor error
func (a Actor) Validate() error                     // nil, or an error wrapping ErrInvalidActor
type Entry struct {
	OrganizationID, VenueID string
	Actor                   Actor
	Action, Resource, ResourceID string
	Before, After           map[string]any          // Before may be nil
}
func Write(ctx context.Context, tx pgx.Tx, e Entry) error // validates, then inserts in tx
```

## Boundaries & Constraints

**Always:**
- Every Core AuditLog row names exactly the actor of its class. A staff row has the staff id and role (both required) and the email, recorded exactly as the verified credential carries them (never NULL, as at the baseline; the Staff foreign key and the role enum stay the database's check), and no system actor. A device row has a device kind, no staff id or email and no system actor. A system row has only the process name. These are the shapes `AuditLog_actor_shape_check` enforces, and they are validated before the write, so an invalid actor fails the mutation in its transaction instead of reaching the database.
- A staff action through a PIN-elevated tablet records `actorType = staff`, that staff member, `deviceKind = 'tablet_device'` (the value Nest records, `apps/api/src/audit/audit-actor.ts`) and the TabletDevice id from the verified token. A staff login session records the staff member and no device.
- Actor and device come only from the verified credential (`identity.Principal`). No header, query parameter or body field changes the recorded actor, actor class or device.
- One write path: `services/core-platform/internal/audit` holds the only Core `INSERT INTO "AuditLog"`, and no other Core production file names the `"AuditLog"` table.
- Existing behaviour stays the same: the same audit actions, resources, resource ids, before and after values, and the same transaction as the change. Every existing test passes unchanged.

**Never:**
- No schema change or migration, no change to `AuditLog_actor_shape_check`, `AuditLog_immutable` or the Staff foreign key, and no synthetic Staff row.
- No device or system actor manufactured for an action a staff member performed, and no staff identity for a device or process.
- No AuditLog row for payment-adapter results (payment result, refund result, reversal). FIN-36 records them in the append-only transition histories with the device identity, which Core already does; their paths are not changed.
- No change to authorization, routes, guards, tokens, `identity`, `server`, `cmd/api` wiring, `tests/testsupport`, existing tests, Nest (`apps/**`, including Story 15.2c), contracts, CI or the evaluator. No application identity, operating mode or order provenance (Stories 15.3 and 15.2a–d). Kitchen transitions are untouched (Story 15.5).
- No `t.Skip`, focus or lint suppression, and no existing test removed, renamed or weakened.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected AuditLog row | Error Handling |
|----------|--------------|----------------------|----------------|
| Staff login session | staff JWT (`sid`) on any audited route | `staff`, staff id, email and role; `deviceKind`, `deviceId` and `systemActor` NULL | — |
| Staff through a tablet | `tablet_staff` or `tablet_manager` JWT with `deviceId` = an active TabletDevice | `staff`, staff id, email and role, `deviceKind = 'tablet_device'`, `deviceId` = that TabletDevice id, `systemActor` NULL | — |
| Forged device or actor | header, query or body naming another device, actor or actor type | As the verified token alone determines | — |
| Staff-session-only administration | device enrollment, promotion creation (staff session only) | `staff`, no device | — |
| Device actor (model) | device kind (and optional id), no staff identity | `device`, kind and id; staff id and email NULL | — |
| System actor (model) | process name | `system`, `systemActor` only | — |
| Staff credential without an email | staff actor with id and role, empty email | `staff`, `actorEmail = ''` (as given, never NULL; as at the baseline) | — |
| Invalid actor | zero actor; staff without id or role; device id without kind; device without kind; system without name | Nothing written | The write returns an error wrapping `ErrInvalidActor`; the mutation's transaction does not commit |
| Raw device row naming a staff member | direct SQL | Refused by the database | SQLSTATE 23514 `AuditLog_actor_shape_check` |

</intent-contract>

## Code Map

- `services/core-platform/internal/{tables,orders,checks,shifts}/pgstore/store.go`, `payments/pgstore/store.go`, `payments/pgstore/adjustments.go` (`staffAudit`) -- the six tablet-reachable writers: each has its own `audit` helper with an `INSERT INTO "AuditLog"` of the staff columns only.
- `services/core-platform/internal/devices/pgstore/store.go`, `promotions/pgstore/store.go` -- the two staff-session-only writers (routes `admin` and `promotionAdmin`, `identity.RequireStaffSession`): same SQL; staff only, no device.
- Domain actor types: `tables.Actor` (`tables/service.go`), `orders.Actor` (`orders/service.go`, with `OnTablet`), `checks.Actor` (`checks/service.go`), `shifts.Actor` (`shifts/shift.go`), `payments.Staff` (`payments/service.go`), `refunds.Staff` (`refunds/service.go`).
- Handlers that build those actors from `identity.Principal`: `tablesapi`, `ordersapi`, `checksapi`, `shiftsapi`, `paymentsapi`, `refundsapi` (`handler.go`).
- `services/core-platform/internal/identity/token.go` -- `Principal{ID, Email, Role, Kind, DeviceID, ...}`; `KindTabletStaff`, `KindTabletManager` (the `sub` is the staff member and `deviceId` is the TabletDevice). Read only.
- `apps/api/prisma/migrations/20261010000000_audit_actor_types/migration.sql` -- the actor shape. Read only.
- `services/core-platform/tests/integration/table_sessions_test.go` (`tablesSetup`, `key`, `pgCode`) and `d1_test.go` (`admitStaff`, `admitAll`) -- helpers the new integration test may use. Read only.
- Payment-adapter result paths (`payments/pgstore/store.go` result transition; `adjustments.go` refund result and reversal) -- transitions with the device id and `payments.AdapterKind`; unchanged.

## Tasks & Acceptance

**Execution:**
- `services/core-platform/internal/audit/` (new) -- the API of the intent contract: the actor model (staff, possibly through a device; device; system), its validation against the database's shape, the device context of a verified principal, and the single AuditLog write in the caller's transaction.
- The eight writers -- delegate to `internal/audit`; keep their actions, resources, ids, before and after values and transactions.
- The six domain actor types and their handlers -- carry the device context derived from the verified principal to the writers.
- `services/core-platform/internal/audit/audit_test.go` (new) -- `TestActorShapes` (every valid shape validates), `TestInvalidActorsAreRefused` (each invalid shape of the matrix is refused with `ErrInvalidActor`) and `TestDeviceOfPrincipal` (tablet staff and manager name their TabletDevice; staff session, KDS and unelevated tablet name no device).
- `services/core-platform/tests/integration/audit_attribution_test.go` (new) -- `TestAuditActorRowsAgainstPostgres` (staff, staff through a tablet, device and system rows read back exactly; a zero actor writes nothing; a raw device row naming a staff member is refused with 23514 `AuditLog_actor_shape_check`) and `TestStaffViaTabletAuditRowAgainstPostgres` (through `server.Routes`, opening a table session with a `tablet_staff` token records the staff member and the tablet; with a staff session, no device).

**Acceptance Criteria:**
- Given a staff member on a PIN-elevated tablet, when they open a shift, open a table session, place an order, create a check, take a cash payment or request a refund in Core, then every AuditLog row of each action names that staff member with `deviceKind = 'tablet_device'` and the tablet's id from their verified token, whatever device or actor the request otherwise claims.
- Given a staff login session, when the same actions, a device enrollment or a promotion creation run, then every AuditLog row names the staff member and no device.
- Given the Core audit-actor model, when a staff, staff-through-device, device or system actor is written through `audit.Write`, then the row has exactly that class's identity; an invalid actor is refused with `ErrInvalidActor` and writes nothing; the database still refuses a device row that names a staff member.
- Given Core production code, when it is scanned, then the only `INSERT INTO "AuditLog"` is in `internal/audit` and no other file names the table.
- Given the candidate, when Core's gofmt, vet and full test suite run, then they pass with no fewer tests than the baseline, and nothing outside the authorized Core files and this spec changes.

## Verification

The evaluator runs the frozen objective: `core-gofmt`, `core-vet`, `core-tests` (race, full Core suite against PostgreSQL 18 and Redis, at least the baseline count), `audit-writer-single-path`, `audit-attribution-routes` (an evaluator-owned test, written into the candidate by the check and removed after it, that drives every audited route through `server.Routes` with `tablet_staff`, `tablet_manager` and staff-session tokens and reads the rows back) and `audit-actor-model` (an evaluator-owned test that writes every actor shape through the API above). The five required tests must pass on the candidate and fail or not run on the baseline.

## Spec Change Log

- 2026-10-06 -- Freeze candidate prepared (Story 15.1 objective preparation). Not frozen.

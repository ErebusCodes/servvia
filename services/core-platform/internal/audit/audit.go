// Package audit is Core's only writer of the existing AuditLog. Every row
// names the actor that really acted, in one of the three shapes the database
// enforces (AuditLog_actor_shape_check, migration 20261010000000):
//
//   - a staff member, possibly acting through a device (a staff member on a
//     PIN-elevated tablet stays the actor; the tablet is the device context);
//   - a device acting on its own, never with a staff identity;
//   - a system process, with nothing else.
//
// Actor and device come only from verified credentials (INV-3, DEC-OPS-21,
// O-21 item 4).
package audit

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"servvia/services/core-platform/internal/identity"
)

// DeviceKindTablet is the AuditLog deviceKind of a TabletDevice, the value
// the Nest audit actor records (apps/api/src/audit/audit-actor.ts).
const DeviceKindTablet = "tablet_device"

// Device identifies a device: its kind and, when it has a record, its id.
// The zero value is no device.
type Device struct{ Kind, ID string }

// DeviceOf is the device a verified principal acts through. A tablet
// elevated by a staff or manager PIN acts through its TabletDevice; every
// other principal names no device.
func DeviceOf(p identity.Principal) Device {
	if p.Kind == identity.KindTabletStaff || p.Kind == identity.KindTabletManager {
		return Device{Kind: DeviceKindTablet, ID: p.DeviceID}
	}
	return Device{}
}

type class uint8

const (
	none class = iota
	staffClass
	deviceClass
	systemClass
)

// Actor is who performed an audited change. The zero value is not an actor;
// build one with Staff, ByDevice or System.
type Actor struct {
	class           class
	id, email, role string
	device          Device
	systemName      string
}

// Staff is a named staff member, acting through via when it is not the zero
// Device. The id, email and role are recorded exactly as the verified
// credential carries them.
func Staff(id, email, role string, via Device) Actor {
	return Actor{class: staffClass, id: id, email: email, role: role, device: via}
}

// ByDevice is a device acting on its own. role is the role its credential
// grants, or "".
func ByDevice(d Device, role string) Actor {
	return Actor{class: deviceClass, role: role, device: d}
}

// System is a process of the platform itself, named by name.
func System(name string) Actor {
	return Actor{class: systemClass, systemName: name}
}

// ErrInvalidActor: the actor lacks the identity of its class, or carries
// another class's identity.
var ErrInvalidActor = errors.New("invalid audit actor")

// Validate reports whether the actor has exactly the identity of its class.
func (a Actor) Validate() error {
	switch a.class {
	case staffClass:
		if a.id == "" || a.role == "" {
			return fmt.Errorf("%w: a staff actor needs its id and role", ErrInvalidActor)
		}
		if a.device.ID != "" && a.device.Kind == "" {
			return fmt.Errorf("%w: a device id needs its device kind", ErrInvalidActor)
		}
	case deviceClass:
		if a.device.Kind == "" {
			return fmt.Errorf("%w: a device actor needs its device kind", ErrInvalidActor)
		}
	case systemClass:
		if a.systemName == "" {
			return fmt.Errorf("%w: a system actor needs its process name", ErrInvalidActor)
		}
	default:
		return fmt.Errorf("%w: no actor", ErrInvalidActor)
	}
	return nil
}

// Entry is one audited change.
type Entry struct {
	OrganizationID, VenueID      string
	Actor                        Actor
	Action, Resource, ResourceID string
	Before, After                map[string]any // Before may be nil
}

// Write validates the entry's actor and inserts the row in tx, the
// transaction of the change it records. An invalid actor writes nothing.
func Write(ctx context.Context, tx pgx.Tx, e Entry) error {
	a := e.Actor
	if err := a.Validate(); err != nil {
		return err
	}
	var before []byte
	if e.Before != nil {
		before, _ = json.Marshal(e.Before)
	}
	after, _ := json.Marshal(e.After)

	var actorType string
	var actorID, email, role, deviceKind, deviceID, systemName *string
	switch a.class {
	case staffClass:
		actorType = "staff"
		actorID, email, role = &a.id, &a.email, &a.role
		deviceKind, deviceID = optional(a.device.Kind), optional(a.device.ID)
	case deviceClass:
		actorType = "device"
		role, deviceKind, deviceID = optional(a.role), optional(a.device.Kind), optional(a.device.ID)
	case systemClass:
		actorType = "system"
		systemName = &a.systemName
	}
	_, err := tx.Exec(ctx, `INSERT INTO "AuditLog"
		(id, "organizationId", "venueId", "actorType", "actorId", "actorEmail", "actorRole",
		 "deviceKind", "deviceId", "systemActor", action, resource, "resourceId", before, after)
		VALUES ($1, $2, $3, $4::"AuditActorType", $5, $6, $7::"StaffRole", $8, $9, $10, $11, $12, $13, $14, $15)`,
		newID(), e.OrganizationID, e.VenueID, actorType, actorID, email, role,
		deviceKind, deviceID, systemName, e.Action, e.Resource, e.ResourceID, before, after)
	return err
}

// optional is NULL for an absent value.
func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// newID is a random version 4 UUID, the form of Prisma's @default(uuid()).
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

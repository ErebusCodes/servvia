// Package pgstore implements devices.Repository on the Prisma-managed
// "Device" and "Terminal" tables (migration 20261005000000_devices_terminals).
//
// Invariants rest on the database: request keys are unique per venue, a
// terminal code is unique per venue, a device is bound to at most one
// terminal (unique deviceId), and a bound device is a pos_terminal of the
// terminal's venue (composite foreign key plus CHECK). Changes lock the row
// FOR UPDATE and check the version. The credential verifier is read only by
// Credential and never selected into a Device.
package pgstore

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/devices"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var _ devices.Repository = (*Store)(nil)

const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
	maxList               = 500
)

// deviceSelect never includes the credential verifier.
const deviceSelect = `SELECT d.id, d."venueId", d.kind::text, d."displayName", d.status::text, d."enrollRequestKey", d.version,
       d."credentialRotatedAt", d."createdByStaffId", d."revokedAt", d."revokedByStaffId",
       (SELECT t.id FROM "Terminal" t WHERE t."deviceId" = d.id), d."createdAt", d."updatedAt"
FROM "Device" d`

const terminalSelect = `SELECT id, "venueId", name, code, status::text, "deviceId", "createRequestKey", version, "disabledAt",
       "createdAt", "updatedAt" FROM "Terminal"`

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanDevice(row pgx.CollectableRow) (devices.Device, error) {
	var d devices.Device
	var kind, status string
	err := row.Scan(&d.ID, &d.VenueID, &kind, &d.DisplayName, &status, &d.EnrollRequestKey, &d.Version, &d.CredentialRotatedAt,
		&d.CreatedByStaffID, &d.RevokedAt, &d.RevokedByStaffID, &d.TerminalID, &d.CreatedAt, &d.UpdatedAt)
	d.Kind, d.Status = devices.Kind(kind), devices.Status(status)
	return d, err
}

func scanTerminal(row pgx.CollectableRow) (devices.Terminal, error) {
	var t devices.Terminal
	var status string
	err := row.Scan(&t.ID, &t.VenueID, &t.Name, &t.Code, &status, &t.DeviceID, &t.CreateRequestKey, &t.Version, &t.DisabledAt,
		&t.CreatedAt, &t.UpdatedAt)
	t.Status = devices.TerminalStatus(status)
	return t, err
}

func oneOf[T any](ctx context.Context, q querier, scan pgx.RowToFunc[T], notFound error, sql string, args ...any) (T, error) {
	var zero T
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return zero, fmt.Errorf("query: %w", err)
	}
	v, err := pgx.CollectExactlyOneRow(rows, scan)
	if errors.Is(err, pgx.ErrNoRows) {
		return zero, notFound
	}
	if err != nil {
		return zero, fmt.Errorf("read: %w", err)
	}
	return v, nil
}

func (st *Store) Credential(ctx context.Context, deviceID string) (devices.Credential, bool, error) {
	var c devices.Credential
	var kind, status string
	err := st.pool.QueryRow(ctx, `SELECT id, "venueId", kind::text, status::text, "credentialHash" FROM "Device" WHERE id = $1`,
		deviceID).Scan(&c.DeviceID, &c.VenueID, &kind, &status, &c.Verifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return devices.Credential{}, false, nil
	}
	if err != nil {
		return devices.Credential{}, false, fmt.Errorf("load device credential: %w", err)
	}
	c.Kind, c.Status = devices.Kind(kind), devices.Status(status)
	return c, true, nil
}

// --- devices -----------------------------------------------------------------

func (st *Store) FindDeviceByKey(ctx context.Context, venueID, key string) (devices.Device, bool, error) {
	d, err := oneOf(ctx, st.pool, scanDevice, devices.ErrDeviceNotFound, deviceSelect+` WHERE d."venueId" = $1 AND d."enrollRequestKey" = $2`, venueID, key)
	if errors.Is(err, devices.ErrDeviceNotFound) {
		return devices.Device{}, false, nil
	}
	return d, err == nil, err
}

func (st *Store) GetDevice(ctx context.Context, venueID, id string) (devices.Device, error) {
	return oneOf(ctx, st.pool, scanDevice, devices.ErrDeviceNotFound, deviceSelect+` WHERE d."venueId" = $1 AND d.id = $2`, venueID, id)
}

func (st *Store) ListDevices(ctx context.Context, venueID string, f devices.DeviceFilter) ([]devices.Device, error) {
	rows, err := st.pool.Query(ctx, deviceSelect+` WHERE d."venueId" = $1 AND ($2 = '' OR d.kind::text = $2)
		AND ($3 = '' OR d.status::text = $3) ORDER BY d."createdAt", d.id LIMIT $4`, venueID, string(f.Kind), string(f.Status), maxList)
	if err != nil {
		return nil, fmt.Errorf("query devices: %w", err)
	}
	return pgx.CollectRows(rows, scanDevice)
}

func (st *Store) Enroll(ctx context.Context, n devices.NewDevice) (devices.Device, error) {
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO "Device" (id, "venueId", kind, "displayName", "credentialHash", "enrollRequestKey",
			"createdByStaffId", "updatedAt") VALUES ($1, $2, $3::"DeviceKind", $4, $5, $6, $7, now())`,
			n.ID, n.Scope.VenueID, string(n.Kind), n.DisplayName, n.Verifier, n.RequestKey, n.Actor.StaffID); err != nil {
			return err
		}
		return audit(ctx, tx, n.Scope, n.Actor, "DEVICE_ENROLLED", "device", n.ID, nil,
			map[string]any{"deviceId": n.ID, "kind": n.Kind, "displayName": n.DisplayName})
	})
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return st.GetDevice(ctx, n.Scope.VenueID, n.ID)
	case errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == "Device_venueId_enrollRequestKey_key":
		return devices.Device{}, devices.ErrDuplicateKey
	case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation:
		return devices.Device{}, devices.ErrUnknownActor
	}
	return devices.Device{}, err
}

// lockDevice locks a device of the venue and checks the version the caller
// read. A revoked device is returned as is: the caller decides.
func lockDevice(ctx context.Context, tx pgx.Tx, c devices.Change) (devices.Device, error) {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM "Device" WHERE "venueId" = $1 AND id = $2 FOR UPDATE`, c.Scope.VenueID, c.ID); err != nil {
		return devices.Device{}, fmt.Errorf("lock device: %w", err)
	}
	return oneOf(ctx, tx, scanDevice, devices.ErrDeviceNotFound, deviceSelect+` WHERE d."venueId" = $1 AND d.id = $2`, c.Scope.VenueID, c.ID)
}

func (st *Store) Rotate(ctx context.Context, c devices.Change, verifier string) (devices.Device, error) {
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		d, err := lockDevice(ctx, tx, c)
		if err != nil {
			return err
		}
		if d.Status != devices.StatusActive {
			return &devices.NotActiveError{Status: string(d.Status)}
		}
		if d.Version != c.ExpectedVersion {
			return &devices.VersionConflictError{Current: d.Version}
		}
		if _, err := tx.Exec(ctx, `UPDATE "Device" SET "credentialHash" = $2, "credentialRotatedAt" = now(), version = version + 1,
			"updatedAt" = now() WHERE id = $1`, c.ID, verifier); err != nil {
			return fmt.Errorf("rotate credential: %w", err)
		}
		return audit(ctx, tx, c.Scope, c.Actor, "DEVICE_CREDENTIAL_ROTATED", "device", c.ID,
			map[string]any{"version": d.Version}, map[string]any{"version": d.Version + 1})
	})
	if err != nil {
		return devices.Device{}, mapActor(err)
	}
	return st.GetDevice(ctx, c.Scope.VenueID, c.ID)
}

func (st *Store) Revoke(ctx context.Context, c devices.Change) (devices.Device, bool, error) {
	changed := false
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		d, err := lockDevice(ctx, tx, c)
		if err != nil {
			return err
		}
		if d.Status == devices.StatusRevoked {
			return nil // a retried revoke
		}
		if d.Version != c.ExpectedVersion {
			return &devices.VersionConflictError{Current: d.Version}
		}
		if _, err := tx.Exec(ctx, `UPDATE "Device" SET status = 'revoked', "revokedAt" = now(), "revokedByStaffId" = $2,
			version = version + 1, "updatedAt" = now() WHERE id = $1`, c.ID, c.Actor.StaffID); err != nil {
			return fmt.Errorf("revoke device: %w", err)
		}
		changed = true
		return audit(ctx, tx, c.Scope, c.Actor, "DEVICE_REVOKED", "device", c.ID,
			map[string]any{"status": d.Status, "version": d.Version}, map[string]any{"status": devices.StatusRevoked, "version": d.Version + 1})
	})
	if err != nil {
		return devices.Device{}, false, mapActor(err)
	}
	d, err := st.GetDevice(ctx, c.Scope.VenueID, c.ID)
	return d, changed, err
}

// --- terminals ---------------------------------------------------------------

func (st *Store) FindTerminalByKey(ctx context.Context, venueID, key string) (devices.Terminal, bool, error) {
	t, err := oneOf(ctx, st.pool, scanTerminal, devices.ErrTerminalNotFound, terminalSelect+` WHERE "venueId" = $1 AND "createRequestKey" = $2`, venueID, key)
	if errors.Is(err, devices.ErrTerminalNotFound) {
		return devices.Terminal{}, false, nil
	}
	return t, err == nil, err
}

func (st *Store) GetTerminal(ctx context.Context, venueID, id string) (devices.Terminal, error) {
	return oneOf(ctx, st.pool, scanTerminal, devices.ErrTerminalNotFound, terminalSelect+` WHERE "venueId" = $1 AND id = $2`, venueID, id)
}

func (st *Store) ListTerminals(ctx context.Context, venueID string, f devices.TerminalFilter) ([]devices.Terminal, error) {
	rows, err := st.pool.Query(ctx, terminalSelect+` WHERE "venueId" = $1 AND ($2 = '' OR status::text = $2)
		ORDER BY code LIMIT $3`, venueID, string(f.Status), maxList)
	if err != nil {
		return nil, fmt.Errorf("query terminals: %w", err)
	}
	return pgx.CollectRows(rows, scanTerminal)
}

// lockBindable locks a device FOR SHARE (so it cannot be revoked meanwhile)
// and requires it active, a POS device, and at the venue. The database
// verifies kind and venue again through the composite foreign key.
func lockBindable(ctx context.Context, tx pgx.Tx, venueID, deviceID string) error {
	var kind, status, venue string
	err := tx.QueryRow(ctx, `SELECT kind::text, status::text, "venueId" FROM "Device" WHERE id = $1 FOR SHARE`, deviceID).
		Scan(&kind, &status, &venue)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (venue != venueID || kind != string(devices.KindPOSTerminal) || status != string(devices.StatusActive))) {
		return devices.ErrDeviceNotBindable
	}
	return err
}

func (st *Store) CreateTerminal(ctx context.Context, n devices.NewTerminal) (devices.Terminal, error) {
	id := newID()
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		var kind *string
		if n.DeviceID != nil {
			if err := lockBindable(ctx, tx, n.Scope.VenueID, *n.DeviceID); err != nil {
				return err
			}
			k := string(devices.KindPOSTerminal)
			kind = &k
		}
		if _, err := tx.Exec(ctx, `INSERT INTO "Terminal" (id, "venueId", name, code, "deviceId", "deviceKind", "createRequestKey", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $6::"DeviceKind", $7, now())`,
			id, n.Scope.VenueID, n.Name, n.Code, n.DeviceID, kind, n.RequestKey); err != nil {
			return err
		}
		return audit(ctx, tx, n.Scope, n.Actor, "TERMINAL_CREATED", "terminal", id, nil,
			map[string]any{"terminalId": id, "name": n.Name, "code": n.Code, "deviceId": n.DeviceID})
	})
	if err != nil {
		return devices.Terminal{}, mapTerminalError(err, n.Code)
	}
	return st.GetTerminal(ctx, n.Scope.VenueID, id)
}

func lockTerminal(ctx context.Context, tx pgx.Tx, c devices.Change) (devices.Terminal, error) {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM "Terminal" WHERE "venueId" = $1 AND id = $2 FOR UPDATE`, c.Scope.VenueID, c.ID); err != nil {
		return devices.Terminal{}, fmt.Errorf("lock terminal: %w", err)
	}
	return oneOf(ctx, tx, scanTerminal, devices.ErrTerminalNotFound, terminalSelect+` WHERE "venueId" = $1 AND id = $2`, c.Scope.VenueID, c.ID)
}

func (st *Store) DisableTerminal(ctx context.Context, c devices.Change) (devices.Terminal, bool, error) {
	changed := false
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		t, err := lockTerminal(ctx, tx, c)
		if err != nil {
			return err
		}
		if t.Status == devices.TerminalDisabled {
			return nil // a retried disable
		}
		if t.Version != c.ExpectedVersion {
			return &devices.VersionConflictError{Current: t.Version}
		}
		if _, err := tx.Exec(ctx, `UPDATE "Terminal" SET status = 'disabled', "disabledAt" = now(), version = version + 1,
			"updatedAt" = now() WHERE id = $1`, c.ID); err != nil {
			return fmt.Errorf("disable terminal: %w", err)
		}
		changed = true
		return audit(ctx, tx, c.Scope, c.Actor, "TERMINAL_DISABLED", "terminal", c.ID,
			map[string]any{"status": t.Status, "version": t.Version}, map[string]any{"status": devices.TerminalDisabled, "version": t.Version + 1})
	})
	if err != nil {
		return devices.Terminal{}, false, mapActor(err)
	}
	t, err := st.GetTerminal(ctx, c.Scope.VenueID, c.ID)
	return t, changed, err
}

func (st *Store) BindDevice(ctx context.Context, c devices.Change, deviceID *string) (devices.Terminal, error) {
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		t, err := lockTerminal(ctx, tx, c)
		if err != nil {
			return err
		}
		if t.Version != c.ExpectedVersion {
			return &devices.VersionConflictError{Current: t.Version}
		}
		action := "TERMINAL_DEVICE_UNBOUND"
		var kind *string
		if deviceID != nil {
			if t.Status != devices.TerminalActive {
				return &devices.NotActiveError{Status: string(t.Status)}
			}
			if err := lockBindable(ctx, tx, c.Scope.VenueID, *deviceID); err != nil {
				return err
			}
			k := string(devices.KindPOSTerminal)
			kind, action = &k, "TERMINAL_DEVICE_BOUND"
		}
		if _, err := tx.Exec(ctx, `UPDATE "Terminal" SET "deviceId" = $2, "deviceKind" = $3::"DeviceKind", version = version + 1,
			"updatedAt" = now() WHERE id = $1`, c.ID, deviceID, kind); err != nil {
			return err
		}
		return audit(ctx, tx, c.Scope, c.Actor, action, "terminal", c.ID,
			map[string]any{"deviceId": t.DeviceID, "version": t.Version}, map[string]any{"deviceId": deviceID, "version": t.Version + 1})
	})
	if err != nil {
		return devices.Terminal{}, mapTerminalError(err, "")
	}
	return st.GetTerminal(ctx, c.Scope.VenueID, c.ID)
}

func mapTerminalError(err error, code string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
		switch pgErr.ConstraintName {
		case "Terminal_venueId_createRequestKey_key":
			return devices.ErrDuplicateKey
		case "Terminal_venueId_code_key":
			return &devices.CodeTakenError{Code: code}
		case "Terminal_deviceId_key":
			return &devices.DeviceBoundError{}
		}
	}
	return mapActor(err)
}

func mapActor(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation && pgErr.ConstraintName == "AuditLog_actorId_fkey" {
		return devices.ErrUnknownActor
	}
	return err
}

// audit records an administrative change in the existing AuditLog, in its
// transaction. Never a credential or verifier.
func audit(ctx context.Context, tx pgx.Tx, sc devices.Scope, a devices.Actor, action, resource, id string, before, after map[string]any) error {
	var beforeJSON []byte
	if before != nil {
		beforeJSON, _ = json.Marshal(before)
	}
	afterJSON, _ := json.Marshal(after)
	_, err := tx.Exec(ctx, `INSERT INTO "AuditLog"
		(id, "organizationId", "venueId", "actorId", "actorEmail", "actorRole", action, resource, "resourceId", before, after)
		VALUES ($1, $2, $3, $4, $5, $6::"StaffRole", $7, $8, $9, $10, $11)`,
		newID(), sc.OrganizationID, sc.VenueID, a.StaffID, a.Email, a.Role, action, resource, id, beforeJSON, afterJSON)
	return err
}

// NewID is a random v4 UUID, the form of every Prisma @default(uuid()) id.
func NewID() string { return newID() }

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

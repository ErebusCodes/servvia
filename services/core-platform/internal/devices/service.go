package devices

import (
	"context"
	"errors"
)

// Scope is the tenancy of every operation.
type Scope struct {
	OrganizationID string
	VenueID        string
}

// Actor is the staff member administering devices and terminals.
type Actor struct {
	StaffID string
	Email   string
	Role    string
}

// NewDevice is a validated enrollment ready to persist, with its id and
// credential verifier already minted (the credential embeds the id).
type NewDevice struct {
	Scope       Scope
	ID          string
	Kind        Kind
	DisplayName string
	Verifier    string
	RequestKey  string
	Actor       Actor
}

// NewTerminal is a validated terminal creation.
type NewTerminal struct {
	Scope      Scope
	Name       string
	Code       string
	DeviceID   *string
	RequestKey string
	Actor      Actor
}

// Change is a version-checked change to one device or terminal.
type Change struct {
	Scope           Scope
	ID              string
	ExpectedVersion int
	Actor           Actor
}

// DeviceFilter / TerminalFilter select within a venue.
type DeviceFilter struct {
	Kind   Kind
	Status Status
}

type TerminalFilter struct {
	Status TerminalStatus
}

// Credential is what the device authentication needs: never exposed.
type Credential struct {
	DeviceID string
	VenueID  string
	Kind     Kind
	Status   Status
	Verifier string
}

// Repository persists devices and terminals. Every change is one transaction
// with its AuditLog row; changes lock the row (FOR UPDATE) and check the
// version. Uniqueness (request keys, terminal codes, one terminal per
// device) and the bound device's kind and venue are database constraints.
type Repository interface {
	Credential(ctx context.Context, deviceID string) (Credential, bool, error)

	FindDeviceByKey(ctx context.Context, venueID, key string) (Device, bool, error)
	GetDevice(ctx context.Context, venueID, id string) (Device, error)
	ListDevices(ctx context.Context, venueID string, f DeviceFilter) ([]Device, error)
	Enroll(ctx context.Context, n NewDevice) (Device, error)
	// Rotate replaces the verifier of an active device (version-checked).
	Rotate(ctx context.Context, c Change, verifier string) (Device, error)
	// Revoke revokes a device; changed=false when it already was.
	Revoke(ctx context.Context, c Change) (Device, bool, error)

	FindTerminalByKey(ctx context.Context, venueID, key string) (Terminal, bool, error)
	GetTerminal(ctx context.Context, venueID, id string) (Terminal, error)
	ListTerminals(ctx context.Context, venueID string, f TerminalFilter) ([]Terminal, error)
	CreateTerminal(ctx context.Context, n NewTerminal) (Terminal, error)
	// DisableTerminal disables; changed=false when it already was.
	DisableTerminal(ctx context.Context, c Change) (Terminal, bool, error)
	// BindDevice binds (deviceID) or unbinds (nil) the terminal's device.
	BindDevice(ctx context.Context, c Change, deviceID *string) (Terminal, error)
}

type Service struct {
	repo          Repository
	writesEnabled bool
	newID         func() string
}

func NewService(repo Repository, writesEnabled bool, newID func() string) *Service {
	return &Service{repo: repo, writesEnabled: writesEnabled, newID: newID}
}

// Authenticate resolves a device credential to its registered device and
// requires it active, of kind, and registered at venueID. The venue comes
// from canonical storage, never from the caller.
func (s *Service) Authenticate(ctx context.Context, raw string, kind Kind, venueID string) (Credential, error) {
	id, secret, ok := ParseCredential(raw)
	if !ok {
		return Credential{}, ErrUnauthenticated
	}
	c, found, err := s.repo.Credential(ctx, id)
	if err != nil {
		return Credential{}, err
	}
	verifier := dummyVerifier
	if found {
		verifier = c.Verifier
	}
	if !Matches(verifier, secret) || !found || c.Status != StatusActive {
		return Credential{}, ErrUnauthenticated
	}
	if c.Kind != kind {
		return Credential{}, ErrWrongKind
	}
	if c.VenueID != venueID {
		return Credential{}, ErrWrongVenue
	}
	return c, nil
}

// Enroll registers a device and returns its credential, once. A replay of
// the same request returns the device with an empty credential: the
// plaintext is never shown twice (rotate to recover a lost one).
func (s *Service) Enroll(ctx context.Context, scope Scope, actor Actor, kind Kind, displayName, key string) (Device, string, bool, error) {
	if !kind.Valid() {
		return Device{}, "", false, invalid("kind must be one of pos_terminal, order_tablet, kds, payment_adapter")
	}
	if err := validName("displayName", displayName); err != nil {
		return Device{}, "", false, err
	}
	if err := validKey(key); err != nil {
		return Device{}, "", false, err
	}
	if !s.writesEnabled {
		return Device{}, "", false, ErrWritesDisabled
	}
	replay := func(d Device) (Device, string, bool, error) {
		if d.Kind == kind && d.DisplayName == displayName {
			return d, "", false, nil
		}
		return Device{}, "", false, &IdempotencyConflictError{Key: key, ID: d.ID}
	}
	if d, found, err := s.repo.FindDeviceByKey(ctx, scope.VenueID, key); err != nil {
		return Device{}, "", false, err
	} else if found {
		return replay(d)
	}
	id := s.newID()
	plaintext, verifier := NewCredential(id)
	d, err := s.repo.Enroll(ctx, NewDevice{Scope: scope, ID: id, Kind: kind, DisplayName: displayName, Verifier: verifier,
		RequestKey: key, Actor: actor})
	if errors.Is(err, ErrDuplicateKey) {
		existing, found, ferr := s.repo.FindDeviceByKey(ctx, scope.VenueID, key)
		if ferr != nil || !found {
			return Device{}, "", false, errors.Join(err, ferr)
		}
		return replay(existing)
	}
	if err != nil {
		return Device{}, "", false, err
	}
	return d, plaintext, true, nil
}

func (s *Service) GetDevice(ctx context.Context, scope Scope, id string) (Device, error) {
	return s.repo.GetDevice(ctx, scope.VenueID, id)
}

func (s *Service) ListDevices(ctx context.Context, scope Scope, f DeviceFilter) ([]Device, error) {
	if f.Kind != "" && !f.Kind.Valid() {
		return nil, invalid("kind must be one of pos_terminal, order_tablet, kds, payment_adapter")
	}
	if f.Status != "" && f.Status != StatusActive && f.Status != StatusRevoked {
		return nil, invalid("status must be one of active, revoked")
	}
	return s.repo.ListDevices(ctx, scope.VenueID, f)
}

// Rotate issues a new credential; the previous one stops working at once.
func (s *Service) Rotate(ctx context.Context, c Change) (Device, string, error) {
	if err := s.change(c); err != nil {
		return Device{}, "", err
	}
	plaintext, verifier := NewCredential(c.ID)
	d, err := s.repo.Rotate(ctx, c, verifier)
	if err != nil {
		return Device{}, "", err
	}
	return d, plaintext, nil
}

// Revoke revokes a device for good. changed=false when it already was.
func (s *Service) Revoke(ctx context.Context, c Change) (Device, bool, error) {
	if err := s.change(c); err != nil {
		return Device{}, false, err
	}
	return s.repo.Revoke(ctx, c)
}

func (s *Service) change(c Change) error {
	if c.ExpectedVersion < 1 {
		return invalid("version must be a positive integer")
	}
	if !s.writesEnabled {
		return ErrWritesDisabled
	}
	return nil
}

// CreateTerminal creates a terminal, optionally bound to a POS device, or
// returns the one this key already created for the same request.
func (s *Service) CreateTerminal(ctx context.Context, n NewTerminal) (Terminal, bool, error) {
	if err := validName("name", n.Name); err != nil {
		return Terminal{}, false, err
	}
	if !ValidTerminalCode(n.Code) {
		return Terminal{}, false, invalid("code must be 1 to 20 characters of A-Z, 0-9 and -, not starting with -")
	}
	if err := validKey(n.RequestKey); err != nil {
		return Terminal{}, false, err
	}
	if !s.writesEnabled {
		return Terminal{}, false, ErrWritesDisabled
	}
	replay := func(t Terminal) (Terminal, bool, error) {
		sameDevice := (t.DeviceID == nil) == (n.DeviceID == nil) && (t.DeviceID == nil || *t.DeviceID == *n.DeviceID)
		if t.Name == n.Name && t.Code == n.Code && sameDevice {
			return t, false, nil
		}
		return Terminal{}, false, &IdempotencyConflictError{Key: n.RequestKey, ID: t.ID}
	}
	if t, found, err := s.repo.FindTerminalByKey(ctx, n.Scope.VenueID, n.RequestKey); err != nil {
		return Terminal{}, false, err
	} else if found {
		return replay(t)
	}
	t, err := s.repo.CreateTerminal(ctx, n)
	if errors.Is(err, ErrDuplicateKey) {
		existing, found, ferr := s.repo.FindTerminalByKey(ctx, n.Scope.VenueID, n.RequestKey)
		if ferr != nil || !found {
			return Terminal{}, false, errors.Join(err, ferr)
		}
		return replay(existing)
	}
	if err != nil {
		return Terminal{}, false, err
	}
	return t, true, nil
}

func (s *Service) GetTerminal(ctx context.Context, scope Scope, id string) (Terminal, error) {
	return s.repo.GetTerminal(ctx, scope.VenueID, id)
}

func (s *Service) ListTerminals(ctx context.Context, scope Scope, f TerminalFilter) ([]Terminal, error) {
	if f.Status != "" && f.Status != TerminalActive && f.Status != TerminalDisabled {
		return nil, invalid("status must be one of active, disabled")
	}
	return s.repo.ListTerminals(ctx, scope.VenueID, f)
}

func (s *Service) DisableTerminal(ctx context.Context, c Change) (Terminal, bool, error) {
	if err := s.change(c); err != nil {
		return Terminal{}, false, err
	}
	return s.repo.DisableTerminal(ctx, c)
}

// BindDevice binds a POS device to a terminal, or unbinds with deviceID nil.
func (s *Service) BindDevice(ctx context.Context, c Change, deviceID *string) (Terminal, error) {
	if err := s.change(c); err != nil {
		return Terminal{}, err
	}
	if deviceID != nil && *deviceID == "" {
		return Terminal{}, invalid("deviceId must not be empty")
	}
	return s.repo.BindDevice(ctx, c, deviceID)
}

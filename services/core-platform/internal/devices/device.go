// Package devices is Servvia Core's device and terminal domain (ADR 0001,
// Phase D8).
//
// A Device is an enrolled installation that authenticates to Servvia: a POS
// installation, an Order Tablet, a KDS screen, a payment adapter. It is the
// permanent device registry (the NestJS TabletDevice and KDS PIN are
// transitional identities it supersedes as clients migrate). Its kind says
// what the installation is; it never grants a staff role: a staff-operated
// device still needs a staff identity for staff actions.
//
// A Terminal is a logical POS station at a venue ("Front Counter"). It is not
// hardware; it may be bound to one POS device, and a shift may record the
// terminal it is worked from.
//
// There is no hardware, printer, payment-terminal or external-POS concept
// here. Persistence is behind Repository (devices/pgstore); transport and the
// device-credential middleware are devices/devicesapi.
package devices

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"regexp"
	"strings"
	"time"
)

// Kind is what an installation is. Only kinds with a use today; others are
// added when their phases need an identity.
type Kind string

const (
	KindPOSTerminal    Kind = "pos_terminal"
	KindOrderTablet    Kind = "order_tablet"
	KindKDS            Kind = "kds"
	KindPaymentAdapter Kind = "payment_adapter"
)

// Valid reports whether k is a device kind.
func (k Kind) Valid() bool {
	switch k {
	case KindPOSTerminal, KindOrderTablet, KindKDS, KindPaymentAdapter:
		return true
	}
	return false
}

// Status is a device's lifecycle: active, then revoked (final).
type Status string

const (
	StatusActive  Status = "active"
	StatusRevoked Status = "revoked"
)

// Device is one enrolled installation. It never carries its credential.
type Device struct {
	ID                  string
	VenueID             string
	Kind                Kind
	DisplayName         string
	Status              Status
	EnrollRequestKey    string
	Version             int
	CredentialRotatedAt *time.Time
	CreatedByStaffID    string
	RevokedAt           *time.Time
	RevokedByStaffID    *string
	// TerminalID is the terminal a POS device is bound to, if any.
	TerminalID *string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// TerminalStatus is a terminal's lifecycle: active, then disabled (final).
type TerminalStatus string

const (
	TerminalActive   TerminalStatus = "active"
	TerminalDisabled TerminalStatus = "disabled"
)

// Terminal is one logical POS station.
type Terminal struct {
	ID               string
	VenueID          string
	Name             string
	Code             string
	Status           TerminalStatus
	DeviceID         *string
	CreateRequestKey string
	Version          int
	DisabledAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// --- credentials -------------------------------------------------------------

// credentialPrefix versions the credential format.
const credentialPrefix = "sdv1"

// NewCredential returns a device's plaintext credential (shown once) and the
// verifier stored for it: sha256 of 32 random bytes. A 256-bit random secret
// cannot be guessed or brute-forced, so a fast hash is the right verifier.
func NewCredential(deviceID string) (plaintext, verifier string) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("devices: no randomness: " + err.Error())
	}
	secret := base64.RawURLEncoding.EncodeToString(b[:])
	return credentialPrefix + "." + deviceID + "." + secret, Verifier(secret)
}

// Verifier is the stored form of a secret.
func Verifier(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

var secretPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// ParseCredential splits a credential into its device id and secret. ok is
// false for anything not in the credential format.
func ParseCredential(raw string) (deviceID, secret string, ok bool) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 || parts[0] != credentialPrefix || parts[1] == "" || len(parts[1]) > 64 || !secretPattern.MatchString(parts[2]) {
		return "", "", false
	}
	return parts[1], parts[2], true
}

// Matches compares a secret with a stored verifier in constant time.
func Matches(verifier, secret string) bool {
	return subtle.ConstantTimeCompare([]byte(Verifier(secret)), []byte(verifier)) == 1
}

// dummyVerifier is compared against when no device matches, so an unknown
// device costs the same as a wrong secret.
var dummyVerifier = Verifier("no-such-device")

// --- validation --------------------------------------------------------------

// Bounds.
const (
	MinKeyLength = 16
	MaxKeyLength = 255
	MaxNameRunes = 80
)

var terminalCodePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9-]{0,19}$`)

// ValidTerminalCode reports whether code is a terminal code: 1 to 20 of
// A-Z, 0-9 and -, not starting with -. The database enforces the same.
func ValidTerminalCode(code string) bool { return terminalCodePattern.MatchString(code) }

func validName(field, name string) error {
	if n := len([]rune(strings.TrimSpace(name))); n < 1 || n > MaxNameRunes || strings.TrimSpace(name) != name {
		return invalid(field + " must be 1 to 80 characters, without leading or trailing spaces")
	}
	return nil
}

func validKey(key string) error {
	if n := len([]rune(key)); n < MinKeyLength || n > MaxKeyLength {
		return invalid("idempotencyKey must be a string of 16 to 255 characters")
	}
	return nil
}

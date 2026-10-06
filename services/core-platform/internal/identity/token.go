// Package identity verifies access tokens issued by the NestJS API, so Go
// endpoints accept exactly the sessions and device tokens that exist today
// without a second login system.
//
// Contract: contracts/schemas/auth-token-claims.schema.json. Behaviour mirrors
// apps/api/src/auth/strategies/jwt.strategy.ts: HS256 only, the shared
// JWT_ACCESS_SECRET, expiry enforced with no leeway, and `sub`, `role` and
// `organizationId` required. `kind` and `role` are not checked against their
// enums, because Nest does not check them either.
//
// One deliberate tightening: a token without `exp` is rejected. Nest never
// issues one (every sign call sets expiresIn), so no real token is affected.
package identity

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Kind is the `kind` claim. Staff sessions omit it (KindStaffSession).
type Kind string

const (
	KindStaffSession  Kind = ""
	KindStaff         Kind = "staff" // declared in the Nest type, never issued
	KindKDSDevice     Kind = "kds_device"
	KindTabletDevice  Kind = "tablet_device"
	KindTabletStaff   Kind = "tablet_staff"
	KindTabletManager Kind = "tablet_manager"
)

// deviceScopedKinds mirrors DEVICE_SCOPED_KINDS in
// apps/api/src/auth/utils/resolve-venue-scope.ts.
var deviceScopedKinds = map[Kind]struct{}{
	KindKDSDevice: {}, KindTabletDevice: {}, KindTabletStaff: {}, KindTabletManager: {},
}

// DeviceScoped reports whether the token is pinned to one venue.
func (k Kind) DeviceScoped() bool {
	_, ok := deviceScopedKinds[k]
	return ok
}

// Principal is the verified caller, equivalent to Nest's AuthenticatedUser.
type Principal struct {
	ID             string
	Email          string
	Role           string
	OrganizationID string
	VenueID        string
	Kind           Kind
	DeviceID       string
	ActingStaffID  string
	// SessionID is the `sid` claim of a staff login session, revoked on
	// logout (Story 2.5). Other kinds do not carry it.
	SessionID string
	ExpiresAt time.Time
}

type claims struct {
	Email          string `json:"email"`
	Role           string `json:"role"`
	OrganizationID string `json:"organizationId"`
	VenueID        string `json:"venueId,omitempty"`
	Kind           string `json:"kind,omitempty"`
	DeviceID       string `json:"deviceId,omitempty"`
	ActingStaffID  string `json:"actingStaffId,omitempty"`
	SessionID      string `json:"sid,omitempty"`
	jwt.RegisteredClaims
}

var (
	// ErrUnauthorized covers a missing, unparseable, wrongly signed or expired
	// token. Nest answers these with {"statusCode":401,"message":"Unauthorized"}.
	ErrUnauthorized = errors.New("Unauthorized")
	// ErrMalformedPayload is Nest's "Malformed token payload" 401.
	ErrMalformedPayload = errors.New("Malformed token payload")
)

// Verifier checks HS256 access tokens signed with JWT_ACCESS_SECRET.
type Verifier struct {
	secret []byte
	parser *jwt.Parser
	now    func() time.Time
}

func NewVerifier(secret string) *Verifier {
	v := &Verifier{secret: []byte(secret), now: time.Now}
	v.parser = jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(0),
		jwt.WithTimeFunc(func() time.Time { return v.now() }),
	)
	return v
}

// Verify returns the principal for a raw token (without the "Bearer " prefix).
func (v *Verifier) Verify(raw string) (Principal, error) {
	var c claims
	if _, err := v.parser.ParseWithClaims(raw, &c, func(*jwt.Token) (any, error) { return v.secret, nil }); err != nil {
		return Principal{}, fmt.Errorf("%w: %v", ErrUnauthorized, err)
	}
	if c.Subject == "" || c.Role == "" || c.OrganizationID == "" {
		return Principal{}, ErrMalformedPayload
	}
	return Principal{
		ID:             c.Subject,
		Email:          c.Email,
		Role:           c.Role,
		OrganizationID: c.OrganizationID,
		VenueID:        c.VenueID,
		Kind:           Kind(c.Kind),
		DeviceID:       c.DeviceID,
		ActingStaffID:  c.ActingStaffID,
		SessionID:      c.SessionID,
		ExpiresAt:      c.ExpiresAt.Time,
	}, nil
}

// bearerPattern mirrors passport-jwt's parseAuthHeader: the first two
// whitespace-separated tokens, scheme compared case-insensitively.
var bearerPattern = regexp.MustCompile(`(\S+)\s+(\S+)`)

// BearerToken extracts the token from an Authorization header value.
func BearerToken(header string) (string, bool) {
	m := bearerPattern.FindStringSubmatch(header)
	if m == nil || !strings.EqualFold(m[1], "bearer") {
		return "", false
	}
	return m[2], true
}

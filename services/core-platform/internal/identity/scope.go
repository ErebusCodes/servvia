package identity

import (
	"context"
	"errors"
	"net/http"

	"servvia/services/core-platform/internal/platform/httpx"
)

// ErrVenueForbidden is Nest's 403 for a device token asking for another venue.
var ErrVenueForbidden = errors.New("This device is not authorized for the requested venue")

// ResolveVenueScope ports resolveVenueScope
// (apps/api/src/auth/utils/resolve-venue-scope.ts) exactly:
//   - staff sessions (no kind, or any kind that is not device-scoped) reach
//     whatever venue they request, including none; organization scoping is
//     the caller's job via Principal.OrganizationID;
//   - device-scoped kinds are pinned to their token's venueId, and a request
//     naming any other venue is refused.
func ResolveVenueScope(p Principal, requestedVenueID string) (string, error) {
	if !p.Kind.DeviceScoped() {
		return requestedVenueID, nil
	}
	if requestedVenueID != "" && requestedVenueID != p.VenueID {
		return "", ErrVenueForbidden
	}
	return p.VenueID, nil
}

type principalKey struct{}

// PrincipalFrom returns the principal set by Authenticate.
func PrincipalFrom(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}

// Authenticate requires a valid Bearer access token and writes Nest's exact
// 401 bodies otherwise. No Go route uses it yet; it exists so the first
// authenticated strangler endpoint inherits verified behaviour.
func Authenticate(v *Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := BearerToken(r.Header.Get("Authorization"))
			if !ok {
				writeUnauthorized(w)
				return
			}
			p, err := v.Verify(raw)
			switch {
			case errors.Is(err, ErrMalformedPayload):
				httpx.WriteError(w, http.StatusUnauthorized, ErrMalformedPayload.Error())
				return
			case err != nil:
				writeUnauthorized(w)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
		})
	}
}

// writeUnauthorized matches Passport's bare 401, which has no `error` field.
func writeUnauthorized(w http.ResponseWriter) {
	httpx.WriteJSON(w, http.StatusUnauthorized, httpx.NestError{
		Message: "Unauthorized", StatusCode: http.StatusUnauthorized,
	})
}

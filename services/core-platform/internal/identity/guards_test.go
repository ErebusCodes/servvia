package identity

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func withPrincipal(p Principal, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
	})
}

var okHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })

func TestRequireRolesMatchesRolesGuard(t *testing.T) {
	guard := RequireRoles(RoleAdmin, RoleKitchen)
	for role, want := range map[string]int{RoleOwner: 200, RoleAdmin: 200, RoleKitchen: 200, RoleManager: 403, RoleViewer: 403, "made-up": 403} {
		rec := httptest.NewRecorder()
		withPrincipal(Principal{Role: role}, guard(okHandler)).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
		if rec.Code != want {
			t.Errorf("%s: %d, want %d", role, rec.Code, want)
		}
		if want == 403 && rec.Body.String() != `{"message":"Insufficient permissions","error":"Forbidden","statusCode":403}` {
			t.Errorf("%s: body %s", role, rec.Body)
		}
	}
}

type devices map[string]bool

func (d devices) TabletDeviceActive(_ context.Context, id string) (bool, error) {
	if id == "broken" {
		return false, errors.New("db down")
	}
	return d[id], nil
}

func TestRequireActiveTabletDevice(t *testing.T) {
	guard := RequireActiveTabletDevice(devices{"live": true, "revoked": false}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	revoked := `{"message":"This device has been revoked or is unknown","error":"Unauthorized","statusCode":401}`
	cases := []struct {
		name string
		p    Principal
		code int
	}{
		{"staff session untouched", Principal{Role: RoleAdmin}, 200},
		{"kds device untouched", Principal{Kind: KindKDSDevice, DeviceID: "revoked"}, 200},
		{"active tablet", Principal{Kind: KindTabletDevice, DeviceID: "live"}, 200},
		{"revoked tablet", Principal{Kind: KindTabletStaff, DeviceID: "revoked"}, 401},
		{"unknown tablet", Principal{Kind: KindTabletManager, DeviceID: "gone"}, 401},
		{"tablet token without device id", Principal{Kind: KindTabletDevice}, 200},
		{"lookup failure", Principal{Kind: KindTabletDevice, DeviceID: "broken"}, 500},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		withPrincipal(c.p, guard(okHandler)).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
		if rec.Code != c.code || (c.code == 401 && rec.Body.String() != revoked) {
			t.Errorf("%s: %d %s", c.name, rec.Code, rec.Body)
		}
	}
}

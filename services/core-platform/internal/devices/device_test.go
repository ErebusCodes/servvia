package devices

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCredentialFormat(t *testing.T) {
	plain, verifier := NewCredential("dev-1")
	id, secret, ok := ParseCredential(plain)
	if !ok || id != "dev-1" || len(secret) != 43 || !strings.HasPrefix(plain, "sdv1.dev-1.") {
		t.Fatalf("credential %q", plain)
	}
	if strings.Contains(verifier, secret) || len(verifier) != 64 || !Matches(verifier, secret) {
		t.Error("the verifier must be sha256 of the secret, and never contain it")
	}
	if Matches(verifier, strings.Repeat("A", 43)) {
		t.Error("a wrong secret matches")
	}
	other, _ := NewCredential("dev-1")
	if other == plain {
		t.Error("credentials must be random")
	}
	for _, bad := range []string{"", "sdv1", "sdv1.dev-1", "sdv2.dev-1." + secret, "sdv1..", "sdv1.dev-1." + secret + "x",
		"sdv1.dev-1." + secret[:42] + "!", "eyJhbGciOiJIUzI1NiJ9.e30.sig", "sdv1." + strings.Repeat("x", 65) + "." + secret} {
		if _, _, ok := ParseCredential(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
}

func TestTerminalCode(t *testing.T) {
	for _, ok := range []string{"FRONT-1", "BAR", "A", "POS-2"} {
		if !ValidTerminalCode(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", "-A", "front", "A B", "ABCDEFGHIJKLMNOPQRSTU"} {
		if ValidTerminalCode(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}

type oneDevice struct {
	cred  Credential
	found bool
	// existing is what FindDeviceByKey returns.
	existing *Device
}

func (o oneDevice) Credential(context.Context, string) (Credential, bool, error) {
	return o.cred, o.found, nil
}
func (o oneDevice) FindDeviceByKey(context.Context, string, string) (Device, bool, error) {
	if o.existing != nil {
		return *o.existing, true, nil
	}
	return Device{}, false, nil
}
func (oneDevice) GetDevice(context.Context, string, string) (Device, error) { return Device{}, nil }
func (oneDevice) ListDevices(context.Context, string, DeviceFilter) ([]Device, error) {
	return nil, nil
}
func (oneDevice) Enroll(_ context.Context, n NewDevice) (Device, error) {
	return Device{ID: n.ID, Kind: n.Kind, DisplayName: n.DisplayName}, nil
}
func (oneDevice) Rotate(context.Context, Change, string) (Device, error) { return Device{}, nil }
func (oneDevice) Revoke(context.Context, Change) (Device, bool, error)   { return Device{}, true, nil }
func (oneDevice) FindTerminalByKey(context.Context, string, string) (Terminal, bool, error) {
	return Terminal{}, false, nil
}
func (oneDevice) GetTerminal(context.Context, string, string) (Terminal, error) {
	return Terminal{}, nil
}
func (oneDevice) ListTerminals(context.Context, string, TerminalFilter) ([]Terminal, error) {
	return nil, nil
}
func (oneDevice) CreateTerminal(context.Context, NewTerminal) (Terminal, error) {
	return Terminal{}, nil
}
func (oneDevice) DisableTerminal(context.Context, Change) (Terminal, bool, error) {
	return Terminal{}, true, nil
}
func (oneDevice) BindDevice(context.Context, Change, *string) (Terminal, error) {
	return Terminal{}, nil
}

func TestAuthenticate(t *testing.T) {
	ctx := context.Background()
	plain, verifier := NewCredential("dev-1")
	active := Credential{DeviceID: "dev-1", VenueID: "v1", Kind: KindPaymentAdapter, Status: StatusActive, Verifier: verifier}
	svc := func(c Credential, found bool) *Service {
		return NewService(oneDevice{cred: c, found: found}, true, nil)
	}

	if c, err := svc(active, true).Authenticate(ctx, plain, KindPaymentAdapter, "v1"); err != nil || c.DeviceID != "dev-1" {
		t.Errorf("valid: %v", err)
	}
	revoked := active
	revoked.Status = StatusRevoked
	kds := active
	kds.Kind = KindKDS
	for name, c := range map[string]struct {
		svc  *Service
		raw  string
		kind Kind
		want error
	}{
		"malformed":      {svc(active, true), "not-a-credential", KindPaymentAdapter, ErrUnauthenticated},
		"a staff JWT":    {svc(active, true), "eyJhbGciOiJIUzI1NiJ9.e30.c2ln", KindPaymentAdapter, ErrUnauthenticated},
		"unknown device": {svc(active, false), plain, KindPaymentAdapter, ErrUnauthenticated},
		"wrong secret":   {svc(active, true), "sdv1.dev-1." + strings.Repeat("A", 43), KindPaymentAdapter, ErrUnauthenticated},
		"revoked":        {svc(revoked, true), plain, KindPaymentAdapter, ErrUnauthenticated},
		"wrong kind":     {svc(kds, true), plain, KindPaymentAdapter, ErrWrongKind},
		"wrong venue":    {svc(active, true), plain, KindPaymentAdapter, ErrWrongVenue},
	} {
		venue := "v1"
		if name == "wrong venue" {
			venue = "v2"
		}
		if _, err := c.svc.Authenticate(ctx, c.raw, c.kind, venue); !errors.Is(err, c.want) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestEnrollReplayNeverShowsTheCredentialAgain(t *testing.T) {
	ctx := context.Background()
	existing := Device{ID: "dev-1", Kind: KindKDS, DisplayName: "Pass"}
	svc := NewService(oneDevice{existing: &existing}, true, func() string { return "new" })
	d, credential, created, err := svc.Enroll(ctx, Scope{}, Actor{}, KindKDS, "Pass", "key-0123456789abcdef")
	if err != nil || created || credential != "" || d.ID != "dev-1" {
		t.Errorf("replay: %v %q %v", created, credential, err)
	}
	var conflict *IdempotencyConflictError
	if _, _, _, err := svc.Enroll(ctx, Scope{}, Actor{}, KindPaymentAdapter, "Pass", "key-0123456789abcdef"); !errors.As(err, &conflict) {
		t.Errorf("same key, other kind: %v", err)
	}
	fresh := NewService(oneDevice{}, true, func() string { return "dev-2" })
	d, credential, created, err = fresh.Enroll(ctx, Scope{}, Actor{}, KindKDS, "Pass", "key-0123456789abcdef")
	if id, _, ok := ParseCredential(credential); err != nil || !created || !ok || id != "dev-2" || d.ID != "dev-2" {
		t.Errorf("enroll: %v %q %v", created, credential, err)
	}
	var invalidErr *ValidationError
	for name, call := range map[string]func() error{
		"kind": func() error {
			_, _, _, err := fresh.Enroll(ctx, Scope{}, Actor{}, "printer", "P", "key-0123456789abcdef")
			return err
		},
		"padded name": func() error {
			_, _, _, err := fresh.Enroll(ctx, Scope{}, Actor{}, KindKDS, " P", "key-0123456789abcdef")
			return err
		},
		"short key": func() error { _, _, _, err := fresh.Enroll(ctx, Scope{}, Actor{}, KindKDS, "P", "short"); return err },
		"rotate v0": func() error { _, _, err := fresh.Rotate(ctx, Change{}); return err },
		"bind empty": func() error {
			empty := ""
			_, err := fresh.BindDevice(ctx, Change{ExpectedVersion: 1}, &empty)
			return err
		},
	} {
		if err := call(); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, _, _, err := NewService(oneDevice{}, false, nil).Enroll(ctx, Scope{}, Actor{}, KindKDS, "P", "key-0123456789abcdef"); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only: %v", err)
	}
}

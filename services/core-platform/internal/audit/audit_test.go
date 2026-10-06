package audit

import (
	"errors"
	"testing"

	"servvia/services/core-platform/internal/identity"
)

func TestActorShapes(t *testing.T) {
	tablet := Device{Kind: DeviceKindTablet, ID: "tablet-7"}
	valid := []struct {
		name  string
		actor Actor
	}{
		{"staff", Staff("staff-1", "staff@example.test", "cashier", Device{})},
		{"staff through a tablet", Staff("staff-1", "staff@example.test", "manager", tablet)},
		{"staff whose credential carries no email", Staff("staff-1", "", "cashier", Device{})},
		{"device with its record", ByDevice(Device{Kind: "payment_adapter", ID: "device-1"}, "")},
		{"device without a record, with its credential's role", ByDevice(Device{Kind: "kds_device"}, "kitchen")},
		{"system", System("event-dispatcher")},
	}
	for _, c := range valid {
		if err := c.actor.Validate(); err != nil {
			t.Errorf("%s: Validate() = %v, want nil", c.name, err)
		}
	}
}

func TestInvalidActorsAreRefused(t *testing.T) {
	invalid := []struct {
		name  string
		actor Actor
	}{
		{"zero actor", Actor{}},
		{"staff without id", Staff("", "staff@example.test", "cashier", Device{})},
		{"staff without role", Staff("staff-1", "staff@example.test", "", Device{})},
		{"staff device id without kind", Staff("staff-1", "staff@example.test", "cashier", Device{ID: "tablet-7"})},
		{"device without kind", ByDevice(Device{ID: "device-1"}, "")},
		{"system without name", System("")},
	}
	for _, c := range invalid {
		if err := c.actor.Validate(); !errors.Is(err, ErrInvalidActor) {
			t.Errorf("%s: Validate() = %v, want ErrInvalidActor", c.name, err)
		}
	}
}

func TestDeviceOfPrincipal(t *testing.T) {
	for _, c := range []struct {
		kind identity.Kind
		want Device
	}{
		{identity.KindStaffSession, Device{}},
		{identity.KindKDSDevice, Device{}},
		{identity.KindTabletDevice, Device{}},
		{identity.KindTabletStaff, Device{Kind: DeviceKindTablet, ID: "tablet-7"}},
		{identity.KindTabletManager, Device{Kind: DeviceKindTablet, ID: "tablet-7"}},
	} {
		p := identity.Principal{ID: "staff-1", Kind: c.kind, DeviceID: "tablet-7", ActingStaffID: "staff-2", SessionID: "session-1"}
		if got := DeviceOf(p); got != c.want {
			t.Errorf("DeviceOf(%q) = %+v, want %+v", c.kind, got, c.want)
		}
	}
}

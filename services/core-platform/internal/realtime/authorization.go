package realtime

import "errors"

// SubscriberKind is how a subscriber authenticated. A device credential
// never carries staff authority: a staff action from a device needs a staff
// identity (an elevated tablet token), as for HTTP.
type SubscriberKind string

const (
	// StaffSession: a named staff login.
	StaffSession SubscriberKind = "staff_session"
	// StaffOnTablet: a tablet elevated by a staff or manager PIN.
	StaffOnTablet SubscriberKind = "staff_tablet"
	// CustomerTablet: an unelevated (customer-mode) tablet.
	CustomerTablet SubscriberKind = "customer_tablet"
	// KDSToken: the NestJS KDS PIN token (kds_device).
	KDSToken SubscriberKind = "kds_token"
	// Device: a Phase D8 device credential; DeviceKind says which.
	Device SubscriberKind = "device"
)

// Identity is what authorization needs to know about a subscriber.
type Identity struct {
	Kind SubscriberKind
	// Role is the staff role (owner, admin, manager, cashier, kitchen,
	// viewer) for staff kinds.
	Role string
	// DeviceKind is the D8 kind (pos_terminal, order_tablet, kds,
	// payment_adapter) for Device.
	DeviceKind string
}

// ErrNotPermitted: this identity may not subscribe to realtime at all.
var ErrNotPermitted = errors.New("This identity may not subscribe to realtime events")

// Grant decides the streams an identity receives. Least privilege: only
// identities with a present operational need get any, and a kitchen
// identity never gets a financial fact.
//
//   - owner, admin, manager, cashier (staff login or elevated tablet):
//     operations + financial (+ kitchen tickets, which operations includes)
//   - kitchen staff, a KDS token, a D8 kds device: kitchen
//   - viewer, a customer tablet, D8 order_tablet, pos_terminal and
//     payment_adapter devices: refused. A POS installation subscribes with
//     its operator's staff token; the payment adapter reports results and
//     has no subscriber need.
func Grant(id Identity) ([]Audience, error) {
	switch id.Kind {
	case StaffSession, StaffOnTablet:
		switch id.Role {
		case "owner", "admin", "manager", "cashier":
			return []Audience{Operations, Financial}, nil
		case "kitchen":
			return []Audience{Kitchen}, nil
		}
	case KDSToken:
		return []Audience{Kitchen}, nil
	case Device:
		if id.DeviceKind == "kds" {
			return []Audience{Kitchen}, nil
		}
	}
	return nil, ErrNotPermitted
}

// Allowed reports whether a subscriber granted audiences receives an event
// of eventType.
func Allowed(granted []Audience, eventType string) bool {
	for _, a := range AudiencesOf(eventType) {
		for _, g := range granted {
			if a == g {
				return true
			}
		}
	}
	return false
}

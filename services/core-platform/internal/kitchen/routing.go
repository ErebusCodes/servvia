package kitchen

// RouteLine is what routing may look at for one order line.
type RouteLine struct {
	MenuItemID string
	Category   string
}

// Router decides, on the server, which station prepares a line. Clients never
// choose a station. Tickets are keyed by (round, station), so a data-driven
// router can replace this one without a schema change.
type Router interface {
	Station(RouteLine) string
}

// DefaultStation is the one station every venue has.
const DefaultStation = "kitchen"

// SingleStation routes every line to one station. It is today's routing: the
// schema holds no product, category or printer-to-station mapping, and the
// legacy path sends every order to every kitchen printer and one KDS
// (docs/migration/d4-kitchen-tickets.md).
type SingleStation struct{ Name string }

func (s SingleStation) Station(RouteLine) string { return s.Name }

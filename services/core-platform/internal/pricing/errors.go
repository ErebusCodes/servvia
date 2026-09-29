package pricing

// Kind classifies a pricing failure. Each kind has one meaning for every
// client. The status each maps to in the current HTTP contract
// (contracts/openapi/orders.yaml) is noted; mapping happens at the transport
// boundary, not here.
type Kind int

const (
	// KindInvalidRequest: the request names something that does not exist
	// for this venue, or breaks a modifier rule. HTTP 400.
	KindInvalidRequest Kind = iota + 1
	// KindUnavailable: the item or option exists but cannot be ordered now.
	// HTTP 409.
	KindUnavailable
	// KindStalePrice: the price the client displayed is no longer the
	// current price. Conflicts lists every mismatched line. HTTP 409 with
	// code STALE_PRICE.
	KindStalePrice
	// KindUnsupportedTax: the venue's tax configuration has no verified
	// rule. HTTP 422.
	KindUnsupportedTax
	// KindAmountOutOfRange: an amount cannot be represented or persisted.
	// Nest has no equivalent check; it fails at persistence with a 500.
	KindAmountOutOfRange
	// KindCatalogInvalid: menu data needed for this request is malformed
	// (a selected option's priceDeltaCents is not a whole number of cents).
	// A server-side data fault, not the client's. The Admin Console cannot
	// author such a value (ModifierOptionDto: @IsInt @Min(0)); it can only
	// come from a direct database write or import. Nest accepts it and
	// persists a truncated unit price (1000 + 12.5 is stored as 1012) while
	// the line's modifier snapshot keeps 12.5. Go refuses instead: a
	// reported difference, see docs/migration/README.md (Phase D1).
	KindCatalogInvalid
)

// StalePriceCode is the `code` of the STALE_PRICE conflict body.
const StalePriceCode = "STALE_PRICE"

// StalePriceMessage is the STALE_PRICE conflict message, verbatim.
const StalePriceMessage = "One or more menu prices changed since this order was built — review the updated price(s) before resubmitting"

// PriceConflict is one line whose expected price differs from the current one.
// Its JSON form is the element of the STALE_PRICE body's `conflicts`.
type PriceConflict struct {
	MenuItemID                  string `json:"menuItemId"`
	MenuItemTitle               string `json:"menuItemTitle"`
	ExpectedUnitPriceCents      int64  `json:"expectedUnitPriceCents"`
	AuthoritativeUnitPriceCents int64  `json:"authoritativeUnitPriceCents"`
}

// Error is every failure this package returns. Message is the exact text the
// NestJS API uses for the same failure.
type Error struct {
	Kind      Kind
	Message   string
	Conflicts []PriceConflict
}

func (e *Error) Error() string { return e.Message }

func invalid(msg string) error     { return &Error{Kind: KindInvalidRequest, Message: msg} }
func unavailable(msg string) error { return &Error{Kind: KindUnavailable, Message: msg} }

var errOutOfRange = &Error{Kind: KindAmountOutOfRange, Message: "An order amount exceeds the supported range"}

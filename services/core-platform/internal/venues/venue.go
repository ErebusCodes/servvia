// Package venues is Servvia Core's read model of organizations and venues:
// who owns a venue, whether it is operating, and the configuration pricing
// and menus depend on (timezone, currency, locale, tax).
//
// It reads the Prisma-managed "Organization" and "Venue" tables. Prisma
// remains the schema authority; this package never writes.
//
// The Venue table still carries the legacy external-POS columns
// posAdapterType and posConfig (ADR 0001). They are deliberately NOT part of
// this model: Servvia Core owns the POS, so an external POS adapter is not a
// property of a venue. Nothing here selects them, and the architecture guard
// test (tests/architecture) keeps it that way.
package venues

// Organization is the tenant that owns venues, menus and staff.
type Organization struct {
	ID       string
	Name     string
	Slug     string
	IsActive bool
}

// Venue is one operating location of an organization.
type Venue struct {
	ID             string
	OrganizationID string
	Name           string
	Slug           string
	// Timezone is an IANA zone name, e.g. Pacific/Auckland.
	Timezone string
	// IsActive false means the venue is closed to customer-facing reads
	// (the channel menu answers 404 for it).
	IsActive bool
	Tax      TaxConfig
}

// TaxConfig is the venue configuration that decides how prices are taxed and
// shown. Its JSON form is the body of GET /api/venues/{id}/tax-config
// (contracts/openapi/venues-read.yaml), in the NestJS API's field order.
type TaxConfig struct {
	// Currency is an ISO 4217 code, e.g. NZD.
	Currency string `json:"currency"`
	// Locale is a BCP 47 tag, e.g. en-NZ.
	Locale string `json:"locale"`
	// TaxJurisdiction names the tax regime, e.g. NZ_GST.
	TaxJurisdiction string `json:"taxJurisdiction"`
	// PricesIncludeTax is true when menu prices already contain the tax.
	PricesIncludeTax bool `json:"pricesIncludeTax"`
}

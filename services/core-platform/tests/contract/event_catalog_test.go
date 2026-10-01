package contract

// The published event catalog (contracts/events/catalog.md) and the Go
// catalog (internal/events) list the same fact types with the same
// aggregates. Each catalog row starts "| `<type>` | <aggregate> (...) |".

import (
	"os"
	"regexp"
	"slices"
	"testing"

	"servvia/services/core-platform/internal/events"
	"servvia/services/core-platform/tests/testsupport"
)

var catalogRow = regexp.MustCompile("(?m)^\\| `([a-z_]+\\.[a-z_]+)` \\| ([a-z_]+) \\(")

func TestEventCatalogMatchesContract(t *testing.T) {
	raw, err := os.ReadFile(testsupport.ContractPath("events/catalog.md"))
	if err != nil {
		t.Fatal(err)
	}
	var documented []string
	for _, m := range catalogRow.FindAllStringSubmatch(string(raw), -1) {
		documented = append(documented, m[1])
		// Encode accepts a fact only when its type is catalogued for exactly
		// this aggregate.
		if _, err := (events.Fact{Type: m[1], AggregateType: m[2], AggregateID: "x"}).Encode(); err != nil {
			t.Errorf("%s: documented aggregate %q is not the Go catalog's", m[1], m[2])
		}
	}
	code := events.Types()
	slices.Sort(documented)
	slices.Sort(code)
	if len(documented) == 0 || !slices.Equal(documented, code) {
		t.Errorf("catalog.md types %v\nGo catalog types %v", documented, code)
	}
}

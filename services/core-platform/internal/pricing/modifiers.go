package pricing

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
)

// ModifierGroup is one group of MenuItem.modifierGroups, the JSON column the
// Admin Console authors (ModifierGroupDto). The column is not normalised yet;
// that is a later additive schema change.
type ModifierGroup struct {
	ID       string
	Name     string
	Required bool
	// MinSelections and MaxSelections are JSON numbers and are compared as
	// numbers, as Nest does; they are not assumed to be whole.
	MinSelections float64
	MaxSelections float64
	Options       []ModifierOption
}

// ModifierOption is one choice within a group.
type ModifierOption struct {
	ID          string
	Name        string
	IsAvailable bool
	// PriceDeltaCents is valid only when WholeCents is true. A stored delta
	// that is fractional or beyond MaxAmountCents is kept (it still counts
	// toward the group's default maxSelections, as in Nest) but cannot be
	// priced: selecting it fails with KindCatalogInvalid.
	PriceDeltaCents int64
	WholeCents      bool
}

// ModifierSelection is what a client may send: which option of which group.
// Never a price.
type ModifierSelection struct {
	ModifierGroupID string
	OptionID        string
}

// PricedModifier is a selection resolved against the catalog. Its JSON form
// matches the `selectedModifiers` snapshot persisted on an order line.
type PricedModifier struct {
	ModifierGroupID   string `json:"modifierGroupId"`
	ModifierGroupName string `json:"modifierGroupName"`
	OptionID          string `json:"optionId"`
	OptionName        string `json:"optionName"`
	PriceDeltaCents   int64  `json:"priceDeltaCents"`
}

// ParseModifierGroups reads the raw column exactly as Nest's
// parseModifierGroups does. It is tolerant: anything that is not an array
// yields no groups; a group without a string id and name, or an option
// without a string id, string name and numeric priceDeltaCents, is skipped.
// `required` is true only for literal true; an option is unavailable only for
// literal `isAvailable: false`; a missing minSelections is 0 and a missing
// maxSelections is the number of parsed options.
func ParseModifierGroups(raw []byte) []ModifierGroup {
	var elems []json.RawMessage
	if json.Unmarshal(raw, &elems) != nil {
		return nil
	}
	var groups []ModifierGroup
	for _, elem := range elems {
		g, ok := object(elem)
		if !ok {
			continue
		}
		id, okID := str(g["id"])
		name, okName := str(g["name"])
		if !okID || !okName {
			continue
		}
		group := ModifierGroup{ID: id, Name: name, Required: literal(g["required"], "true")}
		var rawOptions []json.RawMessage
		_ = json.Unmarshal(g["options"], &rawOptions)
		for _, rawOption := range rawOptions {
			o, ok := object(rawOption)
			if !ok {
				continue
			}
			oid, okID := str(o["id"])
			oname, okName := str(o["name"])
			delta, okDelta := num(o["priceDeltaCents"])
			if !okID || !okName || !okDelta {
				continue
			}
			option := ModifierOption{ID: oid, Name: oname, IsAvailable: !literal(o["isAvailable"], "false")}
			if delta == math.Trunc(delta) && math.Abs(delta) <= MaxAmountCents {
				option.PriceDeltaCents, option.WholeCents = int64(delta), true
			}
			group.Options = append(group.Options, option)
		}
		if n, ok := num(g["minSelections"]); ok {
			group.MinSelections = n
		}
		group.MaxSelections = float64(len(group.Options))
		if n, ok := num(g["maxSelections"]); ok {
			group.MaxSelections = n
		}
		groups = append(groups, group)
	}
	return groups
}

// resolveModifiers is Nest's strict resolution (Story 15-3), used by every
// staff and tablet order path. Every selection must name a real group and
// option of this item; nothing is ever zero-priced, dropped or kept as an
// annotation. Checks run in Nest's order and the first failure wins:
//
//  1. every selection has a group id and an option id;
//  2. an item without groups accepts no selections;
//  3. per selection, in request order: group exists, option exists in that
//     group, option is available (409), option not already selected;
//  4. per group, in catalog order: required, minSelections, maxSelections;
//  5. (Go only) a selected option whose stored delta is not whole cents is a
//     catalog fault (KindCatalogInvalid). Nest has no such check and
//     persists a truncated price.
//
// The result lists selections grouped by the order in which their group was
// first selected, then in request order within a group.
func resolveModifiers(groups []ModifierGroup, selections []ModifierSelection) ([]PricedModifier, int64, error) {
	for _, s := range selections {
		if s.ModifierGroupID == "" || s.OptionID == "" {
			return nil, 0, invalid("Each selected modifier must specify modifierGroupId and optionId")
		}
	}
	if len(groups) == 0 && len(selections) > 0 {
		return nil, 0, invalid("This item has no configurable options")
	}

	seen := map[string]bool{}
	byGroup := map[string][]PricedModifier{}
	var groupOrder []string
	var delta int64
	var corrupt *ModifierOption
	ok := true
	for _, s := range selections {
		group := findGroup(groups, s.ModifierGroupID)
		if group == nil {
			return nil, 0, invalid("Unknown modifier group for this item")
		}
		option := findOption(group.Options, s.OptionID)
		if option == nil {
			return nil, 0, invalid("Unknown modifier option for this item")
		}
		if !option.IsAvailable {
			return nil, 0, unavailable(`"` + option.Name + `" is no longer available`)
		}
		if seen[option.ID] {
			return nil, 0, invalid("Duplicate modifier option selected")
		}
		seen[option.ID] = true
		if !option.WholeCents {
			// Reported after the group rules, which Nest also checks first.
			if corrupt == nil {
				corrupt = option
			}
		} else if delta, ok = addCents(delta, option.PriceDeltaCents); !ok {
			return nil, 0, errOutOfRange
		}
		if _, started := byGroup[group.ID]; !started {
			groupOrder = append(groupOrder, group.ID)
		}
		byGroup[group.ID] = append(byGroup[group.ID], PricedModifier{
			ModifierGroupID: group.ID, ModifierGroupName: group.Name,
			OptionID: option.ID, OptionName: option.Name, PriceDeltaCents: option.PriceDeltaCents,
		})
	}

	for _, group := range groups {
		count := float64(len(byGroup[group.ID]))
		if group.Required && count == 0 {
			return nil, 0, invalid(`"` + group.Name + `" requires a selection`)
		}
		if (group.Required || count > 0) && count < group.MinSelections {
			return nil, 0, invalid(`"` + group.Name + `" requires at least ` + jsNumber(group.MinSelections) + " selection(s)")
		}
		if count > group.MaxSelections {
			return nil, 0, invalid(`"` + group.Name + `" allows at most ` + jsNumber(group.MaxSelections) + " selection(s)")
		}
	}

	if corrupt != nil {
		return nil, 0, &Error{Kind: KindCatalogInvalid,
			Message: `Modifier option "` + corrupt.Name + `" has a price that is not a whole number of cents`}
	}

	resolved := make([]PricedModifier, 0, len(selections))
	for _, id := range groupOrder {
		resolved = append(resolved, byGroup[id]...)
	}
	return resolved, delta, nil
}

// findGroup returns the first group with the id, as Array.find does.
func findGroup(groups []ModifierGroup, id string) *ModifierGroup {
	for i := range groups {
		if groups[i].ID == id {
			return &groups[i]
		}
	}
	return nil
}

func findOption(options []ModifierOption, id string) *ModifierOption {
	for i := range options {
		if options[i].ID == id {
			return &options[i]
		}
	}
	return nil
}

func object(raw json.RawMessage) (map[string]json.RawMessage, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return nil, false
	}
	var m map[string]json.RawMessage
	return m, json.Unmarshal(raw, &m) == nil
}

func str(raw json.RawMessage) (string, bool) {
	var s string
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	return s, json.Unmarshal(raw, &s) == nil
}

func num(raw json.RawMessage) (float64, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || (raw[0] != '-' && (raw[0] < '0' || raw[0] > '9')) {
		return 0, false
	}
	f, err := strconv.ParseFloat(string(raw), 64)
	return f, err == nil
}

func literal(raw json.RawMessage, want string) bool {
	return string(bytes.TrimSpace(raw)) == want
}

// jsNumber formats a number as JavaScript's String(n) does for the values a
// selection count can take.
func jsNumber(f float64) string {
	if f == 0 {
		return "0"
	}
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

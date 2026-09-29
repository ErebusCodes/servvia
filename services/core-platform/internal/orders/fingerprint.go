package orders

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"

	"servvia/services/core-platform/internal/pricing"
)

// A fingerprint identifies a request semantically, so an idempotency key
// replayed with the same request returns the original result and a key
// reused for a different request is refused (the NestJS order path's rule,
// Story 6-1 / 15-3).
//
// It covers everything the client decides: venue, source, service mode,
// table session, order notes and, per line, product, quantity, modifier
// options, notes and seat. Line order and modifier order do not matter.
// Prices never take part: the server decides them, and a legitimate replay
// after a price change must still return the original order.
//
// Nest's fingerprint omits notes and seats; Servvia's includes them, because
// a retry resends an identical body and different notes are a different
// request.
//
// The promotion named (Phase D11) is part of the request: the same key with
// another promotion, or with none, is a different request. It is added only
// when present, so fingerprints of requests without one are unchanged.

type lineKey struct {
	MenuItemID string   `json:"m"`
	Quantity   int64    `json:"q"`
	Options    []string `json:"o"`
	Notes      string   `json:"n"`
	Seat       int      `json:"s"`
}

// OrderRequest is the identity-bearing part of a create request.
type OrderRequest struct {
	VenueID        string
	Source         Source
	ServiceMode    ServiceMode
	TableSessionID *string
	Notes          *string
	Lines          []LineInput
	PromotionID    *string
}

// Fingerprint of a create request.
func (r OrderRequest) Fingerprint() string {
	session := ""
	if r.TableSessionID != nil {
		session = *r.TableSessionID
	}
	keys := make([]lineKey, 0, len(r.Lines))
	for _, l := range r.Lines {
		keys = append(keys, inputKey(l))
	}
	return digest(withPromotion(map[string]any{
		"venue": r.VenueID, "source": r.Source, "mode": r.ServiceMode, "session": session,
		"notes": text(r.Notes), "lines": sortedLines(keys),
	}, r.PromotionID))
}

// RoundFingerprint of a round request: its lines and promotion (the order is
// in the path).
func RoundFingerprint(lines []LineInput, promotionID *string) string {
	keys := make([]lineKey, 0, len(lines))
	for _, l := range lines {
		keys = append(keys, inputKey(l))
	}
	return digest(withPromotion(map[string]any{"lines": sortedLines(keys)}, promotionID))
}

func withPromotion(m map[string]any, id *string) map[string]any {
	if id != nil {
		m["promotion"] = *id
	}
	return m
}

// promotionOf is the promotion applied to round roundID of o, if any.
func promotionOf(o Order, roundID *string) *string {
	if roundID == nil {
		return nil
	}
	for _, p := range o.Promotions {
		if p.RoundID == *roundID {
			id := p.PromotionID
			return &id
		}
	}
	return nil
}

// CreatedFingerprint is the fingerprint of the request that created o, from
// what was persisted: its first round's lines (all lines, for an order the
// NestJS path created, which has no rounds).
func CreatedFingerprint(o Order) string {
	var first *string
	if len(o.Rounds) > 0 {
		first = &o.Rounds[0].ID
	}
	return OrderRequest{VenueID: o.VenueID, Source: o.Source, ServiceMode: o.ServiceMode,
		TableSessionID: o.TableSessionID, Notes: o.Notes, Lines: inputsOf(o.Lines, first),
		PromotionID: promotionOf(o, first)}.Fingerprint()
}

// SubmittedRoundFingerprint is the fingerprint of the request that submitted
// round r of o.
func SubmittedRoundFingerprint(o Order, r Round) string {
	return RoundFingerprint(inputsOf(o.Lines, &r.ID), promotionOf(o, &r.ID))
}

func inputsOf(lines []Line, round *string) []LineInput {
	var in []LineInput
	for _, l := range lines {
		if round != nil && (l.RoundID == nil || *l.RoundID != *round) {
			continue
		}
		li := LineInput{MenuItemID: l.MenuItemID, Quantity: l.Quantity, Notes: l.Notes, Seat: l.Seat}
		for _, m := range l.Modifiers {
			li.Modifiers = append(li.Modifiers, selectionOf(m))
		}
		in = append(in, li)
	}
	return in
}

func inputKey(l LineInput) lineKey {
	k := lineKey{MenuItemID: l.MenuItemID, Quantity: l.Quantity, Notes: text(l.Notes), Seat: seat(l.Seat), Options: []string{}}
	for _, m := range l.Modifiers {
		k.Options = append(k.Options, m.ModifierGroupID+"/"+m.OptionID)
	}
	sort.Strings(k.Options)
	return k
}

func sortedLines(keys []lineKey) []lineKey {
	sort.Slice(keys, func(i, j int) bool { return canonical(keys[i]) < canonical(keys[j]) })
	return keys
}

func canonical(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func digest(v any) string {
	sum := sha256.Sum256([]byte(canonical(v)))
	return hex.EncodeToString(sum[:])
}

func text(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// seat normalises like the NestJS path: a positive integer, else no seat (0).
func seat(s *int) int {
	if s == nil || *s < 1 {
		return 0
	}
	return *s
}

// NormalizeSeat returns the seat to persist: a positive integer or nil.
func NormalizeSeat(s *int) *int {
	if n := seat(s); n > 0 {
		return &n
	}
	return nil
}

// NormalizeNotes returns the notes to persist: empty is none, as in Nest.
func NormalizeNotes(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

func selectionOf(m pricing.PricedModifier) pricing.ModifierSelection {
	return pricing.ModifierSelection{ModifierGroupID: m.ModifierGroupID, OptionID: m.OptionID}
}

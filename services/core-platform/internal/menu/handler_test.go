package menu

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

const venueID = "10000000-0000-4000-8000-000000000001"

type fakeStore struct {
	org      string
	found    bool
	venueErr error
	snap     Snapshot
	snapErr  error
	channel  Channel
}

func (f *fakeStore) ActiveVenueOrganization(context.Context, string) (string, bool, error) {
	return f.org, f.found, f.venueErr
}

func (f *fakeStore) Snapshot(_ context.Context, _, _ string, c Channel) (Snapshot, error) {
	f.channel = c
	return f.snap, f.snapErr
}

func serve(store Store, path string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/menu/venues/{venueId}/channel/{channel}",
		NewHandler(store, slog.New(slog.NewTextHandler(io.Discard, nil))).ChannelMenu)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestChannelMenuErrorsMatchNest(t *testing.T) {
	cases := []struct {
		name, path string
		store      *fakeStore
		status     int
		body       string
	}{
		{"invalid uuid", "/api/menu/venues/not-a-uuid/channel/order_tablet", &fakeStore{}, 400,
			`{"message":"Validation failed (uuid is expected)","error":"Bad Request","statusCode":400}`},
		{"uuid checked before channel", "/api/menu/venues/nope/channel/nope", &fakeStore{}, 400,
			`{"message":"Validation failed (uuid is expected)","error":"Bad Request","statusCode":400}`},
		{"unknown channel", "/api/menu/venues/" + venueID + "/channel/kiosk", &fakeStore{}, 404,
			`{"message":"Unknown channel \"kiosk\"","error":"Not Found","statusCode":404}`},
		{"venue missing or inactive", "/api/menu/venues/" + venueID + "/channel/order_tablet", &fakeStore{}, 404,
			`{"message":"Venue not found","error":"Not Found","statusCode":404}`},
		{"database failure", "/api/menu/venues/" + venueID + "/channel/order_tablet",
			&fakeStore{venueErr: errors.New("connection refused")}, 500,
			`{"message":"Internal server error","statusCode":500}`},
	}
	for _, tc := range cases {
		rec := serve(tc.store, tc.path)
		if rec.Code != tc.status || rec.Body.String() != tc.body {
			t.Errorf("%s: %d %s", tc.name, rec.Code, rec.Body.String())
		}
	}
}

func TestChannelMenuAcceptsAnyUUIDVersionAndUppercase(t *testing.T) {
	for _, id := range []string{"10000000-0000-1000-0000-000000000001", "ABCDEF00-0000-4000-8000-000000000001"} {
		store := &fakeStore{}
		if rec := serve(store, "/api/menu/venues/"+id+"/channel/order_tablet"); rec.Code != 404 {
			t.Errorf("%s: want the venue lookup (404), got %d %s", id, rec.Code, rec.Body.String())
		}
	}
}

func TestChannelMenuServesResolvedMenu(t *testing.T) {
	store := &fakeStore{org: "org-1", found: true, snap: Snapshot{
		Categories: []Category{{ID: "c1", Name: "Mains", IsActive: true, VisibleChannels: []string{"window_display"}}},
		Items:      []Item{item("a", "c1", 1000, true), item("b", "c1", 900, false)},
	}}
	rec := serve(store, "/api/menu/venues/"+venueID+"/channel/window_display")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
	if store.channel != ChannelWindowDisplay {
		t.Fatalf("store asked for %q", store.channel)
	}
	want := `{"categories":[{"id":"c1","name":"Mains","description":null,"imageUrl":null,"sortOrder":0,"isActive":true,"visibleChannels":["window_display"]}],` +
		`"menuItems":[{"id":"a","categoryId":"c1","subCategory":null,"title":"a","description":"","imageUrl":null,"imageThumbnailUrl":null,"priceCents":1000,"nutritionalDetails":{},"modifierGroups":[],"isSpicy":false,"isAvailable":true,"isFeatured":false,"sortOrder":0,"visibleChannels":["order_tablet","customer_website","window_display"]}]}`
	if rec.Body.String() != want {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

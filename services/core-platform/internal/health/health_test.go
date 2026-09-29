package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

type slowPinger struct{}

func (slowPinger) Ping(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }

func serve(h http.HandlerFunc) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	return rec
}

func TestLiveNeverTouchesTheDatabase(t *testing.T) {
	h := New(fakePinger{err: errors.New("down")}, time.Second)
	if rec := serve(h.Live); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Fatalf("live = %d %s", rec.Code, rec.Body.String())
	}
}

func TestReadyReflectsDatabase(t *testing.T) {
	if rec := serve(New(fakePinger{}, time.Second).Ready); rec.Code != http.StatusOK {
		t.Fatalf("ready with healthy db = %d", rec.Code)
	}
	rec := serve(New(fakePinger{err: errors.New("down")}, time.Second).Ready)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"database":"down"`) {
		t.Fatalf("ready with failed db = %d %s", rec.Code, rec.Body.String())
	}
}

func TestReadyTimesOut(t *testing.T) {
	start := time.Now()
	rec := serve(New(slowPinger{}, 50*time.Millisecond).Ready)
	if rec.Code != http.StatusServiceUnavailable || time.Since(start) > time.Second {
		t.Fatalf("ready must fail fast on a hung database: %d after %s", rec.Code, time.Since(start))
	}
}

func TestDrainMakesInstanceNotReady(t *testing.T) {
	h := New(fakePinger{}, time.Second)
	h.Drain()
	if rec := serve(h.Ready); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "draining") {
		t.Fatalf("drained ready = %d %s", rec.Code, rec.Body.String())
	}
	if rec := serve(h.Live); rec.Code != http.StatusOK {
		t.Fatal("draining must not fail liveness")
	}
}

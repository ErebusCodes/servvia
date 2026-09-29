// Package devicesapi is the HTTP transport of the device and terminal domain
// (contracts/openapi/devices.yaml), and the device-credential middleware
// (Authenticate) for routes that devices, not staff, call.
//
// A credential is shown in exactly two responses: enrollment (201) and
// rotation. No other response, log line or audit row carries it.
package devicesapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/venues"
)

// AdminRoles may enroll, rotate and revoke devices and manage terminals, from
// a staff login session (owner implied).
var AdminRoles = []string{identity.RoleAdmin, identity.RoleManager}

// TerminalReadRoles may read terminals (a cashier picks one for a shift).
var TerminalReadRoles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleCashier}

// --- device authentication ---------------------------------------------------

type deviceKey struct{}

// DeviceFrom returns the device Authenticate admitted.
func DeviceFrom(ctx context.Context) (devices.Credential, bool) {
	d, ok := ctx.Value(deviceKey{}).(devices.Credential)
	return d, ok
}

// Authenticate admits only a request bearing the credential of an active
// device of kind registered at the path's venue ({venueId}). A staff JWT is
// not a device credential and is refused like any unknown one (401). A valid
// device of another kind or venue is 403. Nothing about the credential is
// logged.
func Authenticate(svc *devices.Service, kind devices.Kind, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok {
				httpx.WriteError(w, http.StatusUnauthorized, devices.ErrUnauthenticated.Error())
				return
			}
			d, err := svc.Authenticate(r.Context(), raw, kind, r.PathValue("venueId"))
			switch {
			case err == nil:
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), deviceKey{}, d)))
			case errors.Is(err, devices.ErrUnauthenticated):
				httpx.WriteError(w, http.StatusUnauthorized, err.Error())
			case errors.Is(err, devices.ErrWrongKind), errors.Is(err, devices.ErrWrongVenue):
				httpx.WriteError(w, http.StatusForbidden, err.Error())
			default:
				logger.ErrorContext(r.Context(), "device authentication failed", "error", err,
					"request_id", httpx.RequestIDFrom(r.Context()))
				httpx.WriteInternalError(w)
			}
		})
	}
}

// --- administration ----------------------------------------------------------

// VenueResolver finds a venue within an organization (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *devices.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *devices.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func optional(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := timestamp(*t)
	return &s
}

type deviceJSON struct {
	ID                  string  `json:"id"`
	VenueID             string  `json:"venueId"`
	Kind                string  `json:"kind"`
	DisplayName         string  `json:"displayName"`
	Status              string  `json:"status"`
	Version             int     `json:"version"`
	IdempotencyKey      string  `json:"idempotencyKey"`
	TerminalID          *string `json:"terminalId"`
	CredentialRotatedAt *string `json:"credentialRotatedAt"`
	CreatedByStaffID    string  `json:"createdByStaffId"`
	RevokedAt           *string `json:"revokedAt"`
	RevokedByStaffID    *string `json:"revokedByStaffId"`
	CreatedAt           string  `json:"createdAt"`
	UpdatedAt           string  `json:"updatedAt"`
}

// withCredential is the only shape that carries a credential: enrollment and
// rotation. Credential is null on an enrollment replay.
type withCredential struct {
	Device     deviceJSON `json:"device"`
	Credential *string    `json:"credential"`
}

type terminalJSON struct {
	ID             string  `json:"id"`
	VenueID        string  `json:"venueId"`
	Name           string  `json:"name"`
	Code           string  `json:"code"`
	Status         string  `json:"status"`
	DeviceID       *string `json:"deviceId"`
	Version        int     `json:"version"`
	IdempotencyKey string  `json:"idempotencyKey"`
	DisabledAt     *string `json:"disabledAt"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

func deviceToJSON(d devices.Device) deviceJSON {
	return deviceJSON{ID: d.ID, VenueID: d.VenueID, Kind: string(d.Kind), DisplayName: d.DisplayName, Status: string(d.Status),
		Version: d.Version, IdempotencyKey: d.EnrollRequestKey, TerminalID: d.TerminalID,
		CredentialRotatedAt: optional(d.CredentialRotatedAt), CreatedByStaffID: d.CreatedByStaffID,
		RevokedAt: optional(d.RevokedAt), RevokedByStaffID: d.RevokedByStaffID,
		CreatedAt: timestamp(d.CreatedAt), UpdatedAt: timestamp(d.UpdatedAt)}
}

func terminalToJSON(t devices.Terminal) terminalJSON {
	return terminalJSON{ID: t.ID, VenueID: t.VenueID, Name: t.Name, Code: t.Code, Status: string(t.Status), DeviceID: t.DeviceID,
		Version: t.Version, IdempotencyKey: t.CreateRequestKey, DisabledAt: optional(t.DisabledAt),
		CreatedAt: timestamp(t.CreatedAt), UpdatedAt: timestamp(t.UpdatedAt)}
}

// Enroll serves POST /api/venues/{venueId}/devices: 201 with the credential,
// once; 200 with credential null for a replay.
func (h *Handler) Enroll(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Kind           string `json:"kind"`
		DisplayName    string `json:"displayName"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &body) {
		return
	}
	d, credential, created, err := h.svc.Enroll(r.Context(), sc, actor, devices.Kind(body.Kind), body.DisplayName, body.IdempotencyKey)
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	out := withCredential{Device: deviceToJSON(d)}
	status := http.StatusOK
	if created {
		out.Credential, status = &credential, http.StatusCreated
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, status, out)
}

// ListDevices serves GET /api/venues/{venueId}/devices[?kind=&status=].
func (h *Handler) ListDevices(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	found, err := h.svc.ListDevices(r.Context(), sc, devices.DeviceFilter{Kind: devices.Kind(r.URL.Query().Get("kind")),
		Status: devices.Status(r.URL.Query().Get("status"))})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	out := make([]deviceJSON, 0, len(found))
	for _, d := range found {
		out = append(out, deviceToJSON(d))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// GetDevice serves GET /api/venues/{venueId}/devices/{deviceId}.
func (h *Handler) GetDevice(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	d, err := h.svc.GetDevice(r.Context(), sc, r.PathValue("deviceId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, deviceToJSON(d))
}

// Rotate serves POST .../devices/{deviceId}/rotate-credential.
func (h *Handler) Rotate(w http.ResponseWriter, r *http.Request) {
	c, ok := h.change(w, r, "deviceId")
	if !ok {
		return
	}
	d, credential, err := h.svc.Rotate(r.Context(), c)
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, withCredential{Device: deviceToJSON(d), Credential: &credential})
}

// Revoke serves POST .../devices/{deviceId}/revoke.
func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	c, ok := h.change(w, r, "deviceId")
	if !ok {
		return
	}
	d, _, err := h.svc.Revoke(r.Context(), c)
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, deviceToJSON(d))
}

// CreateTerminal serves POST /api/venues/{venueId}/terminals.
func (h *Handler) CreateTerminal(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Name           string  `json:"name"`
		Code           string  `json:"code"`
		DeviceID       *string `json:"deviceId"`
		IdempotencyKey string  `json:"idempotencyKey"`
	}
	if !decode(w, r, &body) {
		return
	}
	t, created, err := h.svc.CreateTerminal(r.Context(), devices.NewTerminal{Scope: sc, Name: body.Name, Code: body.Code,
		DeviceID: body.DeviceID, RequestKey: body.IdempotencyKey, Actor: actor})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, terminalToJSON(t))
}

// ListTerminals serves GET /api/venues/{venueId}/terminals[?status=].
func (h *Handler) ListTerminals(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	found, err := h.svc.ListTerminals(r.Context(), sc, devices.TerminalFilter{Status: devices.TerminalStatus(r.URL.Query().Get("status"))})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	out := make([]terminalJSON, 0, len(found))
	for _, t := range found {
		out = append(out, terminalToJSON(t))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// GetTerminal serves GET /api/venues/{venueId}/terminals/{terminalId}.
func (h *Handler) GetTerminal(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	t, err := h.svc.GetTerminal(r.Context(), sc, r.PathValue("terminalId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, terminalToJSON(t))
}

// DisableTerminal serves POST .../terminals/{terminalId}/disable.
func (h *Handler) DisableTerminal(w http.ResponseWriter, r *http.Request) {
	c, ok := h.change(w, r, "terminalId")
	if !ok {
		return
	}
	t, _, err := h.svc.DisableTerminal(r.Context(), c)
	h.respondTerminal(w, r, t, err)
}

// BindDevice serves POST .../terminals/{terminalId}/bind-device {deviceId}.
func (h *Handler) BindDevice(w http.ResponseWriter, r *http.Request) {
	var deviceID string
	c, ok := h.changeWith(w, r, "terminalId", func(raw json.RawMessage) bool {
		var body struct {
			DeviceID string `json:"deviceId"`
		}
		if json.Unmarshal(raw, &body) != nil || body.DeviceID == "" {
			httpx.WriteError(w, http.StatusBadRequest, "deviceId is required")
			return false
		}
		deviceID = body.DeviceID
		return true
	})
	if !ok {
		return
	}
	t, err := h.svc.BindDevice(r.Context(), c, &deviceID)
	h.respondTerminal(w, r, t, err)
}

// UnbindDevice serves POST .../terminals/{terminalId}/unbind-device.
func (h *Handler) UnbindDevice(w http.ResponseWriter, r *http.Request) {
	c, ok := h.change(w, r, "terminalId")
	if !ok {
		return
	}
	t, err := h.svc.BindDevice(r.Context(), c, nil)
	h.respondTerminal(w, r, t, err)
}

func (h *Handler) respondTerminal(w http.ResponseWriter, r *http.Request, t devices.Terminal, err error) {
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, terminalToJSON(t))
}

func (h *Handler) change(w http.ResponseWriter, r *http.Request, idParam string) (devices.Change, bool) {
	return h.changeWith(w, r, idParam, nil)
}

// changeWith reads {version} (and, with extra, more of the same body).
func (h *Handler) changeWith(w http.ResponseWriter, r *http.Request, idParam string, extra func(json.RawMessage) bool) (devices.Change, bool) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return devices.Change{}, false
	}
	var raw json.RawMessage
	if !decode(w, r, &raw) {
		return devices.Change{}, false
	}
	var body struct {
		Version *int `json:"version"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Version == nil {
		httpx.WriteError(w, http.StatusBadRequest, "version must be a positive integer")
		return devices.Change{}, false
	}
	if extra != nil && !extra(raw) {
		return devices.Change{}, false
	}
	return devices.Change{Scope: sc, ID: r.PathValue(idParam), ExpectedVersion: *body.Version, Actor: actor}, true
}

func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (devices.Scope, devices.Actor, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return devices.Scope{}, devices.Actor{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return devices.Scope{}, devices.Actor{}, false
	}
	v, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.fail(w, r, err)
		return devices.Scope{}, devices.Actor{}, false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return devices.Scope{}, devices.Actor{}, false
	}
	return devices.Scope{OrganizationID: p.OrganizationID, VenueID: v.ID}, devices.Actor{StaffID: p.ID, Email: p.Email, Role: p.Role}, true
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
	if err == nil {
		err = json.Unmarshal(raw, into)
	}
	if err != nil {
		var typeErr *json.UnmarshalTypeError
		msg := "Request body must be a JSON object"
		if errors.As(err, &typeErr) && typeErr.Field != "" {
			msg = typeErr.Field + " has the wrong type"
		}
		httpx.WriteError(w, http.StatusBadRequest, msg)
		return false
	}
	return true
}

type coded struct {
	Message        string `json:"message"`
	Error          string `json:"error"`
	StatusCode     int    `json:"statusCode"`
	Code           string `json:"code"`
	ID             string `json:"id,omitempty"`
	CurrentVersion int    `json:"currentVersion,omitempty"`
}

func writeCoded(w http.ResponseWriter, status int, c coded) {
	c.Error, c.StatusCode = http.StatusText(status), status
	httpx.WriteJSON(w, status, c)
}

func (h *Handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	var (
		validation *devices.ValidationError
		idem       *devices.IdempotencyConflictError
		notActive  *devices.NotActiveError
		version    *devices.VersionConflictError
		codeTaken  *devices.CodeTakenError
		bound      *devices.DeviceBoundError
	)
	switch {
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
	case errors.As(err, &idem):
		writeCoded(w, http.StatusConflict, coded{Message: idem.Error(), Code: "IDEMPOTENCY_CONFLICT", ID: idem.ID})
	case errors.As(err, &notActive):
		writeCoded(w, http.StatusConflict, coded{Message: notActive.Error(), Code: "NOT_ACTIVE"})
	case errors.As(err, &version):
		writeCoded(w, http.StatusConflict, coded{Message: version.Error(), Code: "VERSION_CONFLICT", CurrentVersion: version.Current})
	case errors.As(err, &codeTaken):
		writeCoded(w, http.StatusConflict, coded{Message: codeTaken.Error(), Code: "TERMINAL_CODE_TAKEN"})
	case errors.As(err, &bound):
		writeCoded(w, http.StatusConflict, coded{Message: bound.Error(), Code: "DEVICE_ALREADY_BOUND"})
	case errors.Is(err, devices.ErrDeviceNotBindable):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "DEVICE_NOT_BINDABLE"})
	case errors.Is(err, devices.ErrDeviceNotFound), errors.Is(err, devices.ErrTerminalNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, devices.ErrUnknownActor):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, devices.ErrWritesDisabled):
		writeCoded(w, http.StatusServiceUnavailable, coded{Message: err.Error(), Code: "DEVICE_WRITES_DISABLED"})
	default:
		h.fail(w, r, err)
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "device request failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}

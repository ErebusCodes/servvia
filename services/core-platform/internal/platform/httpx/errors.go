// Package httpx holds HTTP plumbing shared by every Core Platform handler:
// middleware, and error bodies shaped like the NestJS API's so existing clients
// see the same failures from either implementation.
package httpx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
)

// NestError is the body NestJS writes for an HttpException:
// {"message": ..., "error": <status text>, "statusCode": <code>}.
// See contracts/openapi/menu-read.yaml#/components/schemas/NestError.
type NestError struct {
	Message    string `json:"message"`
	Error      string `json:"error,omitempty"`
	StatusCode int    `json:"statusCode"`
}

// WriteJSON writes v like Express's res.json: same Content-Type, and no HTML
// escaping of <, > and & (JSON.stringify does not escape them).
func WriteJSON(w http.ResponseWriter, status int, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	err := enc.Encode(v)
	body := bytes.TrimSuffix(buf.Bytes(), []byte("\n"))
	if err != nil {
		slog.Error("encode response", "error", err)
		status = http.StatusInternalServerError
		body = []byte(`{"statusCode":500,"message":"Internal server error"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// WriteError writes a Nest-shaped HttpException body.
func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, NestError{Message: message, Error: http.StatusText(status), StatusCode: status})
}

// WriteInternalError matches Nest's body for an unhandled exception, which
// deliberately omits the `error` field and never leaks the cause.
func WriteInternalError(w http.ResponseWriter) {
	WriteJSON(w, http.StatusInternalServerError, NestError{
		Message:    "Internal server error",
		StatusCode: http.StatusInternalServerError,
	})
}

package devices

import (
	"errors"
	"strconv"
)

// Errors. The transport maps each to its contract response
// (contracts/openapi/devices.yaml).
var (
	ErrDeviceNotFound   = errors.New("Device not found")
	ErrTerminalNotFound = errors.New("Terminal not found")
	ErrUnknownActor     = errors.New("Unknown staff identity")
	ErrWritesDisabled   = errors.New("Device and terminal changes are disabled on this instance")
	// ErrUnauthenticated: a device credential is malformed, unknown, revoked
	// or wrong. One error for all, so a caller learns nothing about which.
	ErrUnauthenticated = errors.New("Invalid device credential")
	// ErrWrongKind: a valid device of a kind this route does not accept.
	ErrWrongKind = errors.New("This device is not permitted here")
	// ErrWrongVenue: a valid device asking for another venue.
	ErrWrongVenue = errors.New("This device is not authorized for the requested venue")
	// ErrDeviceNotBindable: only an active pos_terminal device of the venue
	// can be bound to a terminal.
	ErrDeviceNotBindable = errors.New("Only an active POS terminal device of this venue can be bound to a terminal")
	// ErrDuplicateKey: a Repository's request key was taken concurrently.
	ErrDuplicateKey = errors.New("request key already used")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// IdempotencyConflictError: the key already created a different device or
// terminal.
type IdempotencyConflictError struct {
	Key, ID string
}

func (e *IdempotencyConflictError) Error() string {
	return `idempotencyKey "` + e.Key + `" was already used for a different request`
}

// NotActiveError: the device is revoked, or the terminal disabled.
type NotActiveError struct{ Status string }

func (e *NotActiveError) Error() string { return "It is " + e.Status + ", not active" }

// VersionConflictError: changed since the caller read it.
type VersionConflictError struct{ Current int }

func (e *VersionConflictError) Error() string {
	return "It was changed by someone else (now version " + strconv.Itoa(e.Current) + ")"
}

// CodeTakenError: the venue already has a terminal with this code.
type CodeTakenError struct{ Code string }

func (e *CodeTakenError) Error() string {
	return "This venue already has a terminal with code " + e.Code
}

// DeviceBoundError: the device is already bound to another terminal.
type DeviceBoundError struct{}

func (e *DeviceBoundError) Error() string { return "This device is already bound to another terminal" }

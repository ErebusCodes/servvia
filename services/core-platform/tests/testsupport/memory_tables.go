package testsupport

import (
	"context"
	"sort"
	"sync"
	"time"

	"servvia/services/core-platform/internal/tables"
)

// MemoryTable is a table known to MemoryTableSessions.
type MemoryTable struct {
	ID, VenueID, OrganizationID, Number string
	Active, LegacyActiveOrder           bool
	SortOrder                           int
}

// MemoryTableSessions is an in-memory tables.Repository for handler and
// contract tests. It follows the repository contract; the real guarantees
// (unique index, row locks) are tested against PostgreSQL in
// tests/integration.
type MemoryTableSessions struct {
	mu       sync.Mutex
	tables   map[string]MemoryTable
	sessions map[string]*memSession
	now      time.Time
}

type memSession struct {
	s          tables.Session
	requestKey string
}

func NewMemoryTableSessions(ts ...MemoryTable) *MemoryTableSessions {
	m := &MemoryTableSessions{tables: map[string]MemoryTable{}, sessions: map[string]*memSession{},
		now: time.Date(2026, 9, 29, 1, 2, 3, 456_000_000, time.UTC)}
	for _, t := range ts {
		m.tables[t.ID] = t
	}
	return m
}

func (m *MemoryTableSessions) table(sc tables.Scope, id string) (MemoryTable, bool) {
	t, ok := m.tables[id]
	return t, ok && t.VenueID == sc.VenueID && t.OrganizationID == sc.OrganizationID
}

func (m *MemoryTableSessions) Open(_ context.Context, cmd tables.OpenCommand) (tables.Session, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ms := range m.sessions {
		if ms.s.TableID == cmd.TableID && ms.requestKey == cmd.RequestKey {
			if _, ok := m.table(cmd.Scope, cmd.TableID); ok {
				return ms.s, false, nil
			}
		}
	}
	t, ok := m.table(cmd.Scope, cmd.TableID)
	switch {
	case !ok:
		return tables.Session{}, false, tables.ErrTableNotFound
	case !t.Active:
		return tables.Session{}, false, tables.ErrTableInactive
	case t.LegacyActiveOrder:
		return tables.Session{}, false, tables.ErrTableHasActiveOrder
	}
	for _, ms := range m.sessions {
		if ms.s.TableID == cmd.TableID && ms.s.Status == tables.StatusOpen {
			return tables.Session{}, false, &tables.AlreadyOpenError{SessionID: ms.s.ID}
		}
	}
	staff := cmd.Actor.StaffID
	s := tables.Session{ID: UUID(), VenueID: t.VenueID, TableID: t.ID, TableNumber: t.Number, Status: tables.StatusOpen,
		Covers: cmd.Covers, OpenedByStaffID: &staff, Version: 1, OpenedAt: m.now, CreatedAt: m.now, UpdatedAt: m.now}
	m.sessions[s.ID] = &memSession{s: s, requestKey: cmd.RequestKey}
	return s, true, nil
}

func (m *MemoryTableSessions) Get(_ context.Context, sc tables.Scope, id string) (tables.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if ms, ok := m.sessions[id]; ok {
		if _, ok := m.table(sc, ms.s.TableID); ok {
			return ms.s, nil
		}
	}
	return tables.Session{}, tables.ErrSessionNotFound
}

func (m *MemoryTableSessions) OpenForTable(_ context.Context, sc tables.Scope, tableID string) (tables.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.table(sc, tableID); !ok {
		return tables.Session{}, tables.ErrTableNotFound
	}
	for _, ms := range m.sessions {
		if ms.s.TableID == tableID && ms.s.Status == tables.StatusOpen {
			return ms.s, nil
		}
	}
	return tables.Session{}, tables.ErrNoOpenSession
}

func (m *MemoryTableSessions) ListOpen(_ context.Context, sc tables.Scope) ([]tables.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []tables.Session
	for _, ms := range m.sessions {
		if _, ok := m.table(sc, ms.s.TableID); ok && ms.s.Status == tables.StatusOpen {
			out = append(out, ms.s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return m.tables[out[i].TableID].SortOrder < m.tables[out[j].TableID].SortOrder })
	return out, nil
}

func (m *MemoryTableSessions) Change(_ context.Context, cmd tables.ChangeCommand) (tables.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, ok := m.sessions[cmd.SessionID]
	if !ok {
		return tables.Session{}, tables.ErrSessionNotFound
	}
	if _, ok := m.table(cmd.Scope, ms.s.TableID); !ok {
		return tables.Session{}, tables.ErrSessionNotFound
	}
	if ms.s.IdempotentEnd(cmd.Status) {
		return ms.s, nil // a retried close or cancel (Phase D10)
	}
	if err := ms.s.CheckChange(cmd.ExpectedVersion); err != nil {
		return tables.Session{}, err
	}
	m.now = m.now.Add(time.Second)
	if cmd.Covers != nil {
		ms.s.Covers = *cmd.Covers
	}
	if cmd.Status != nil {
		ms.s.Status = *cmd.Status
		closed := m.now
		ms.s.ClosedAt = &closed
	}
	ms.s.Version++
	ms.s.UpdatedAt = m.now
	return ms.s, nil
}

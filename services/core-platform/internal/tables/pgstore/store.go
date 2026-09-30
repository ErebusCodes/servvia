// Package pgstore implements tables.Repository on the Prisma-managed
// "TableSession" table (migration 20260929000000_table_sessions).
//
// Correctness does not rest on reads made before a write:
//   - one open session per table is the partial unique index
//     "TableSession_one_open_per_table"; a concurrent second open fails there
//     and is reported as *tables.AlreadyOpenError;
//   - an open retried with the same key hits the (tableId, openRequestKey)
//     unique index, or finds its own row, and returns the original session;
//   - a change locks the session row (FOR UPDATE), checks status and version,
//     and updates with the version in the predicate as well.
//
// Every change writes its AuditLog row in the same transaction.
package pgstore

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/realtime"
	realtimestore "servvia/services/core-platform/internal/realtime/pgstore"
	"servvia/services/core-platform/internal/tables"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var _ tables.Repository = (*Store)(nil)

const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
	openedByFK            = "TableSession_openedByStaffId_fkey"
)

// sessionSelect reads a session with the table fields it reports, restricted
// to a venue of an organization ($1 organization, $2 venue).
const sessionSelect = `
SELECT s.id, t."venueId", s."tableId", t."tableNumber", s.status::text, s.covers, s."openedByStaffId",
       s.version, s."openedAt", s."closedAt", s."createdAt", s."updatedAt"
FROM "TableSession" s
JOIN "Table" t ON t.id = s."tableId"
JOIN "Venue" v ON v.id = t."venueId"
WHERE v."organizationId" = $1 AND t."venueId" = $2`

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanSession(row pgx.CollectableRow) (tables.Session, error) {
	var s tables.Session
	var status string
	err := row.Scan(&s.ID, &s.VenueID, &s.TableID, &s.TableNumber, &status, &s.Covers, &s.OpenedByStaffID,
		&s.Version, &s.OpenedAt, &s.ClosedAt, &s.CreatedAt, &s.UpdatedAt)
	s.Status = tables.Status(status)
	return s, err
}

// one returns the single session a query finds, or notFound.
func one(ctx context.Context, q querier, notFound error, sql string, args ...any) (tables.Session, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return tables.Session{}, fmt.Errorf("query table session: %w", err)
	}
	s, err := pgx.CollectExactlyOneRow(rows, scanSession)
	if errors.Is(err, pgx.ErrNoRows) {
		return tables.Session{}, notFound
	}
	if err != nil {
		return tables.Session{}, fmt.Errorf("read table session: %w", err)
	}
	return s, nil
}

func (st *Store) Get(ctx context.Context, sc tables.Scope, id string) (tables.Session, error) {
	return one(ctx, st.pool, tables.ErrSessionNotFound, sessionSelect+` AND s.id = $3`, sc.OrganizationID, sc.VenueID, id)
}

func (st *Store) OpenForTable(ctx context.Context, sc tables.Scope, tableID string) (tables.Session, error) {
	s, err := one(ctx, st.pool, tables.ErrNoOpenSession,
		sessionSelect+` AND s."tableId" = $3 AND s.status = 'open'`, sc.OrganizationID, sc.VenueID, tableID)
	if errors.Is(err, tables.ErrNoOpenSession) {
		// Distinguish "no open session" from "no such table here".
		if _, _, terr := tableAt(ctx, st.pool, sc, tableID, false); terr != nil {
			return tables.Session{}, terr
		}
	}
	return s, err
}

func (st *Store) ListOpen(ctx context.Context, sc tables.Scope) ([]tables.Session, error) {
	rows, err := st.pool.Query(ctx, sessionSelect+` AND s.status = 'open' ORDER BY t."sortOrder", t."tableNumber"`,
		sc.OrganizationID, sc.VenueID)
	if err != nil {
		return nil, fmt.Errorf("query open table sessions: %w", err)
	}
	return pgx.CollectRows(rows, scanSession)
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// tableAt returns a table's number and whether it is in service, if it
// belongs to the scope's venue and organization. With lock, the row is held
// FOR SHARE until the transaction ends, so it cannot be taken out of
// service meanwhile (the legacy order path locks the same row FOR UPDATE).
func tableAt(ctx context.Context, q rowQuerier, sc tables.Scope, tableID string, lock bool) (number string, active bool, err error) {
	sql := `SELECT t."tableNumber", t."isActive" FROM "Table" t JOIN "Venue" v ON v.id = t."venueId"
		WHERE t.id = $1 AND t."venueId" = $2 AND v."organizationId" = $3`
	if lock {
		sql += ` FOR SHARE OF t`
	}
	err = q.QueryRow(ctx, sql, tableID, sc.VenueID, sc.OrganizationID).Scan(&number, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, tables.ErrTableNotFound
	}
	if err != nil {
		return "", false, fmt.Errorf("load table: %w", err)
	}
	return number, active, nil
}

// maxOpenAttempts bounds retries of an open that lost a race to a session
// that ended before the loser could read it (open, then closed at once).
const maxOpenAttempts = 3

func (st *Store) Open(ctx context.Context, cmd tables.OpenCommand) (tables.Session, bool, error) {
	for attempt := 1; ; attempt++ {
		s, err := st.openOnce(ctx, cmd)
		var pgErr *pgconn.PgError
		switch {
		case err == nil:
			return s, true, nil
		case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation && pgErr.ConstraintName == openedByFK:
			return tables.Session{}, false, tables.ErrUnknownActor
		case !(errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation):
			var replay replayed
			if errors.As(err, &replay) {
				return replay.session, false, nil
			}
			return tables.Session{}, false, err
		}
		// Unique violation: a concurrent request committed first. Either it
		// was this same request (same key: return its session) or another
		// open of this table.
		if s, err := st.byKey(ctx, cmd); err == nil {
			return s, false, nil
		} else if !errors.Is(err, tables.ErrSessionNotFound) {
			return tables.Session{}, false, err
		}
		if s, err := st.OpenForTable(ctx, cmd.Scope, cmd.TableID); err == nil {
			return tables.Session{}, false, &tables.AlreadyOpenError{SessionID: s.ID}
		} else if !errors.Is(err, tables.ErrNoOpenSession) {
			return tables.Session{}, false, err
		}
		if attempt == maxOpenAttempts {
			return tables.Session{}, false, fmt.Errorf("open table session: still conflicting after %d attempts", attempt)
		}
	}
}

// replayed carries the session an earlier request with the same key opened.
type replayed struct{ session tables.Session }

func (replayed) Error() string { return "replayed" }

func (st *Store) byKey(ctx context.Context, cmd tables.OpenCommand) (tables.Session, error) {
	return one(ctx, st.pool, tables.ErrSessionNotFound,
		sessionSelect+` AND s."tableId" = $3 AND s."openRequestKey" = $4`,
		cmd.Scope.OrganizationID, cmd.Scope.VenueID, cmd.TableID, cmd.RequestKey)
}

func (st *Store) openOnce(ctx context.Context, cmd tables.OpenCommand) (tables.Session, error) {
	var created tables.Session
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		// A retry of a request that already succeeded returns its session,
		// whatever has happened to it since.
		if s, err := st.byKeyTx(ctx, tx, cmd); err == nil {
			return replayed{s}
		} else if !errors.Is(err, tables.ErrSessionNotFound) {
			return err
		}
		number, active, err := tableAt(ctx, tx, cmd.Scope, cmd.TableID, true)
		if err != nil {
			return err
		}
		if !active {
			return tables.ErrTableInactive
		}
		// Transitional guard: a table occupied by an active order from the
		// NestJS order path (no table session) cannot also be opened. Orders
		// that belong to a session are that session's business, not
		// occupancy. Remove with the Nest-side occupancy bridge, when table
		// order creation has switched to Servvia Core.
		var legacyActive bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "Order"
			WHERE "venueId" = $1 AND ("tableId" = $2 OR "tableNumber" = $3) AND "tableSessionId" IS NULL
			  AND status IN ('pending', 'confirmed', 'preparing', 'ready'))`,
			cmd.Scope.VenueID, cmd.TableID, number).Scan(&legacyActive); err != nil {
			return fmt.Errorf("check legacy active order: %w", err)
		}
		if legacyActive {
			return tables.ErrTableHasActiveOrder
		}
		if _, err := tx.Exec(ctx, `INSERT INTO "TableSession"
			(id, "tableId", covers, "openedByStaffId", "openRequestKey", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, now())`,
			newID(), cmd.TableID, cmd.Covers, cmd.Actor.StaffID, cmd.RequestKey); err != nil {
			return err
		}
		s, err := st.byKeyTx(ctx, tx, cmd)
		if err != nil {
			return err
		}
		created = s
		if err := recordFact(ctx, tx, "table_session.opened", s); err != nil {
			return err
		}
		return audit(ctx, tx, cmd.Scope, cmd.Actor, "TABLE_SESSION_OPENED", s.ID, nil, snapshot(s))
	})
	return created, err
}

func (st *Store) byKeyTx(ctx context.Context, tx pgx.Tx, cmd tables.OpenCommand) (tables.Session, error) {
	return one(ctx, tx, tables.ErrSessionNotFound,
		sessionSelect+` AND s."tableId" = $3 AND s."openRequestKey" = $4`,
		cmd.Scope.OrganizationID, cmd.Scope.VenueID, cmd.TableID, cmd.RequestKey)
}

func (st *Store) Change(ctx context.Context, cmd tables.ChangeCommand) (tables.Session, error) {
	var changed tables.Session
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		before, err := one(ctx, tx, tables.ErrSessionNotFound, sessionSelect+` AND s.id = $3 FOR UPDATE OF s`,
			cmd.Scope.OrganizationID, cmd.Scope.VenueID, cmd.SessionID)
		if err != nil {
			return err
		}
		// A retried close (or cancel) of a session that already ended that
		// way succeeds with no effect: no second transition, no second audit.
		if before.IdempotentEnd(cmd.Status) {
			changed = before
			return nil
		}
		if err := before.CheckChange(cmd.ExpectedVersion); err != nil {
			return err
		}
		var readiness *tables.CloseReadiness
		covers, status, action := before.Covers, before.Status, "TABLE_SESSION_COVERS_UPDATED"
		if cmd.Covers != nil {
			covers = *cmd.Covers
		}
		if cmd.Status != nil {
			if !before.Status.CanBecome(*cmd.Status) {
				return &tables.NotOpenError{Status: before.Status}
			}
			status = *cmd.Status
			// Cancelled means opened in error: a visit that has orders happened.
			if status == tables.StatusCancelled {
				var hasOrders bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "Order" WHERE "tableSessionId" = $1)`,
					cmd.SessionID).Scan(&hasOrders); err != nil {
					return fmt.Errorf("check session orders: %w", err)
				}
				if hasOrders {
					return tables.ErrSessionHasOrders
				}
			}
			// Closing requires a financially complete visit (Phase D10).
			if status == tables.StatusClosed {
				r, err := closeReadiness(ctx, tx, cmd.SessionID)
				if err != nil {
					return err
				}
				if !r.Closeable() {
					return &tables.NotCompleteError{Readiness: r}
				}
				readiness = &r
			}
			action = map[tables.Status]string{tables.StatusClosed: "TABLE_SESSION_CLOSED", tables.StatusCancelled: "TABLE_SESSION_CANCELLED"}[status]
		}
		tag, err := tx.Exec(ctx, `UPDATE "TableSession" SET covers = $3, status = $4::"TableSessionStatus",
			"closedAt" = CASE WHEN $4::"TableSessionStatus" = 'open' THEN NULL ELSE now() END,
			version = version + 1, "updatedAt" = now()
			WHERE id = $1 AND version = $2 AND status = 'open'`,
			cmd.SessionID, cmd.ExpectedVersion, covers, string(status))
		if err != nil {
			return fmt.Errorf("update table session: %w", err)
		}
		if tag.RowsAffected() != 1 {
			// Unreachable while the row is locked; kept so a lost lock can
			// never turn into a silent overwrite.
			return &tables.VersionConflictError{Current: before.Version}
		}
		changed, err = one(ctx, tx, tables.ErrSessionNotFound, sessionSelect+` AND s.id = $3`,
			cmd.Scope.OrganizationID, cmd.Scope.VenueID, cmd.SessionID)
		if err != nil {
			return err
		}
		after := snapshot(changed)
		if readiness != nil {
			after["closeReadiness"] = readiness
		}
		// Only an ended visit is a realtime fact (Phase D12); a covers change
		// is not published. Closed stays closed: a later refund or
		// re-settlement is a check fact and never reopens the session.
		if fact, ended := map[tables.Status]string{tables.StatusClosed: "table_session.closed",
			tables.StatusCancelled: "table_session.cancelled"}[changed.Status]; ended && before.Status == tables.StatusOpen {
			if err := recordFact(ctx, tx, fact, changed); err != nil {
				return err
			}
		}
		return audit(ctx, tx, cmd.Scope, cmd.Actor, action, changed.ID, snapshot(before), after)
	})
	return changed, err
}

// closeReadiness is the canonical, executable form of the visit
// financial-completeness rule (Phase D10; documented, and cross-checked by a
// test, in docs/migration/checks/visit-financially-complete.sql). It runs in
// the close's transaction, after the session is locked FOR UPDATE (so no
// order, round or check can be added to the visit meanwhile: they hold it
// FOR SHARE) and after the visit's checks are locked FOR SHARE in id order
// (so a payment result, refund, reversal or void holding a check commits
// first and is counted). The lock order is TableSession -> Check, the global
// order's prefix (TableSession -> Order -> Check -> CheckPayment -> Shift).
func closeReadiness(ctx context.Context, tx pgx.Tx, sessionID string) (tables.CloseReadiness, error) {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM "Check" WHERE "tableSessionId" = $1 ORDER BY id FOR SHARE`, sessionID); err != nil {
		return tables.CloseReadiness{}, fmt.Errorf("lock visit checks: %w", err)
	}
	var r tables.CloseReadiness
	err := tx.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM "Check" c WHERE c."tableSessionId" = $1 AND c.status = 'open'),
		(SELECT count(*) FROM "OrderItem" i
		   JOIN "OrderRound" rd ON rd.id = i."roundId"
		   JOIN "Order" o ON o.id = i."orderId"
		  WHERE o."tableSessionId" = $1 AND o.status <> 'cancelled'
		    AND NOT EXISTS (SELECT 1 FROM "CheckLine" l WHERE l."orderItemId" = i.id AND l."voidedAt" IS NULL)),
		(SELECT count(*) FROM "CheckPayment" p JOIN "Check" c ON c.id = p."checkId"
		  WHERE c."tableSessionId" = $1 AND p.status IN ('pending', 'uncertain')),
		(SELECT count(*) FROM "PaymentAdjustment" a JOIN "CheckPayment" p ON p.id = a."paymentId"
		   JOIN "Check" c ON c.id = p."checkId"
		  WHERE c."tableSessionId" = $1 AND a.status IN ('pending', 'uncertain'))`, sessionID).
		Scan(&r.OpenChecks, &r.UnbilledLines, &r.UnresolvedPayments, &r.UnresolvedAdjustments)
	if err != nil {
		return tables.CloseReadiness{}, fmt.Errorf("evaluate visit completeness: %w", err)
	}
	return r, nil
}

// snapshot is the audited state of a session.
func snapshot(s tables.Session) map[string]any {
	return map[string]any{"tableId": s.TableID, "status": s.Status, "covers": s.Covers, "version": s.Version}
}

// audit records a change in the existing AuditLog, in the change's transaction.
func audit(ctx context.Context, tx pgx.Tx, sc tables.Scope, a tables.Actor, action, sessionID string, before, after map[string]any) error {
	var beforeJSON, afterJSON []byte
	if before != nil {
		beforeJSON, _ = json.Marshal(before)
	}
	afterJSON, _ = json.Marshal(after)
	_, err := tx.Exec(ctx, `INSERT INTO "AuditLog"
		(id, "organizationId", "venueId", "actorId", "actorEmail", "actorRole", action, resource, "resourceId", before, after)
		VALUES ($1, $2, $3, $4, $5, $6::"StaffRole", $7, 'table_session', $8, $9, $10)`,
		newID(), sc.OrganizationID, sc.VenueID, a.StaffID, a.Email, a.Role, action, sessionID, beforeJSON, afterJSON)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation {
			return tables.ErrUnknownActor
		}
		return fmt.Errorf("write audit log: %w", err)
	}
	return nil
}

// newID is a random v4 UUID, the form of every Prisma @default(uuid()) id.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// recordFact records a table-session fact in the transaction that made the
// change (Phase D12).
func recordFact(ctx context.Context, tx pgx.Tx, eventType string, s tables.Session) error {
	_, err := realtimestore.Record(ctx, tx, s.VenueID, realtime.Fact{Type: eventType, AggregateType: "table_session",
		AggregateID: s.ID, Version: realtime.V(s.Version), Payload: map[string]any{
			"tableSessionId": s.ID, "tableId": s.TableID, "tableNumber": s.TableNumber, "status": s.Status, "covers": s.Covers}})
	return err
}

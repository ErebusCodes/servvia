import { JwtPayload } from './interfaces/jwt-payload.interface';

/**
 * The 401 message for a deactivated staff member or a revoked login session
 * (Story 2.5). The Go Core answers with the same message
 * (identity.StaffSessionEndedMessage).
 */
export const STAFF_SESSION_ENDED_MESSAGE = 'Session expired or account deactivated';

/** A staff login session: `kind` absent, or the declared-but-unissued 'staff'. */
export function isStaffSessionKind(kind: JwtPayload['kind']): boolean {
  return kind === undefined || kind === 'staff';
}

/**
 * Token kinds whose subject is a Staff row: a login session, and a tablet
 * elevated by a staff or manager PIN. Device kinds (KDS, an unelevated
 * tablet) have synthetic subjects and are not re-checked as staff.
 */
export function isStaffSubjectKind(kind: JwtPayload['kind']): boolean {
  return isStaffSessionKind(kind) || kind === 'tablet_staff' || kind === 'tablet_manager';
}

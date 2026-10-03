import { HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { StaffService } from '../staff/staff.service';
import { StaffSessionService } from './staff-session.service';
import {
  STAFF_SESSION_ENDED_MESSAGE,
  isStaffSessionKind,
  isStaffSubjectKind,
} from './staff-session';

/** A staff session check that could not be made; callers must fail closed. */
export class StaffSessionCheckError extends Error {
  constructor() {
    super('Staff session check failed');
  }
}

/**
 * Stories 2.5 and 2.8: a valid signature is not enough. For a token whose
 * subject is a staff member, the staff member must still be active (not
 * deactivated, not deleted, in an active organization) and still hold the
 * role the token carries; a login session must carry a `sid` whose session
 * row is live (not logged out, reset or revoked, not expired). Used by the
 * HTTP strategy and by the socket.io gateway, so both apply the same rules.
 */
@Injectable()
export class StaffSessionVerifier {
  private readonly logger = new Logger(StaffSessionVerifier.name);

  constructor(
    private readonly staffService: StaffService,
    private readonly sessions: StaffSessionService,
  ) {}

  /**
   * Resolves when the token may still be used. Rejects with
   * UnauthorizedException when it may not, and with StaffSessionCheckError
   * when the check cannot be made. Device kinds (KDS, an unelevated tablet)
   * are not staff and always resolve.
   */
  async assertLive(payload: JwtPayload): Promise<void> {
    if (!isStaffSubjectKind(payload.kind)) return;
    try {
      if (isStaffSessionKind(payload.kind)) {
        if (!payload.sid || !(await this.sessions.isLive(payload.sid, payload.sub))) {
          throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
        }
      }
      const staff = await this.staffService.findById(payload.sub);
      // A role change ends tokens minted under the old role (Story 2.8).
      if (!staff || !staff.isActive || staff.role !== payload.role) {
        throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
      }
    } catch (err) {
      if (err instanceof HttpException) {
        if (err instanceof UnauthorizedException) {
          this.logger.warn(
            `staff_session_refused staff_id=${payload.sub} kind=${payload.kind ?? 'staff_session'} role=${payload.role}`,
          );
        }
        throw err;
      }
      this.logger.error(`Staff session check failed: ${(err as Error).message}`);
      throw new StaffSessionCheckError();
    }
  }
}

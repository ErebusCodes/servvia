import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ms from 'ms';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Why a staff session ended (StaffSession.revokedReason). */
export type StaffSessionRevocationReason =
  | 'logout'
  | 'credential_reset'
  | 'credential_setup'
  | 'role_changed'
  | 'deactivated'
  | 'removed';

/**
 * How long an expired session row is kept before deletion. After expiresAt
 * no token of the session can be valid, so the margin only absorbs clock
 * differences between hosts.
 */
export const EXPIRED_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Staff login sessions in the canonical database (Story 2.8). The session row
 * decides whether every token carrying its `sid` may still be used; Go Core
 * reads the same row (identity.PostgresSessions). Errors propagate: a caller
 * that cannot read a session must fail closed.
 */
@Injectable()
export class StaffSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Starts a session for a sign-in; its id becomes the tokens' `sid`. */
  async start(staffId: string, now: Date = new Date()): Promise<string> {
    const lifetime = ms(this.config.get<string>('JWT_REFRESH_EXPIRY', '7d') as ms.StringValue);
    const session = await this.prisma.staffSession.create({
      data: { staffId, expiresAt: new Date(now.getTime() + lifetime) },
      select: { id: true },
    });
    return session.id;
  }

  /** Whether the session exists, belongs to the staff member, and is neither revoked nor expired. */
  async isLive(sessionId: string, staffId: string, now: Date = new Date()): Promise<boolean> {
    const count = await this.prisma.staffSession.count({
      where: { id: sessionId, staffId, revokedAt: null, expiresAt: { gt: now } },
    });
    return count > 0;
  }

  /** Revokes one session of a staff member. Idempotent: a second logout changes nothing. */
  async revoke(
    sessionId: string,
    staffId: string,
    reason: StaffSessionRevocationReason,
  ): Promise<void> {
    await this.prisma.staffSession.updateMany({
      where: { id: sessionId, staffId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /**
   * Revokes every live session of a staff member; returns how many. Pass the
   * caller's transaction so the revocation commits, or fails, together with
   * the change that removed the staff member's authority.
   */
  async revokeAllForStaff(
    staffId: string,
    reason: StaffSessionRevocationReason,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const result = await tx.staffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  /** Deletes sessions that expired more than EXPIRED_SESSION_RETENTION_MS ago. */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.staffSession.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - EXPIRED_SESSION_RETENTION_MS) } },
    });
    return result.count;
  }
}

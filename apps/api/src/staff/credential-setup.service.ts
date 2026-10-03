import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { StaffSessionService } from '../auth/staff-session.service';

/**
 * How long a credential setup code stays usable (Story 8.1). Long enough to
 * hand a new staff member their code at the start of a shift, short enough
 * that an unused code does not linger.
 */
export const CREDENTIAL_SETUP_TTL_MS = 24 * 60 * 60 * 1000;

/** The message for every refused code: it never says why. */
export const INVALID_SETUP_CODE_MESSAGE = 'Invalid or expired setup code';

// Verified when a code names no token, so a missing token and a wrong
// secret take comparable time.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$ny2DnHXAff2D5lmWycbuTw$LxRCa+qjRHgy6Uj9tsonUQ0Xx+6lH//N/p/0bMoRGmk';

/** Who issues a setup code: a staff member, or a named system process. */
export type CredentialSetupIssuer = { staffId: string } | { system: string };

/** An Argon2id hash nobody knows the input of: an account that cannot sign in yet. */
export async function unusablePasswordHash(): Promise<string> {
  return argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id });
}

/**
 * Single-use credential setup codes (Story 8.1). An owner or admin never
 * chooses or sees a staff member's password: creating an account or
 * resetting its credential issues a code, shown once, and the staff member
 * sets their own password with it. Only an Argon2id hash of the secret is
 * stored, and neither the code nor the password is ever logged or audited.
 */
@Injectable()
export class CredentialSetupService {
  private readonly logger = new Logger(CredentialSetupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly sessions: StaffSessionService,
  ) {}

  /**
   * Issues a new code for a staff member, ending their earlier unused codes.
   * The issuer is the owner or admin issuing it, or the operator bootstrap
   * command (Story 2.4). Runs inside the caller's transaction when one is
   * given.
   */
  async issue(
    staffId: string,
    issuer: CredentialSetupIssuer,
    tx: Prisma.TransactionClient = this.prisma,
    now: Date = new Date(),
  ): Promise<{ code: string; expiresAt: Date }> {
    await tx.staffCredentialToken.updateMany({
      where: { staffId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + CREDENTIAL_SETUP_TTL_MS);
    const token = await tx.staffCredentialToken.create({
      data: {
        staffId,
        ...('staffId' in issuer
          ? { issuedById: issuer.staffId }
          : { issuedBySystem: issuer.system }),
        expiresAt,
        tokenHash: await argon2.hash(secret, { type: argon2.argon2id }),
      },
      select: { id: true },
    });
    return { code: `${token.id}.${secret}`, expiresAt };
  }

  /**
   * Sets the staff member's password from a valid code: the code is used
   * once, every existing session of the staff member is revoked, and the
   * change is audited (without the code or the password), all in one
   * transaction. Any invalid,
   * expired, used, replaced or foreign code gets the same refusal.
   */
  async redeem(
    code: string,
    newPassword: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const separator = typeof code === 'string' ? code.indexOf('.') : -1;
    const id = separator > 0 ? code.slice(0, separator) : '';
    const secret = separator > 0 ? code.slice(separator + 1) : '';
    const token = id
      ? await this.prisma.staffCredentialToken.findUnique({
          where: { id },
          include: { staff: { include: { organization: true } } },
        })
      : null;
    let secretMatches = false;
    try {
      secretMatches = await argon2.verify(token?.tokenHash ?? DUMMY_HASH, secret);
    } catch {
      secretMatches = false;
    }
    const now = new Date();
    if (
      !token ||
      !secretMatches ||
      token.usedAt ||
      token.revokedAt ||
      token.expiresAt <= now ||
      !token.staff.isActive ||
      token.staff.deletedAt ||
      !token.staff.organization.isActive
    ) {
      this.logger.warn('Credential setup refused');
      throw new UnauthorizedException(INVALID_SETUP_CODE_MESSAGE);
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      // Single use, even under concurrent redemptions.
      const claimed = await tx.staffCredentialToken.updateMany({
        where: { id: token.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException(INVALID_SETUP_CODE_MESSAGE);
      }
      await tx.staff.update({ where: { id: token.staffId }, data: { passwordHash } });
      await this.sessions.revokeAllForStaff(token.staffId, 'credential_setup', tx);
      await this.audit.logAuthEvent(
        {
          organizationId: token.staff.organizationId,
          actorId: token.staff.id,
          actorEmail: token.staff.email,
          actorRole: token.staff.role,
          action: 'STAFF_CREDENTIAL_SET',
          resource: 'staff',
          resourceId: token.staff.id,
          ipAddress,
          userAgent,
        },
        tx,
      );
    });
  }
}

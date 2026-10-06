import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { ConnectorInstallation, Prisma, StaffRole } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { AUDIT_DEVICE_KINDS } from '../audit/audit-actor';
import { ConnectorHeartbeatDto } from './dto/connector-heartbeat.dto';

/**
 * A fixed, non-secret Argon2id hash used only as a decoy verification
 * target for candidates that don't resolve to a real row (unknown
 * enrollment id, unknown installation id, expired/used/revoked/replaced
 * row). Verifying against this instead of short-circuiting keeps lookup
 * time roughly constant between "wrong secret" and "no such record",
 * mirroring the established pattern in staff.service.ts#verifyPassword.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$ny2DnHXAff2D5lmWycbuTw$LxRCa+qjRHgy6Uj9tsonUQ0Xx+6lH//N/p/0bMoRGmk';

const ENROLLMENT_TTL_MS = 15 * 60 * 1000;

export interface ConnectorIdentity {
  installationId: string;
  organizationId: string;
  venueId: string;
}

export interface ConnectorStatusView {
  installationId: string;
  status: ConnectorInstallation['status'];
  reportedVersion: string | null;
  reportedCapabilities: unknown;
  lastSeenAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  replacedByInstallationId: string | null;
}

/**
 * Story 2-9: connector identity tracer. This service proves enrolment,
 * durable authentication, revocation, rotation, and tenant isolation for a
 * venue connector identity. It never contacts Idealpos, EFTPOS, a printer,
 * or a Windows host, and no method here may be read as evidence that any
 * such contact occurred — see the story file's explicit truthfulness
 * boundary.
 */
@Injectable()
export class ConnectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * A durable operation (enrolment creation, credential issuance,
   * revocation) has already committed by the time this is called — a
   * transient audit-log write failure must not turn that into a client-
   * visible 500 (which, for redeemEnrollment specifically, would strand an
   * already-consumed single-use bootstrap token with its credential never
   * delivered). Mirrors the established
   * PrinterJobsService#logAuditEventSafely convention.
   */
  private async logAuditEventSafely(
    event: Parameters<AuditLogService['logAuthEvent']>[0],
  ): Promise<void> {
    try {
      await this.auditLogService.logAuthEvent(event);
    } catch (auditError) {
      console.error(
        '[ConnectorService] audit log write failed (non-fatal):',
        event.action,
        auditError,
      );
    }
  }

  private splitToken(token: string): [string, string] | [undefined, undefined] {
    if (typeof token !== 'string') return [undefined, undefined];
    const separatorIndex = token.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) return [undefined, undefined];
    return [token.slice(0, separatorIndex), token.slice(separatorIndex + 1)];
  }

  async createEnrollment(
    organizationId: string,
    venueId: string,
    createdByStaffId: string,
    createdByStaffEmail: string,
    createdByStaffRole: StaffRole,
  ): Promise<{ enrollmentId: string; bootstrapToken: string; expiresAt: Date }> {
    // Service-boundary tenant check: a venueId is not implicitly proof of
    // organization ownership (the venueId/organizationId FKs on
    // ConnectorEnrollment are independent), so an admin from org A must be
    // rejected here even if they somehow reference a real venue in org B —
    // this is checked in addition to, not instead of, the DB-level FKs.
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, organizationId } });
    if (!venue) {
      throw new NotFoundException('Venue not found in your organization');
    }

    const code = randomBytes(32).toString('base64url');
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);

    const enrollment = await this.prisma.connectorEnrollment.create({
      data: {
        organizationId,
        venueId,
        codeHash,
        createdByStaffId,
        expiresAt,
      },
    });

    await this.logAuditEventSafely({
      organizationId,
      venueId,
      actorId: createdByStaffId,
      actorEmail: createdByStaffEmail,
      actorRole: createdByStaffRole,
      action: 'CONNECTOR_ENROLLMENT_CREATED',
      resource: 'connector_enrollment',
      resourceId: enrollment.id,
      after: { venueId, expiresAt: expiresAt.toISOString() },
    });

    return { enrollmentId: enrollment.id, bootstrapToken: `${enrollment.id}.${code}`, expiresAt };
  }

  /**
   * Exchanges a short-lived, single-use bootstrap token for a durable
   * connector installation identity. Single-use enforcement and the
   * "at most one active installation per venue" invariant are both
   * enforced by the database (a guarded updateMany CAS and a partial
   * unique index respectively, see migration 20260816140000) — this
   * method's transaction ordering exists to make the common case succeed
   * without a retry, not to substitute for those DB-level guarantees.
   */
  async redeemEnrollment(
    bootstrapToken: string,
  ): Promise<{ installationId: string; credential: string }> {
    const [enrollmentId, code] = this.splitToken(bootstrapToken);
    if (!enrollmentId || !code) {
      throw new UnauthorizedException('Invalid bootstrap token');
    }

    const enrollment = await this.prisma.connectorEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    const isValidCandidate =
      !!enrollment && !enrollment.usedAt && enrollment.expiresAt > new Date();
    const hashToVerify = isValidCandidate ? enrollment.codeHash : DUMMY_HASH;

    let codeMatches: boolean;
    try {
      codeMatches = await argon2.verify(hashToVerify, code);
    } catch {
      codeMatches = false;
    }

    if (!isValidCandidate || !codeMatches) {
      throw new UnauthorizedException('Bootstrap token is invalid, expired, or already used');
    }

    const secret = randomBytes(32).toString('base64url');
    const secretHash = await argon2.hash(secret, { type: argon2.argon2id });

    try {
      const installation = await this.prisma.$transaction(async (tx) => {
        // Single-use AND expiry enforcement live in the same guarded
        // update: the isValidCandidate check above ran before the (slow,
        // memory-hard) argon2.verify call and before this transaction even
        // opened, so re-checking only `usedAt` here would leave a real
        // TOCTOU gap — a token could cross its expiry boundary in that
        // window and still be redeemed. Folding `expiresAt` into the same
        // CAS closes it: only one concurrent redeemer can flip usedAt from
        // null, and only while still unexpired. The loser's count is 0 and
        // it is rejected below, never silently ignored.
        const consumed = await tx.connectorEnrollment.updateMany({
          where: { id: enrollment.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (consumed.count !== 1) {
          throw new ConflictException('Bootstrap token is invalid, expired, or already used');
        }

        const priorActive = await tx.connectorInstallation.findFirst({
          where: { venueId: enrollment.venueId, status: 'active' },
        });

        if (priorActive) {
          // Best-effort: if a concurrent rotation already replaced this
          // row, this CAS affects 0 rows and we fall through to the
          // insert below, which the partial unique index (the actual
          // correctness boundary) will then reject with P2002 if a
          // second active row already exists.
          await tx.connectorInstallation.updateMany({
            where: { id: priorActive.id, status: 'active' },
            data: { status: 'replaced' },
          });
        }

        const created = await tx.connectorInstallation.create({
          data: {
            organizationId: enrollment.organizationId,
            venueId: enrollment.venueId,
            enrollmentId: enrollment.id,
            secretHash,
            status: 'active',
          },
        });

        if (priorActive) {
          await tx.connectorInstallation.update({
            where: { id: priorActive.id },
            data: { replacedByInstallationId: created.id },
          });
        }

        return created;
      });

      // The durable installation above has already committed. A transient
      // failure writing the audit
      // row must not turn an already-successful enrolment into a 500 that
      // strands the connector without its now-unrecoverable (single-use)
      // credential — see logAuditEventSafely's doc comment.
      try {
        // Story 12.15: the connector redeemed its own enrolment, so the
        // actor is the new installation (a device), not a synthetic Staff row.
        await this.auditLogService.logAuthEvent({
          organizationId: enrollment.organizationId,
          venueId: enrollment.venueId,
          actorType: 'device',
          deviceKind: AUDIT_DEVICE_KINDS.venueConnector,
          deviceId: installation.id,
          action: 'CONNECTOR_ENROLLED',
          resource: 'connector_installation',
          resourceId: installation.id,
          after: { enrollmentId: enrollment.id },
        });
      } catch (auditError) {
        console.error(
          '[ConnectorService] audit log write failed (non-fatal):',
          'CONNECTOR_ENROLLED',
          auditError,
        );
      }

      return { installationId: installation.id, credential: `${installation.id}.${secret}` };
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A concurrent enrolment or rotation for this venue is already in progress — retry shortly',
        );
      }
      throw error;
    }
  }

  /**
   * Resolves a bearer credential (`${installationId}.${secret}`) to the
   * connector's identity, or null if it does not authenticate. Returns
   * null rather than throwing so the guard controls the HTTP response
   * shape; every caller must treat null as "reject the request."
   */
  async authenticate(credential: string): Promise<ConnectorIdentity | null> {
    const [installationId, secret] = this.splitToken(credential);
    if (!installationId || !secret) return null;

    const installation = await this.prisma.connectorInstallation.findUnique({
      where: { id: installationId },
    });
    const isActive = !!installation && installation.status === 'active';
    const hashToVerify = isActive ? installation.secretHash : DUMMY_HASH;

    let secretMatches: boolean;
    try {
      secretMatches = await argon2.verify(hashToVerify, secret);
    } catch {
      secretMatches = false;
    }

    if (!isActive || !secretMatches) return null;

    // Re-checked as a CAS, not best-effort: this is the actual real-time
    // revocation enforcement point (every request re-authenticates here,
    // see ConnectorAuthGuard), so a revoke landing between the read above
    // and this write must make authenticate() itself reject the request —
    // not just fail to bump lastSeenAt while still returning an identity.
    const stillActive = await this.prisma.connectorInstallation.updateMany({
      where: { id: installation.id, status: 'active' },
      data: { lastSeenAt: new Date() },
    });
    if (stillActive.count !== 1) return null;

    return {
      installationId: installation.id,
      organizationId: installation.organizationId,
      venueId: installation.venueId,
    };
  }

  async reportHealth(identity: ConnectorIdentity, dto: ConnectorHeartbeatDto): Promise<void> {
    const result = await this.prisma.connectorInstallation.updateMany({
      where: { id: identity.installationId, status: 'active' },
      data: {
        lastSeenAt: new Date(),
        ...(dto.version !== undefined ? { reportedVersion: dto.version } : {}),
        ...(dto.capabilities !== undefined
          ? { reportedCapabilities: dto.capabilities as Prisma.InputJsonValue }
          : {}),
      },
    });
    if (result.count !== 1) {
      throw new UnauthorizedException('Connector installation is no longer active');
    }
  }

  async revoke(
    installationId: string,
    organizationId: string,
    venueId: string,
    revokedByStaffId: string,
  ): Promise<void> {
    const result = await this.prisma.connectorInstallation.updateMany({
      where: { id: installationId, organizationId, venueId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date(), revokedByStaffId },
    });
    if (result.count !== 1) {
      throw new NotFoundException(
        'No active connector installation found for this venue in your organization',
      );
    }

    // The revocation above has already committed — it is the security-
    // critical effect. A transient failure looking up the acting staff
    // record or writing the audit row must not be reported back as a
    // failed revocation when the connector is, in fact, already revoked.
    try {
      const revokedBy = await this.prisma.staff.findUniqueOrThrow({
        where: { id: revokedByStaffId },
      });
      await this.auditLogService.logAuthEvent({
        organizationId,
        venueId,
        actorId: revokedBy.id,
        actorEmail: revokedBy.email,
        actorRole: revokedBy.role,
        action: 'CONNECTOR_REVOKED',
        resource: 'connector_installation',
        resourceId: installationId,
      });
    } catch (auditError) {
      console.error(
        '[ConnectorService] audit log write failed (non-fatal):',
        'CONNECTOR_REVOKED',
        auditError,
      );
    }
  }

  async getStatus(organizationId: string, venueId: string): Promise<ConnectorStatusView[]> {
    const installations = await this.prisma.connectorInstallation.findMany({
      where: { organizationId, venueId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        reportedVersion: true,
        reportedCapabilities: true,
        lastSeenAt: true,
        createdAt: true,
        revokedAt: true,
        replacedByInstallationId: true,
      },
    });

    return installations.map((installation) => ({
      installationId: installation.id,
      status: installation.status,
      reportedVersion: installation.reportedVersion,
      reportedCapabilities: installation.reportedCapabilities,
      lastSeenAt: installation.lastSeenAt,
      createdAt: installation.createdAt,
      revokedAt: installation.revokedAt,
      replacedByInstallationId: installation.replacedByInstallationId,
    }));
  }
}

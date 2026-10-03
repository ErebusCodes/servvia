import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { Staff, StaffRole, TabletDevice } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { AUDIT_DEVICE_KINDS } from '../audit/audit-actor';
import { safeCompare } from '../common/utils/safe-compare';
import { assertPinNotInsecureDefault } from '../auth/utils/insecure-default-pin.util';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * Story 15-1 / DL-081 — Order Tablet device identity, restricted/customer
 * context, named staff elevation, and manager step-up. A deliberately
 * separate domain from ConnectorService (story 2-9): same proven security
 * properties (Argon2id-hashed single-use enrollment code, Argon2id-hashed
 * durable device secret, CAS-guarded revocation re-check), adapted rather
 * than shared, because a tablet and a venue connector are different trust
 * boundaries — many tablets per venue is normal, a tablet is
 * customer-facing, and this service additionally layers named staff PINs
 * and manager step-up on top, neither of which the connector has.
 *
 * This service never implements void/refund/payment/reprint business
 * logic — it only proves who (device / customer-context / staff / manager)
 * is authorized to act, for later stories to consume.
 */

// Fixed, non-secret Argon2id hash used only as a decoy verification target
// for lookups that don't resolve to a real row or real candidate — keeps
// verification time roughly constant between "wrong PIN/secret" and
// "no such record", mirroring connector.service.ts's DUMMY_HASH pattern.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$ny2DnHXAff2D5lmWycbuTw$LxRCa+qjRHgy6Uj9tsonUQ0Xx+6lH//N/p/0bMoRGmk';

const ENROLLMENT_TTL_MS = 15 * 60 * 1000;

export interface TabletDeviceIdentity {
  deviceId: string;
  organizationId: string;
  venueId: string;
  label: string;
}

export interface TabletDeviceView {
  id: string;
  label: string;
  status: TabletDevice['status'];
  lastSeenAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

@Injectable()
export class TabletAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Shared helpers ──────────────────────────────────────────────────────

  /** Mirrors ConnectorService#logAuditEventSafely: a durable operation that
   * already committed must not become a client-visible 500 just because the
   * audit write failed. */
  private async logAuditEventSafely(
    event: Parameters<AuditLogService['logAuthEvent']>[0],
  ): Promise<void> {
    try {
      await this.auditLogService.logAuthEvent(event);
    } catch (auditError) {
      console.error(
        '[TabletAuthService] audit log write failed (non-fatal):',
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

  /**
   * A synthetic, non-loginable Staff row used as the required actorId FK on
   * audit events and Order records triggered by a device with no active
   * staff elevation (restricted/customer-context ordering) — mirrors the
   * established resolveKioskSystemActor/resolveConnectorSystemActor
   * pattern exactly, keyed per-device (not per-org) so audit/order records
   * can distinguish which physical device acted, not just "some tablet".
   */
  async resolveDeviceSystemActor(organizationId: string, deviceId: string): Promise<Staff> {
    const email = `tablet-device+${deviceId}@verdura.internal`;
    return this.prisma.staff.upsert({
      where: { email },
      create: {
        organizationId,
        email,
        name: 'Tablet Device (restricted/customer context)',
        passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), {
          type: argon2.argon2id,
        }),
        role: StaffRole.viewer,
        isActive: false,
      },
      update: {},
    });
  }

  private signDeviceToken(device: {
    id: string;
    organizationId: string;
    venueId: string;
    label: string;
  }): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: `tablet-device:${device.id}`,
      email: `tablet-device+${device.id}@verdura.internal`,
      role: StaffRole.viewer,
      organizationId: device.organizationId,
      venueId: device.venueId,
      kind: 'tablet_device',
      deviceId: device.id,
    };
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('TABLET_DEVICE_TOKEN_EXPIRY', '30d'),
    });
  }

  private signStaffToken(staff: Staff, deviceId: string, venueId: string): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      organizationId: staff.organizationId,
      venueId,
      kind: 'tablet_staff',
      deviceId,
    };
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('TABLET_STAFF_ELEVATION_EXPIRY', '20m'),
    });
  }

  private signManagerToken(
    manager: Staff,
    deviceId: string,
    venueId: string,
    actingStaffId?: string,
  ): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: manager.id,
      email: manager.email,
      role: manager.role,
      organizationId: manager.organizationId,
      venueId,
      kind: 'tablet_manager',
      deviceId,
      actingStaffId,
    };
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('TABLET_MANAGER_STEPUP_EXPIRY', '5m'),
    });
  }

  // ── Admin-facing: enrollment code creation, device list, revocation ────

  async createEnrollment(
    organizationId: string,
    venueId: string,
    label: string | undefined,
    createdBy: { id: string; email: string; role: StaffRole },
  ): Promise<{ enrollmentId: string; bootstrapToken: string; expiresAt: Date }> {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, organizationId } });
    if (!venue) {
      throw new NotFoundException('Venue not found in your organization');
    }

    const code = randomBytes(32).toString('base64url');
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);

    const enrollment = await this.prisma.tabletEnrollment.create({
      data: { organizationId, venueId, codeHash, label, createdByStaffId: createdBy.id, expiresAt },
    });

    await this.logAuditEventSafely({
      organizationId,
      venueId,
      actorId: createdBy.id,
      actorEmail: createdBy.email,
      actorRole: createdBy.role,
      action: 'TABLET_ENROLLMENT_CODE_CREATED',
      resource: 'tablet_enrollment',
      resourceId: enrollment.id,
      after: { venueId, label: label ?? null, expiresAt: expiresAt.toISOString() },
    });

    return { enrollmentId: enrollment.id, bootstrapToken: `${enrollment.id}.${code}`, expiresAt };
  }

  async listDevices(organizationId: string, venueId: string): Promise<TabletDeviceView[]> {
    const devices = await this.prisma.tabletDevice.findMany({
      where: { organizationId, venueId },
      orderBy: { createdAt: 'desc' },
    });
    return devices.map((d) => ({
      id: d.id,
      label: d.label,
      status: d.status,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
      revokedAt: d.revokedAt,
    }));
  }

  async revokeDevice(
    deviceId: string,
    organizationId: string,
    venueId: string,
    revokedBy: { id: string; email: string; role: StaffRole },
  ): Promise<void> {
    const result = await this.prisma.tabletDevice.updateMany({
      where: { id: deviceId, organizationId, venueId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date(), revokedByStaffId: revokedBy.id },
    });
    if (result.count !== 1) {
      throw new NotFoundException('Active tablet device not found in your venue');
    }

    await this.logAuditEventSafely({
      organizationId,
      venueId,
      actorId: revokedBy.id,
      actorEmail: revokedBy.email,
      actorRole: revokedBy.role,
      action: 'TABLET_DEVICE_REVOKED',
      resource: 'tablet_device',
      resourceId: deviceId,
    });
  }

  // ── Device-facing: enrollment redemption, unlock, elevation, step-up ───

  /**
   * Exchanges a short-lived, single-use bootstrap token for a durable
   * device identity and immediately returns a usable device token — an
   * enrolled tablet starts in restricted mode with no second round-trip
   * required. Single-use enforcement is a guarded CAS update (see
   * ConnectorService#redeemEnrollment's identical reasoning), not a
   * read-then-write race.
   */
  async enrollDevice(bootstrapToken: string): Promise<{
    deviceId: string;
    deviceToken: string;
    venueId: string;
    label: string;
  }> {
    const [enrollmentId, code] = this.splitToken(bootstrapToken);
    if (!enrollmentId || !code) {
      throw new UnauthorizedException('Invalid enrollment code');
    }

    const enrollment = await this.prisma.tabletEnrollment.findUnique({
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
      throw new UnauthorizedException('Enrollment code is invalid, expired, or already used');
    }

    try {
      const device = await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.tabletEnrollment.updateMany({
          where: { id: enrollment.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (consumed.count !== 1) {
          throw new ConflictException('Enrollment code is invalid, expired, or already used');
        }

        const secret = randomBytes(32).toString('base64url');
        const secretHash = await argon2.hash(secret, { type: argon2.argon2id });

        const created = await tx.tabletDevice.create({
          data: {
            organizationId: enrollment.organizationId,
            venueId: enrollment.venueId,
            enrollmentId: enrollment.id,
            label: enrollment.label || `Tablet ${new Date().toISOString().slice(0, 10)}`,
            secretHash,
            status: 'active',
          },
        });

        return created;
      });

      await this.logDeviceAuditEventSafely(
        { organizationId: device.organizationId, venueId: device.venueId, deviceId: device.id },
        'TABLET_DEVICE_ENROLLED',
        'tablet_device',
      );

      const deviceToken = this.signDeviceToken(device);
      return { deviceId: device.id, deviceToken, venueId: device.venueId, label: device.label };
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A concurrent enrollment for this code is already in progress — retry shortly',
        );
      }
      throw error;
    }
  }

  /**
   * Resolves the device system actor AND writes the audit event inside a
   * single try/catch — resolving the actor is itself a real DB write
   * (upsert), so it must be covered by the same non-fatal-failure
   * guarantee as the audit write itself. Splitting these into "resolve
   * then call logAuditEventSafely" would leave a real gap: a transient
   * failure resolving the actor would throw *before* logAuditEventSafely's
   * own try/catch ever ran, turning (for example) a clean 401 "wrong PIN"
   * response into an unhandled 500.
   */
  private async logDeviceAuditEventSafely(
    device: { organizationId: string; venueId: string; deviceId: string },
    action: string,
    resource: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    try {
      // Story 12.15: the tablet is recorded as the device it is, never as a
      // synthetic Staff row.
      await this.auditLogService.logAuthEvent({
        organizationId: device.organizationId,
        venueId: device.venueId,
        actorType: 'device',
        deviceKind: AUDIT_DEVICE_KINDS.tablet,
        deviceId: device.deviceId,
        action,
        resource,
        resourceId: device.deviceId,
        after: extra,
      });
    } catch (auditError) {
      console.error('[TabletAuthService] audit log write failed (non-fatal):', action, auditError);
    }
  }

  /**
   * Real-time revocation check — called by TabletDeviceGuard on every
   * request bearing any tablet_* token kind (device, staff-elevated, or
   * manager-stepped-up), because a revoked device must invalidate an
   * already-elevated session too, not just future device-only tokens.
   */
  async assertDeviceActive(deviceId: string): Promise<TabletDevice> {
    const device = await this.prisma.tabletDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.status !== 'active') {
      throw new UnauthorizedException('This device has been revoked or is unknown');
    }
    // Best-effort — a lastSeenAt write failing must never itself reject an
    // otherwise-valid request.
    this.prisma.tabletDevice
      .updateMany({ where: { id: deviceId, status: 'active' }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    return device;
  }

  /**
   * Validates the venue unlock PIN for an already-authenticated device.
   * Deliberately does NOT mint a new token — the device token remains the
   * sole bearer of restricted-tier authority; unlock is a local "wake"
   * gate the client enforces in its UI, matching DL-081 ("the venue unlock
   * PIN... is not... the sole security boundary"). Still server-validated
   * and rate-limited (via the controller's RateLimit decorator) so the PIN
   * itself can never be brute-forced offline.
   *
   * Reads KDS_VENUE_PINS directly rather than sharing code with
   * KdsAuthService, by design — see this service's class doc comment on
   * preserving separate domain ownership and not risking KDS regression.
   */
  async unlockDevice(device: TabletDeviceIdentity, pin: string): Promise<void> {
    const configuredPin = this.getConfiguredVenuePin(device.venueId);

    if (!configuredPin) {
      await this.auditUnlockAttempt(device, false);
      throw new UnauthorizedException('Invalid venue PIN');
    }

    assertPinNotInsecureDefault(configuredPin, 'KDS_VENUE_PINS');

    if (!safeCompare(pin, configuredPin)) {
      await this.auditUnlockAttempt(device, false);
      throw new UnauthorizedException('Invalid venue PIN');
    }

    await this.auditUnlockAttempt(device, true);
  }

  private getConfiguredVenuePin(venueId: string): string | undefined {
    const raw = this.config.get<string>('KDS_VENUE_PINS');
    if (!raw) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const value = (parsed as Record<string, unknown>)[venueId];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private async auditUnlockAttempt(device: TabletDeviceIdentity, success: boolean): Promise<void> {
    await this.logDeviceAuditEventSafely(
      device,
      success ? 'TABLET_UNLOCK_SUCCESS' : 'TABLET_UNLOCK_FAILED',
      'tablet_device',
    );
  }

  /**
   * Elevates the current device session to a named staff identity. The
   * candidate set is every active Staff in the device's organization with
   * VenueAccess to the device's venue and a PIN set — small in practice
   * (a handful of staff per venue), so a linear Argon2id verify loop is
   * the same approach real per-venue PIN-based POS systems use; rate
   * limiting (controller-level) is the primary brute-force control on top
   * of it, not lookup speed.
   */
  /**
   * The one active staff member, granted this tablet's venue (Story 2.2:
   * venue access applies to every role) with their PIN enrolled there
   * (Story 8.3), whose PIN this is. Every candidate
   * is checked, so timing does not depend on which one matches. If the PIN
   * matches more than one staff member, nobody is elevated (Story 8.1 keeps
   * PINs unique per venue; this is the fail-closed backstop).
   */
  private async matchStaffPin(
    device: TabletDeviceIdentity,
    pin: string,
    roles?: StaffRole[],
  ): Promise<Staff | null> {
    const candidates = await this.prisma.staff.findMany({
      where: {
        organizationId: device.organizationId,
        isActive: true,
        pinHash: { not: null },
        deletedAt: null,
        // Story 8.3: only a PIN checked unique in this venue elevates here.
        venueAccess: { some: { venueId: device.venueId, pinEnrolledAt: { not: null } } },
        ...(roles ? { role: { in: roles } } : {}),
      },
    });
    const matches: Staff[] = [];
    for (const candidate of candidates) {
      try {
        if (candidate.pinHash && (await argon2.verify(candidate.pinHash, pin))) {
          matches.push(candidate);
        }
      } catch {
        // fall through — treat a malformed stored hash as no-match, never throw
      }
    }
    if (matches.length > 1) {
      await this.logDeviceAuditEventSafely(device, 'TABLET_STAFF_PIN_AMBIGUOUS', 'tablet_device', {
        matches: matches.length,
      });
      return null;
    }
    return matches[0] ?? null;
  }

  async elevateStaff(
    device: TabletDeviceIdentity,
    staffPin: string,
  ): Promise<{ token: string; staff: { id: string; name: string; role: StaffRole } }> {
    const matched = await this.matchStaffPin(device, staffPin);
    if (!matched) {
      // Constant-shape decoy verify so "no candidates at all" and "PIN
      // didn't match any candidate" take comparable time.
      await argon2.verify(DUMMY_HASH, staffPin).catch(() => false);
      await this.logDeviceAuditEventSafely(
        device,
        'TABLET_STAFF_ELEVATION_FAILED',
        'tablet_device',
      );
      throw new UnauthorizedException('Incorrect staff PIN');
    }

    const token = this.signStaffToken(matched, device.deviceId, device.venueId);

    await this.logAuditEventSafely({
      organizationId: device.organizationId,
      venueId: device.venueId,
      actorId: matched.id,
      actorEmail: matched.email,
      actorRole: matched.role,
      action: 'TABLET_STAFF_ELEVATION_SUCCESS',
      resource: 'tablet_device',
      resourceId: device.deviceId,
    });

    return { token, staff: { id: matched.id, name: matched.name, role: matched.role } };
  }

  /**
   * Steps up the current session to manager-authorized for one short
   * window. Requires role manager/admin/owner — ordinary staff elevation
   * never implies this, regardless of who initiated the request.
   */
  async managerStepUp(
    device: TabletDeviceIdentity,
    managerPin: string,
    actingStaffId: string | undefined,
  ): Promise<{ token: string; manager: { id: string; name: string; role: StaffRole } }> {
    const matched = await this.matchStaffPin(device, managerPin, [
      StaffRole.manager,
      StaffRole.admin,
      StaffRole.owner,
    ]);
    if (!matched) {
      await argon2.verify(DUMMY_HASH, managerPin).catch(() => false);
      await this.logDeviceAuditEventSafely(device, 'TABLET_MANAGER_STEPUP_FAILED', 'tablet_device');
      throw new UnauthorizedException('Incorrect manager PIN');
    }

    const token = this.signManagerToken(matched, device.deviceId, device.venueId, actingStaffId);

    await this.logAuditEventSafely({
      organizationId: device.organizationId,
      venueId: device.venueId,
      actorId: matched.id,
      actorEmail: matched.email,
      actorRole: matched.role,
      action: 'TABLET_MANAGER_STEPUP_SUCCESS',
      resource: 'tablet_device',
      resourceId: device.deviceId,
      after: actingStaffId ? { actingStaffId } : undefined,
    });

    return { token, manager: { id: matched.id, name: matched.name, role: matched.role } };
  }

  /**
   * Lock/logout is attributed to the staff member who was actually
   * elevated, when one was — a lock triggered from an elevated session is
   * a real, named staff action, not an anonymous device event. Falls back
   * to the device system actor when no staff was elevated (e.g. locking
   * straight from restricted/customer mode).
   */
  async logLockEvent(device: TabletDeviceIdentity, staffId: string | undefined): Promise<void> {
    if (staffId) {
      const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
      if (staff) {
        await this.logAuditEventSafely({
          organizationId: device.organizationId,
          venueId: device.venueId,
          actorId: staff.id,
          actorEmail: staff.email,
          actorRole: staff.role,
          action: 'TABLET_LOCK',
          resource: 'tablet_device',
          resourceId: device.deviceId,
        });
        return;
      }
    }
    await this.logDeviceAuditEventSafely(device, 'TABLET_LOCK', 'tablet_device');
  }
}

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Staff, StaffRole } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { AuditLogService } from '../audit/audit.service';
import { manageableRoles } from './staff-admin.policy';
import { liveActor, lockStaffRows, lockTabletPinVenues } from './staff-locks';

/** Roles whose tablet PIN the actor may set (besides their own). */
function pinSettableRoles(actorRole: StaffRole): readonly StaffRole[] {
  if (actorRole === StaffRole.manager) {
    return [StaffRole.cashier, StaffRole.kitchen, StaffRole.viewer];
  }
  return manageableRoles(actorRole);
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateStaffDto): Promise<Staff> {
    if (!dto || !dto.email || typeof dto.email !== 'string') {
      throw new Error('Invalid email');
    }
    if (!dto.password || typeof dto.password !== 'string') {
      throw new Error('Invalid password');
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    return this.prisma.staff.create({
      data: {
        organizationId: dto.organizationId,
        email: dto.email.trim().toLowerCase(),
        name: dto.name,
        passwordHash,
        role: dto.role,
      },
    });
  }

  async findByEmail(email: string): Promise<Staff | null> {
    if (!email || typeof email !== 'string') {
      return null;
    }
    const staff = await this.prisma.staff.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
      include: { organization: true },
    });
    if (!staff || !staff.organization?.isActive) {
      return null;
    }
    return staff;
  }

  async findById(id: string): Promise<Staff | null> {
    if (!id || typeof id !== 'string') {
      return null;
    }
    // Validate UUID format to prevent database syntax errors and bypasses
    if (!isUUID(id)) {
      return null;
    }
    const staff = await this.prisma.staff.findFirst({
      where: { id, deletedAt: null },
      include: { organization: true },
    });
    if (!staff || !staff.organization?.isActive) {
      return null;
    }
    return staff;
  }

  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    const isValidHash = typeof hash === 'string' && hash.startsWith('$argon2');
    const hashToVerify = isValidHash
      ? hash
      : '$argon2id$v=19$m=65536,t=3,p=4$ny2DnHXAff2D5lmWycbuTw$LxRCa+qjRHgy6Uj9tsonUQ0Xx+6lH//N/p/0bMoRGmk';
    const plainToVerify = typeof plain === 'string' ? plain : '';
    try {
      const result = await argon2.verify(hashToVerify, plainToVerify);
      return isValidHash && result;
    } catch {
      return false;
    }
  }

  async updatePassword(
    id: string,
    dto: UpdatePasswordDto,
    actor: Staff,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Staff> {
    const staff = await this.findById(id);
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    const isCurrentPasswordValid = await this.verifyPassword(
      staff.passwordHash,
      dto.currentPassword,
    );
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Invalid current password');
    }
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    const updated = await this.prisma.staff.update({
      where: { id },
      data: { passwordHash },
    });

    await this.auditLogService.logAuthEvent({
      organizationId: actor.organizationId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'password_changed',
      resource: 'staff',
      resourceId: updated.id,
      ipAddress,
      userAgent,
    });

    return updated;
  }

  /**
   * Sets or resets a staff member's tablet-elevation PIN (story 15-1,
   * DL-081) — always Argon2id-hashed, never the plaintext password reused
   * as a PIN (rejected explicitly below), never logged or returned.
   * Scoped to the caller's own organization; only a genuine staff session
   * reaches it (StaffSessionOnlyGuard).
   *
   * Story 8.1: the actor may set the PIN only of someone they may
   * administer (or their own): a PIN is a credential, and setting a more
   * senior colleague's PIN would let the actor elevate a tablet as them.
   *
   * Story 8.3: within every venue where a PIN elevates a tablet, it
   * identifies at most one staff member. PINs are salted hashes, so
   * uniqueness can be checked only here, while the plain PIN is known:
   * - the PIN is enrolled (VenueAccess.pinEnrolledAt) in the staff member's
   *   venues that the actor also holds (all of them for their own PIN), and
   *   elevation considers enrolled PINs only (TabletAuthService);
   * - a change locks each of those venues, then checks the PIN against every
   *   PIN enrolled there, inactive staff included (so reactivating someone
   *   cannot collide), and enrols it, in one transaction; two concurrent
   *   changes in a venue are therefore serialized and the second sees the
   *   first;
   * - the earlier enrolments vouched for the old PIN and are cleared;
   * - a venue granted later is not enrolled until the PIN is set again, so
   *   a grant can never create a collision.
   * The actor and the staff member are re-read under row locks, so the
   * decision uses their current roles and grants. A refusal names nobody.
   */
  async setTabletPin(
    staffId: string,
    organizationId: string,
    plainPin: string,
    actor: { id: string; email: string; role: StaffRole; organizationId: string },
  ): Promise<void> {
    // Argon2 is deliberately slow; hash before taking any lock.
    const pinHash = await argon2.hash(plainPin, { type: argon2.argon2id });
    await this.prisma.$transaction(
      async (tx) => {
        await lockStaffRows(tx, [actor.id, staffId]);
        const live = await liveActor(tx, actor);
        const staff = await tx.staff.findFirst({
          where: { id: staffId, organizationId, deletedAt: null },
          include: { venueAccess: { select: { venueId: true } } },
        });
        if (!staff) {
          throw new NotFoundException('Staff member not found in your organization');
        }
        const self = staff.id === live.id;
        if (!self && !pinSettableRoles(live.role).includes(staff.role)) {
          throw new ForbiddenException('You may not set the PIN of a staff member with this role');
        }
        if (await this.verifyPassword(staff.passwordHash, plainPin).catch(() => false)) {
          throw new BadRequestException(
            'The tablet PIN must not be the same as this staff member’s login password',
          );
        }

        const granted = staff.venueAccess.map((a) => a.venueId);
        const venueIds = self
          ? granted
          : (
              await tx.venueAccess.findMany({
                where: { staffId: live.id, venueId: { in: granted } },
                select: { venueId: true },
              })
            ).map((a) => a.venueId);
        if (granted.length > 0 && venueIds.length === 0) {
          throw new ForbiddenException(
            'You may set a PIN only for staff in venues you have been granted',
          );
        }

        await lockTabletPinVenues(tx, venueIds);
        if (venueIds.length > 0) {
          const enrolled = await tx.staff.findMany({
            where: {
              id: { not: staff.id },
              deletedAt: null,
              pinHash: { not: null },
              venueAccess: { some: { venueId: { in: venueIds }, pinEnrolledAt: { not: null } } },
            },
            select: { pinHash: true },
          });
          for (const colleague of enrolled) {
            if (await argon2.verify(colleague.pinHash!, plainPin).catch(() => false)) {
              throw new ConflictException(
                'This PIN is not available at this staff member’s venues',
              );
            }
          }
        }

        const now = new Date();
        await tx.staff.update({ where: { id: staff.id }, data: { pinHash, pinSetAt: now } });
        await tx.venueAccess.updateMany({
          where: { staffId: staff.id },
          data: { pinEnrolledAt: null },
        });
        if (venueIds.length > 0) {
          await tx.venueAccess.updateMany({
            where: { staffId: staff.id, venueId: { in: venueIds } },
            data: { pinEnrolledAt: now },
          });
        }
        await this.auditLogService.logAuthEvent(
          {
            organizationId: actor.organizationId,
            actorId: live.id,
            actorEmail: live.email,
            actorRole: live.role,
            action: 'TABLET_STAFF_PIN_SET',
            resource: 'staff',
            resourceId: staff.id,
            after: { venueIds: [...venueIds].sort() },
          },
          tx,
        );
      },
      // Verifying the PIN against each enrolled colleague takes a few
      // Argon2 verifications; allow for them beyond Prisma's 5 s default.
      { timeout: 30_000 },
    );
  }

  /** Metadata-only listing for the tablet-PIN management UI — never returns pinHash/passwordHash. */
  async listForOrganization(organizationId: string): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      role: Staff['role'];
      isActive: boolean;
      hasTabletPin: boolean;
    }>
  > {
    const staff = await this.prisma.staff.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return staff.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      role: s.role,
      isActive: s.isActive,
      hasTabletPin: !!s.pinHash,
    }));
  }
}

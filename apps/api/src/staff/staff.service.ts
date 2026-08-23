import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Staff } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { AuditLogService } from '../audit/audit.service';

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
   * Scoped to the caller's own organization by the controller, which also
   * enforces who may call this (admin/manager, genuine staff session
   * only — see StaffSessionOnlyGuard).
   */
  async setTabletPin(
    staffId: string,
    organizationId: string,
    plainPin: string,
    actor: Staff,
  ): Promise<void> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, organizationId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found in your organization');
    }

    const matchesPassword = await this.verifyPassword(staff.passwordHash, plainPin).catch(
      () => false,
    );
    if (matchesPassword) {
      throw new BadRequestException(
        'The tablet PIN must not be the same as this staff member’s login password',
      );
    }

    const pinHash = await argon2.hash(plainPin, { type: argon2.argon2id });
    await this.prisma.staff.update({
      where: { id: staffId },
      data: { pinHash, pinSetAt: new Date() },
    });

    await this.auditLogService.logAuthEvent({
      organizationId: actor.organizationId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'TABLET_STAFF_PIN_SET',
      resource: 'staff',
      resourceId: staffId,
    });
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

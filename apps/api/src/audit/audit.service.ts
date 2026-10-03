import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogAuthEventDto } from './dto/log-auth-event.dto';
import { AuditLog, Prisma } from '@prisma/client';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async logAuthEvent(dto: LogAuthEventDto): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        organizationId: dto.organizationId,
        venueId: dto.venueId || null,
        ...actorColumns(dto),
        action: dto.action,
        resource: dto.resource,
        resourceId: dto.resourceId || null,
        before: dto.before !== undefined ? (dto.before as Prisma.InputJsonValue) : Prisma.DbNull,
        after: dto.after !== undefined ? (dto.after as Prisma.InputJsonValue) : Prisma.DbNull,
        ipAddress: dto.ipAddress || null,
        userAgent: dto.userAgent || null,
      },
    });
  }
}

/**
 * Story 12.15: each actor type writes only its own identity columns; the
 * database CHECK constraint rejects any other combination.
 */
function actorColumns(
  dto: LogAuthEventDto,
): Pick<
  Prisma.AuditLogUncheckedCreateInput,
  'actorType' | 'actorId' | 'actorEmail' | 'actorRole' | 'deviceKind' | 'deviceId' | 'systemActor'
> {
  switch (dto.actorType) {
    case 'device':
      return {
        actorType: 'device',
        actorRole: dto.actorRole ?? null,
        deviceKind: dto.deviceKind,
        deviceId: dto.deviceId ?? null,
      };
    case 'system':
      return { actorType: 'system', systemActor: dto.systemActor };
    default:
      return {
        actorType: 'staff',
        actorId: dto.actorId,
        actorEmail: dto.actorEmail,
        actorRole: dto.actorRole,
        deviceKind: dto.deviceKind ?? null,
        deviceId: dto.deviceId ?? null,
      };
  }
}

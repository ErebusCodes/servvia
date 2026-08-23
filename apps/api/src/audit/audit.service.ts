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
        actorId: dto.actorId,
        actorEmail: dto.actorEmail,
        actorRole: dto.actorRole,
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

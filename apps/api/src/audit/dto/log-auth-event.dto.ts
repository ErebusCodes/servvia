import { StaffRole } from '@prisma/client';

export class LogAuthEventDto {
  organizationId: string;
  venueId?: string;
  actorId: string;
  actorEmail: string;
  actorRole: StaffRole;
  action: string;
  resource: string;
  resourceId?: string;
  before?: any;
  after?: any;
  ipAddress?: string;
  userAgent?: string;
}

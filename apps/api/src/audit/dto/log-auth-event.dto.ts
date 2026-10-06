import { StaffRole } from '@prisma/client';

/** Fields every audit event carries, whoever the actor is. */
interface AuditEventBase {
  organizationId: string;
  venueId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  before?: any;
  after?: any;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * A named staff member (Story 12.15). `actorType` may be omitted: every
 * existing call site records a staff actor. A staff member acting through a
 * device (an elevated tablet) also names the device.
 */
export interface StaffAuditActorFields {
  actorType?: 'staff';
  actorId: string;
  actorEmail: string;
  actorRole: StaffRole;
  deviceKind?: string;
  deviceId?: string;
}

/**
 * An authenticated device or service credential. Never a Staff row: a KDS
 * screen signed in with the venue PIN has no device record, so deviceId is
 * absent and deviceKind says what acted.
 */
export interface DeviceAuditActorFields {
  actorType: 'device';
  deviceKind: string;
  deviceId?: string;
  /** The role the device credential grants, when it has one. */
  actorRole?: StaffRole;
}

/** A background process of the platform itself. */
export interface SystemAuditActorFields {
  actorType: 'system';
  systemActor: string;
}

export type LogAuthEventDto = AuditEventBase &
  (StaffAuditActorFields | DeviceAuditActorFields | SystemAuditActorFields);

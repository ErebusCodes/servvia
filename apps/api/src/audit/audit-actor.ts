import { StaffRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  DeviceAuditActorFields,
  StaffAuditActorFields,
  SystemAuditActorFields,
} from './dto/log-auth-event.dto';

/** The actor part of an audit event (Story 12.15). */
export type AuditActor = StaffAuditActorFields | DeviceAuditActorFields | SystemAuditActorFields;

/** Device kinds recorded in AuditLog.deviceKind. */
export const AUDIT_DEVICE_KINDS = {
  kds: 'kds_device',
  tablet: 'tablet_device',
  venueConnector: 'venue_connector',
} as const;

export function staffAuditActor(staff: {
  id: string;
  email: string;
  role: StaffRole;
}): StaffAuditActorFields {
  return { actorType: 'staff', actorId: staff.id, actorEmail: staff.email, actorRole: staff.role };
}

/**
 * The truthful audit actor for an authenticated request:
 * - a KDS venue-PIN token is a device (no device record, so no deviceId);
 * - an unelevated tablet is a device, with its TabletDevice id;
 * - a tablet elevated by a staff or manager PIN is that staff member, acting
 *   through the tablet;
 * - a staff login session is the staff member.
 */
export function auditActorFromUser(user: AuthenticatedUser): AuditActor {
  switch (user.kind) {
    case 'kds_device':
      return { actorType: 'device', deviceKind: AUDIT_DEVICE_KINDS.kds, actorRole: user.role };
    case 'tablet_device':
      return {
        actorType: 'device',
        deviceKind: AUDIT_DEVICE_KINDS.tablet,
        deviceId: user.deviceId,
        actorRole: user.role,
      };
    case 'tablet_staff':
    case 'tablet_manager':
      return {
        ...staffAuditActor(user),
        deviceKind: AUDIT_DEVICE_KINDS.tablet,
        deviceId: user.deviceId,
      };
    default:
      return staffAuditActor(user);
  }
}

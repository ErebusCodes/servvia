import { StaffRole } from '@prisma/client';
import { auditActorFromUser, staffAuditActor } from './audit-actor';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

const base: AuthenticatedUser = {
  id: 'staff-1',
  email: 'owner@example.test',
  role: StaffRole.owner,
  organizationId: 'org-1',
};

describe('auditActorFromUser (Story 12.15)', () => {
  it('records a staff login session as the staff member', () => {
    expect(auditActorFromUser(base)).toEqual(staffAuditActor(base));
  });

  it('records a KDS venue-PIN token as a device with no device record and no staff identity', () => {
    const actor = auditActorFromUser({
      ...base,
      id: 'kds-device:venue-1',
      email: 'kds-device+venue-1@verdura.internal',
      role: StaffRole.kitchen,
      kind: 'kds_device',
      venueId: 'venue-1',
    });
    expect(actor).toEqual({
      actorType: 'device',
      deviceKind: 'kds_device',
      actorRole: StaffRole.kitchen,
    });
  });

  it('records an unelevated tablet as the tablet device', () => {
    expect(
      auditActorFromUser({
        ...base,
        id: 'tablet-device:d-1',
        role: StaffRole.viewer,
        kind: 'tablet_device',
        deviceId: 'd-1',
      }),
    ).toEqual({
      actorType: 'device',
      deviceKind: 'tablet_device',
      deviceId: 'd-1',
      actorRole: StaffRole.viewer,
    });
  });

  it('records an elevated tablet as the staff member acting through the tablet', () => {
    for (const kind of ['tablet_staff', 'tablet_manager'] as const) {
      expect(
        auditActorFromUser({ ...base, role: StaffRole.manager, kind, deviceId: 'd-1' }),
      ).toEqual({
        actorType: 'staff',
        actorId: 'staff-1',
        actorEmail: 'owner@example.test',
        actorRole: StaffRole.manager,
        deviceKind: 'tablet_device',
        deviceId: 'd-1',
      });
    }
  });
});

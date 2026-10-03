import { ForbiddenException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import {
  assertMayAdministerStaff,
  assertMayAssign,
  assertMayManage,
  assertNotSelf,
  manageableRoles,
} from './staff-admin.policy';

describe('staff administration policy (Story 8.1)', () => {
  const all = Object.values(StaffRole);
  const belowAdmin: StaffRole[] = [
    StaffRole.manager,
    StaffRole.cashier,
    StaffRole.kitchen,
    StaffRole.viewer,
  ];

  it('only owners and admins administer staff', () => {
    for (const role of all) {
      const allowed = role === StaffRole.owner || role === StaffRole.admin;
      if (allowed) expect(() => assertMayAdministerStaff(role)).not.toThrow();
      else expect(() => assertMayAdministerStaff(role)).toThrow(ForbiddenException);
    }
  });

  it('an owner manages and assigns every role', () => {
    expect([...manageableRoles(StaffRole.owner)].sort()).toEqual([...all].sort());
    for (const role of all) {
      expect(() => assertMayManage(StaffRole.owner, role)).not.toThrow();
      expect(() => assertMayAssign(StaffRole.owner, role)).not.toThrow();
    }
  });

  it('an admin manages and assigns only roles below admin', () => {
    for (const role of all) {
      const allowed = belowAdmin.includes(role);
      for (const check of [assertMayManage, assertMayAssign]) {
        if (allowed) expect(() => check(StaffRole.admin, role)).not.toThrow();
        else expect(() => check(StaffRole.admin, role)).toThrow(ForbiddenException);
      }
    }
  });

  it('a manager or lower manages nobody', () => {
    for (const actor of belowAdmin) {
      expect(manageableRoles(actor)).toEqual([]);
      for (const role of all) {
        expect(() => assertMayManage(actor, role)).toThrow(ForbiddenException);
      }
    }
  });

  it('refuses acting on oneself', () => {
    expect(() => assertNotSelf('a', 'a', 'deactivate')).toThrow(ForbiddenException);
    expect(() => assertNotSelf('a', 'b', 'deactivate')).not.toThrow();
  });
});

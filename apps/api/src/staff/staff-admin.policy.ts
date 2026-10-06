import { ForbiddenException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';

/**
 * Who may administer staff, and whom (Story 8.1; least privilege, PRD
 * section 16 item 2). Pure rules, enforced server-side by
 * StaffAdministrationService before any change.
 *
 * - Only an owner or an admin administers staff (the controller also
 *   requires a staff login session, never a tablet or device).
 * - An admin administers, and assigns, only roles below admin; an owner
 *   administers and assigns every role.
 * - Nobody changes their own role, deactivates, removes or resets
 *   themselves here (a self-service password change is separate).
 */

export const STAFF_ADMIN_ROLES: readonly StaffRole[] = [StaffRole.owner, StaffRole.admin];

const BELOW_ADMIN: readonly StaffRole[] = [
  StaffRole.manager,
  StaffRole.cashier,
  StaffRole.kitchen,
  StaffRole.viewer,
];

/** Roles the actor may assign to, or hold over, another staff member. */
export function manageableRoles(actorRole: StaffRole): readonly StaffRole[] {
  if (actorRole === StaffRole.owner) return Object.values(StaffRole);
  if (actorRole === StaffRole.admin) return BELOW_ADMIN;
  return [];
}

export function assertMayAdministerStaff(actorRole: StaffRole): void {
  if (!STAFF_ADMIN_ROLES.includes(actorRole)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

export function assertMayManage(actorRole: StaffRole, targetRole: StaffRole): void {
  assertMayAdministerStaff(actorRole);
  if (!manageableRoles(actorRole).includes(targetRole)) {
    throw new ForbiddenException('You may not administer a staff member with this role');
  }
}

export function assertMayAssign(actorRole: StaffRole, role: StaffRole): void {
  assertMayAdministerStaff(actorRole);
  if (!manageableRoles(actorRole).includes(role)) {
    throw new ForbiddenException('You may not assign this role');
  }
}

export function assertNotSelf(actorId: string, targetId: string, action: string): void {
  if (actorId === targetId) {
    throw new ForbiddenException(`You may not ${action} your own account`);
  }
}

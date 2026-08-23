import { StaffRole } from '@prisma/client';

/**
 * Signed access-token payload. `venueId`/`kind` are only present for
 * venue-scoped device tokens (e.g. KDS terminals, Order Tablet devices)
 * minted via a PIN/device-secret exchange endpoint — staff tokens omit
 * them. `deviceId` is present on every `tablet_*` kind (story 15-1,
 * DL-081) so a revocation check can always resolve the underlying
 * `TabletDevice` row even when `sub` identifies a staff/manager instead
 * (`tablet_staff`/`tablet_manager`) — a revoked device must invalidate an
 * already-elevated session too, not just fresh device-only tokens.
 * `actingStaffId` is present on `tablet_manager` only when a staff
 * elevation was already active at the moment of step-up, so a privileged
 * action's audit trail can record both identities together.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: StaffRole;
  organizationId: string;
  venueId?: string;
  kind?: 'staff' | 'kds_device' | 'tablet_device' | 'tablet_staff' | 'tablet_manager';
  deviceId?: string;
  actingStaffId?: string;
  iat?: number;
  exp?: number;
}

/**
 * Shape of `request.user` after JwtStrategy validation — matches the
 * fields every organizationId/RBAC-scoped controller already reads
 * (`req.user.id`, `req.user.organizationId`, ...).
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: StaffRole;
  organizationId: string;
  venueId?: string;
  kind?: 'staff' | 'kds_device' | 'tablet_device' | 'tablet_staff' | 'tablet_manager';
  deviceId?: string;
  actingStaffId?: string;
}

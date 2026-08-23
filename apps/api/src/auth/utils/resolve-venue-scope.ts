import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/** Every non-staff token kind is venue-scoped by design — see below. */
const DEVICE_SCOPED_KINDS = new Set([
  'kds_device',
  'tablet_device',
  'tablet_staff',
  'tablet_manager',
]);

/**
 * A device-issued token (`kds_device`, and — story 15-1/DL-081 —
 * `tablet_device`/`tablet_staff`/`tablet_manager`) is venue-scoped by
 * design (see docs/ux.md "PIN entry... no full staff login"): it must
 * never be able to read or mutate another venue's data just because it
 * shares an organizationId, even once elevated to a named staff or
 * manager identity — elevation proves who is acting, never grants
 * cross-venue reach. Staff tokens (kind `staff` or undefined) are
 * unrestricted here (matching existing org-wide RBAC).
 *
 * Returns the venueId to scope the query to, throwing if the caller
 * explicitly asked for a venue outside its token's scope. Shared by
 * OrdersController and TablesController so both enforce the same rule.
 */
export function resolveVenueScope(
  user: AuthenticatedUser,
  requestedVenueId?: string,
): string | undefined {
  if (!user.kind || !DEVICE_SCOPED_KINDS.has(user.kind)) {
    return requestedVenueId;
  }
  if (requestedVenueId && requestedVenueId !== user.venueId) {
    throw new ForbiddenException('This device is not authorized for the requested venue');
  }
  return user.venueId;
}

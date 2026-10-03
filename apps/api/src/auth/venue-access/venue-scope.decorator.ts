import { SetMetadata, CustomDecorator } from '@nestjs/common';

/**
 * Where a route finds the venue it acts in (Story 2.10). VenueAccessGuard
 * reads this and applies the staff venue access rule (venue-access.ts).
 *
 * - `param` / `query` / `body`: the venue ID is in the request. An absent
 *   optional `query` value means the route lists across venues; the handler
 *   then narrows to the caller's venues (accessibleVenueIds).
 * - `resource`: the venue is the one of a record the route names by ID
 *   (an order, a printer, ...). An unknown record, or one of another
 *   organization, passes to the route's own 404.
 * - `token`: the venue pinned in a tablet token (tablet-native routes); an
 *   elevated tablet also needs its staff member's grant there.
 * - `list`: the route lists across venues and narrows to the caller's
 *   venues in the handler.
 */
export type VenueResource =
  | 'order'
  | 'printer'
  | 'paymentObservation'
  | 'reservation'
  | 'mediaAsset'
  | 'table19ValidationVenue';

export type VenueScopeSource =
  | { param: string }
  | { query: string; optional?: boolean }
  | { body: string }
  | { resource: VenueResource; idParam?: string }
  | { token: true }
  | { list: true };

export const VENUE_SCOPE_KEY = 'venueScope';
export const ORGANIZATION_SCOPE_KEY = 'organizationScope';

export const VenueScope = (source: VenueScopeSource): CustomDecorator<string> =>
  SetMetadata(VENUE_SCOPE_KEY, source);

/**
 * Declares that a staff route acts on organization-level data that belongs
 * to no venue (the menu catalogue, staff accounts, ...). The reason is
 * required so the decision is reviewed, not defaulted.
 */
export const OrganizationScope = (reason: string): CustomDecorator<string> =>
  SetMetadata(ORGANIZATION_SCOPE_KEY, reason);

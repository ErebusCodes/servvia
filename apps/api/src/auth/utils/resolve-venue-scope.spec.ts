import { ForbiddenException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { resolveVenueScope } from './resolve-venue-scope';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

function user(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'u1',
    email: 'a@b.com',
    role: StaffRole.admin,
    organizationId: 'org-1',
    ...overrides,
  };
}

describe('resolveVenueScope', () => {
  it('leaves a plain staff token unrestricted (existing org-wide RBAC unchanged)', () => {
    expect(resolveVenueScope(user({ kind: undefined }), 'venue-2')).toBe('venue-2');
    expect(resolveVenueScope(user({ kind: 'staff' }), undefined)).toBeUndefined();
  });

  it.each(['kds_device', 'tablet_device', 'tablet_staff', 'tablet_manager'] as const)(
    'scopes a %s token to its own venueId, rejecting a mismatched explicit request',
    (kind) => {
      const u = user({ kind, venueId: 'venue-1' });
      expect(resolveVenueScope(u, undefined)).toBe('venue-1');
      expect(resolveVenueScope(u, 'venue-1')).toBe('venue-1');
      expect(() => resolveVenueScope(u, 'venue-2')).toThrow(ForbiddenException);
    },
  );
});

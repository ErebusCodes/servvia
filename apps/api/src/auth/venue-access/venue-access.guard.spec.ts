import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { VenueAccessGuard } from './venue-access.guard';
import { ORGANIZATION_SCOPE_KEY, VENUE_SCOPE_KEY, VenueScopeSource } from './venue-scope.decorator';
import { VENUE_ACCESS_DENIED_MESSAGE } from './venue-access';

const staff: AuthenticatedUser = {
  id: 'staff-1',
  email: 's@example.test',
  role: StaffRole.owner,
  organizationId: 'org-1',
};

function setup(row: { in_organization: boolean; granted: boolean } | Error) {
  const prisma = {
    $queryRaw: jest.fn(() => (row instanceof Error ? Promise.reject(row) : Promise.resolve([row]))),
    order: { findFirst: jest.fn().mockResolvedValue({ venueId: 'venue-from-order' }) },
  };
  const metadata = new Map<string, unknown>();
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata.get(key)),
  } as unknown as Reflector;
  const guard = new VenueAccessGuard(reflector, prisma as unknown as PrismaService);
  const run = (
    scope: VenueScopeSource | undefined,
    user: AuthenticatedUser | undefined,
    req: { params?: object; query?: object; body?: object } = {},
    organizationScope?: string,
  ) => {
    metadata.set(VENUE_SCOPE_KEY, scope);
    metadata.set(ORGANIZATION_SCOPE_KEY, organizationScope);
    const request = { method: 'GET', params: {}, query: {}, ...req, user };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context);
  };
  return { prisma, run };
}

describe('VenueAccessGuard (Story 2.10)', () => {
  it('admits a staff member granted the venue in the path', async () => {
    const { prisma, run } = setup({ in_organization: true, granted: true });
    await expect(run({ param: 'id' }, staff, { params: { id: 'venue-1' } })).resolves.toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('refuses an own-organization venue without a grant with Core’s message, owner included', async () => {
    const { run } = setup({ in_organization: true, granted: false });
    await expect(run({ param: 'id' }, staff, { params: { id: 'venue-1' } })).rejects.toThrow(
      new ForbiddenException(VENUE_ACCESS_DENIED_MESSAGE),
    );
  });

  it('leaves another organization’s venue to the route’s own 404', async () => {
    const { run } = setup({ in_organization: false, granted: false });
    await expect(run({ param: 'id' }, staff, { params: { id: 'venue-x' } })).resolves.toBe(true);
  });

  it('fails closed when the grant cannot be checked', async () => {
    const { run } = setup(new Error('database unavailable'));
    await expect(run({ param: 'id' }, staff, { params: { id: 'venue-1' } })).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('reads the venue from the query, the body, a record or the tablet token', async () => {
    const { prisma, run } = setup({ in_organization: true, granted: false });
    await expect(run({ query: 'venueId' }, staff, { query: { venueId: 'v' } })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(run({ body: 'venueId' }, staff, { body: { venueId: 'v' } })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(run({ resource: 'order' }, staff, { params: { id: 'o-1' } })).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'o-1', venue: { organizationId: 'org-1' } },
      select: { venueId: true },
    });
    const elevated = { ...staff, kind: 'tablet_staff' as const, venueId: 'v', deviceId: 'd' };
    await expect(run({ token: true }, elevated)).rejects.toThrow(ForbiddenException);
  });

  it('lets an optional venue filter be absent (the handler narrows the list)', async () => {
    const { prisma, run } = setup({ in_organization: true, granted: false });
    await expect(run({ query: 'venueId', optional: true }, staff)).resolves.toBe(true);
    await expect(run({ list: true }, staff)).resolves.toBe(true);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('refuses a repeated venue parameter instead of reading it as absent', async () => {
    const { run } = setup({ in_organization: true, granted: true });
    await expect(
      run({ query: 'venueId', optional: true }, staff, { query: { venueId: ['a', 'b'] } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not apply to device identities, which resolveVenueScope pins', async () => {
    const { prisma, run } = setup({ in_organization: true, granted: false });
    for (const kind of ['kds_device', 'tablet_device'] as const) {
      await expect(
        run({ param: 'id' }, { ...staff, kind, venueId: 'v' }, { params: { id: 'v' } }),
      ).resolves.toBe(true);
    }
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('admits a declared organization-level route and refuses an undeclared one', async () => {
    const { run } = setup({ in_organization: true, granted: false });
    await expect(run(undefined, staff, {}, 'the menu catalogue')).resolves.toBe(true);
    await expect(run(undefined, staff)).rejects.toThrow(InternalServerErrorException);
  });
});

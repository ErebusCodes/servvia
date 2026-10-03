import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { StaffRole } from '@prisma/client';
import { TabletAuthService } from './tablet-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';

/** Isolates the one genuinely-untyped `jest.Mock` access this file needs
 * (inspecting the exact arguments a Prisma mock call received) to a single
 * well-justified spot, instead of scattering `as` casts across every call
 * site. */
function firstCallArg(mockFn: jest.Mock): Record<string, unknown> {
  return mockFn.mock.calls[0][0];
}

describe('TabletAuthService', () => {
  let service: TabletAuthService;
  let prisma: {
    venue: { findFirst: jest.Mock };
    tabletEnrollment: { create: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
    tabletDevice: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    staff: { upsert: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let config: Record<string, string>;

  beforeEach(async () => {
    prisma = {
      venue: { findFirst: jest.fn() },
      tabletEnrollment: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      tabletDevice: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      staff: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(prisma))),
    };
    config = {
      JWT_ACCESS_SECRET: 'test-secret-at-least-32-bytes-long-1234',
      KDS_VENUE_PINS: JSON.stringify({ 'venue-1': '1088' }),
      TABLET_DEVICE_TOKEN_EXPIRY: '30d',
      TABLET_STAFF_ELEVATION_EXPIRY: '20m',
      TABLET_MANAGER_STEPUP_EXPIRY: '5m',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TabletAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: new JwtService({}) },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => config[key] ?? fallback,
            getOrThrow: (key: string) => {
              if (!config[key]) throw new Error(`missing ${key}`);
              return config[key];
            },
          },
        },
        {
          provide: AuditLogService,
          useValue: { logAuthEvent: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(TabletAuthService);
  });

  describe('createEnrollment', () => {
    it('rejects a venue outside the caller organization', async () => {
      prisma.venue.findFirst.mockResolvedValue(null);
      await expect(
        service.createEnrollment('org-1', 'venue-1', 'Patio tablet', {
          id: 's1',
          email: 'a@b.com',
          role: StaffRole.admin,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a hashed, single-use enrollment code distinct from the returned plaintext', async () => {
      prisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      prisma.tabletEnrollment.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'enroll-1', ...data }),
      );
      const result = await service.createEnrollment('org-1', 'venue-1', 'Patio tablet', {
        id: 's1',
        email: 'a@b.com',
        role: StaffRole.admin,
      });
      expect(result.bootstrapToken).toMatch(/^enroll-1\./);
      const [, code] = result.bootstrapToken.split('.');
      const createCall = firstCallArg(prisma.tabletEnrollment.create);
      const data = createCall.data as Record<string, unknown>;
      expect(data.codeHash).not.toBe(code);
      expect(await argon2.verify(data.codeHash as string, code)).toBe(true);
    });
  });

  describe('enrollDevice', () => {
    function validEnrollment() {
      return {
        id: 'enroll-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        label: 'Patio tablet',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      };
    }

    it('rejects a malformed bootstrap token', async () => {
      await expect(service.enrollDevice('not-a-valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('enrollment boundary: the venue-unlock PIN "108" is never valid as an enrollment bootstrap token — enrollment and PIN unlock are separate stages with separate credentials', async () => {
      await expect(service.enrollDevice('108')).rejects.toThrow(UnauthorizedException);
      expect(prisma.tabletEnrollment.findUnique).not.toHaveBeenCalled();
      expect(prisma.tabletDevice.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown enrollment id', async () => {
      prisma.tabletEnrollment.findUnique.mockResolvedValue(null);
      await expect(service.enrollDevice('unknown-id.somecode')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired enrollment code', async () => {
      const enrollment = { ...validEnrollment(), expiresAt: new Date(Date.now() - 1000) };
      const codeHash = await argon2.hash('the-real-code', { type: argon2.argon2id });
      prisma.tabletEnrollment.findUnique.mockResolvedValue({ ...enrollment, codeHash });
      await expect(service.enrollDevice(`${enrollment.id}.the-real-code`)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a replayed (already-used) enrollment code', async () => {
      const enrollment = { ...validEnrollment(), usedAt: new Date() };
      const codeHash = await argon2.hash('the-real-code', { type: argon2.argon2id });
      prisma.tabletEnrollment.findUnique.mockResolvedValue({ ...enrollment, codeHash });
      await expect(service.enrollDevice(`${enrollment.id}.the-real-code`)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects the wrong code for a valid enrollment', async () => {
      const enrollment = validEnrollment();
      const codeHash = await argon2.hash('the-real-code', { type: argon2.argon2id });
      prisma.tabletEnrollment.findUnique.mockResolvedValue({ ...enrollment, codeHash });
      await expect(service.enrollDevice(`${enrollment.id}.wrong-code`)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('a concurrent redemption attempt that loses the CAS is rejected, not silently succeeded', async () => {
      const enrollment = validEnrollment();
      const codeHash = await argon2.hash('the-real-code', { type: argon2.argon2id });
      prisma.tabletEnrollment.findUnique.mockResolvedValue({ ...enrollment, codeHash });
      prisma.tabletEnrollment.updateMany.mockResolvedValue({ count: 0 }); // another request already consumed it
      prisma.staff.upsert.mockResolvedValue({
        id: 'sys-actor',
        email: 'x@y.com',
        role: StaffRole.viewer,
      });
      await expect(service.enrollDevice(`${enrollment.id}.the-real-code`)).rejects.toThrow(
        ConflictException,
      );
    });

    it('valid enrollment succeeds, creates a device, and returns a usable device token', async () => {
      const enrollment = validEnrollment();
      const codeHash = await argon2.hash('the-real-code', { type: argon2.argon2id });
      prisma.tabletEnrollment.findUnique.mockResolvedValue({ ...enrollment, codeHash });
      prisma.tabletEnrollment.updateMany.mockResolvedValue({ count: 1 });
      prisma.tabletDevice.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'device-1', ...data }),
      );
      prisma.staff.upsert.mockResolvedValue({
        id: 'sys-actor',
        email: 'x@y.com',
        role: StaffRole.viewer,
      });

      const result = await service.enrollDevice(`${enrollment.id}.the-real-code`);
      expect(result.deviceId).toBe('device-1');
      expect(result.venueId).toBe('venue-1');
      expect(result.label).toBe('Patio tablet');
      expect(typeof result.deviceToken).toBe('string');
      expect(result.deviceToken.split('.')).toHaveLength(3); // real JWT shape

      const data = firstCallArg(prisma.tabletDevice.create).data as Record<string, unknown>;
      expect(data.secretHash).toEqual(expect.any(String));
      expect(data.status).toBe('active');
    });
  });

  describe('assertDeviceActive', () => {
    it('rejects an unknown device', async () => {
      prisma.tabletDevice.findUnique.mockResolvedValue(null);
      prisma.tabletDevice.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.assertDeviceActive('device-x')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a revoked device', async () => {
      prisma.tabletDevice.findUnique.mockResolvedValue({ id: 'device-1', status: 'revoked' });
      prisma.tabletDevice.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.assertDeviceActive('device-1')).rejects.toThrow(UnauthorizedException);
    });

    it('accepts an active device', async () => {
      prisma.tabletDevice.findUnique.mockResolvedValue({ id: 'device-1', status: 'active' });
      prisma.tabletDevice.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.assertDeviceActive('device-1')).resolves.toMatchObject({
        id: 'device-1',
      });
    });
  });

  describe('unlockDevice', () => {
    const device = {
      deviceId: 'device-1',
      organizationId: 'org-1',
      venueId: 'venue-1',
      label: 'x',
    };

    it('accepts the correct venue PIN', async () => {
      prisma.staff.upsert.mockResolvedValue({
        id: 'sys',
        email: 'x@y.com',
        role: StaffRole.viewer,
      });
      await expect(service.unlockDevice(device, '1088')).resolves.toBeUndefined();
    });

    it('rejects the wrong venue PIN', async () => {
      prisma.staff.upsert.mockResolvedValue({
        id: 'sys',
        email: 'x@y.com',
        role: StaffRole.viewer,
      });
      await expect(service.unlockDevice(device, '9999')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when no PIN is configured for the venue at all', async () => {
      config.KDS_VENUE_PINS = JSON.stringify({});
      prisma.staff.upsert.mockResolvedValue({
        id: 'sys',
        email: 'x@y.com',
        role: StaffRole.viewer,
      });
      await expect(service.unlockDevice(device, '1088')).rejects.toThrow(UnauthorizedException);
    });

    it('fails closed in production when the configured PIN is still the insecure checked-in default', async () => {
      const previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      config.KDS_VENUE_PINS = JSON.stringify({ 'venue-1': '108' });
      try {
        await expect(service.unlockDevice(device, '108')).rejects.toThrow();
      } finally {
        process.env.NODE_ENV = previousEnv;
      }
    });

    it('accepts the repository-wide local-dev default PIN "108" — the same key KdsAuthService reads, proving Kitchen Display and the Order Tablet unlock stage agree on one configuration source', async () => {
      config.KDS_VENUE_PINS = JSON.stringify({ 'venue-1': '108' });
      prisma.staff.upsert.mockResolvedValue({
        id: 'sys',
        email: 'x@y.com',
        role: StaffRole.viewer,
      });
      await expect(service.unlockDevice(device, '108')).resolves.toBeUndefined();
    });

    it('venue scoping: a PIN configured for a different venue does not unlock this device, even when the PINs happen to be identical strings', async () => {
      config.KDS_VENUE_PINS = JSON.stringify({ 'venue-2': '1088' });
      prisma.staff.upsert.mockResolvedValue({
        id: 'sys',
        email: 'x@y.com',
        role: StaffRole.viewer,
      });
      await expect(service.unlockDevice(device, '1088')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('elevateStaff', () => {
    const device = {
      deviceId: 'device-1',
      organizationId: 'org-1',
      venueId: 'venue-1',
      label: 'x',
    };

    it('elevates on a correct PIN match among active, org-scoped staff', async () => {
      const pinHash = await argon2.hash('4242', { type: argon2.argon2id });
      prisma.staff.findMany.mockResolvedValue([
        {
          id: 'staff-1',
          name: 'Alex',
          email: 'alex@x.com',
          role: StaffRole.cashier,
          pinHash,
          isActive: true,
          organizationId: 'org-1',
        },
      ]);
      const result = await service.elevateStaff(device, '4242');
      expect(result.staff).toMatchObject({ id: 'staff-1', name: 'Alex', role: StaffRole.cashier });
      expect(typeof result.token).toBe('string');
    });

    it('rejects a PIN that matches no candidate', async () => {
      const pinHash = await argon2.hash('4242', { type: argon2.argon2id });
      prisma.staff.findMany.mockResolvedValue([
        {
          id: 'staff-1',
          name: 'Alex',
          email: 'alex@x.com',
          role: StaffRole.cashier,
          pinHash,
          isActive: true,
          organizationId: 'org-1',
        },
      ]);
      await expect(service.elevateStaff(device, '0000')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when there are no candidates at all (e.g. inactive/other-org staff already excluded by the query)', async () => {
      prisma.staff.findMany.mockResolvedValue([]);
      await expect(service.elevateStaff(device, '4242')).rejects.toThrow(UnauthorizedException);
    });

    it('elevates nobody when a PIN matches two staff members (fail closed, Story 8.1)', async () => {
      const pinHash = await argon2.hash('4242', { type: argon2.argon2id });
      const candidate = (id: string) => ({
        id,
        name: id,
        email: `${id}@x.com`,
        role: StaffRole.cashier,
        pinHash,
        isActive: true,
        organizationId: 'org-1',
      });
      prisma.staff.findMany.mockResolvedValue([candidate('staff-1'), candidate('staff-2')]);
      await expect(service.elevateStaff(device, '4242')).rejects.toThrow(UnauthorizedException);
    });

    it('scopes the candidate query to active, org-matched, PIN-set staff granted the tablet’s venue (Stories 2.2, 8.1)', async () => {
      prisma.staff.findMany.mockResolvedValue([]);
      await service.elevateStaff(device, '4242').catch(() => undefined);
      const whereClause = firstCallArg(prisma.staff.findMany).where as Record<string, unknown>;
      expect(whereClause.organizationId).toBe('org-1');
      expect(whereClause.isActive).toBe(true);
      expect(whereClause.pinHash).toEqual({ not: null });
      expect(whereClause.venueAccess).toEqual({ some: { venueId: 'venue-1' } });
    });
  });

  describe('managerStepUp', () => {
    const device = {
      deviceId: 'device-1',
      organizationId: 'org-1',
      venueId: 'venue-1',
      label: 'x',
    };

    it('succeeds for a manager-role candidate with a matching PIN', async () => {
      const pinHash = await argon2.hash('9911', { type: argon2.argon2id });
      prisma.staff.findMany.mockResolvedValue([
        {
          id: 'mgr-1',
          name: 'Morgan',
          email: 'm@x.com',
          role: StaffRole.manager,
          pinHash,
          isActive: true,
          organizationId: 'org-1',
        },
      ]);
      const result = await service.managerStepUp(device, '9911', 'staff-1');
      expect(result.manager).toMatchObject({ id: 'mgr-1', role: StaffRole.manager });
    });

    it('restricts the candidate query to manager/admin/owner roles only — an ordinary staff PIN can never match', async () => {
      prisma.staff.findMany.mockResolvedValue([]);
      await service.managerStepUp(device, '9911', undefined).catch(() => undefined);
      const whereClause = firstCallArg(prisma.staff.findMany).where as Record<string, unknown>;
      expect(whereClause.role).toEqual({
        in: [StaffRole.manager, StaffRole.admin, StaffRole.owner],
      });
    });

    it('rejects a non-manager PIN', async () => {
      prisma.staff.findMany.mockResolvedValue([]);
      await expect(service.managerStepUp(device, '0000', undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('revokeDevice', () => {
    it('throws NotFoundException when no active device matches (already revoked, wrong venue, or unknown)', async () => {
      prisma.tabletDevice.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.revokeDevice('device-1', 'org-1', 'venue-1', {
          id: 's1',
          email: 'a@b.com',
          role: StaffRole.admin,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('revokes an active device scoped to org+venue', async () => {
      prisma.tabletDevice.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        service.revokeDevice('device-1', 'org-1', 'venue-1', {
          id: 's1',
          email: 'a@b.com',
          role: StaffRole.admin,
        }),
      ).resolves.toBeUndefined();
      const call = firstCallArg(prisma.tabletDevice.updateMany);
      expect(call.where).toMatchObject({
        id: 'device-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        status: 'active',
      });
      expect((call.data as Record<string, unknown>).status).toBe('revoked');
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { StaffRole } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { ConnectorService } from './connector.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';

const mockPrisma: any = {
  venue: { findFirst: jest.fn() },
  staff: { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
  connectorEnrollment: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  connectorInstallation: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAuditLogService: any = { logAuthEvent: jest.fn() };

function fakeP2002(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('ConnectorService', () => {
  let service: ConnectorService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<ConnectorService>(ConnectorService);
  });

  describe('createEnrollment', () => {
    it('rejects when the venue does not belong to the calling organization', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await expect(
        service.createEnrollment('org-1', 'venue-1', 'staff-1', 'admin@x.com', StaffRole.admin),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.connectorEnrollment.create).not.toHaveBeenCalled();
    });

    it('creates an enrollment and returns a bootstrap token containing a plaintext code not equal to the stored hash', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.connectorEnrollment.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'enrollment-1', ...data }),
      );

      const result = await service.createEnrollment(
        'org-1',
        'venue-1',
        'staff-1',
        'admin@x.com',
        StaffRole.admin,
      );

      expect(result.enrollmentId).toBe('enrollment-1');
      expect(result.bootstrapToken.startsWith('enrollment-1.')).toBe(true);
      const [, plaintextCode] = result.bootstrapToken.split('.');
      const storedHash = mockPrisma.connectorEnrollment.create.mock.calls[0][0].data.codeHash;
      expect(storedHash).not.toBe(plaintextCode);
      expect(await argon2.verify(storedHash, plaintextCode)).toBe(true);
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONNECTOR_ENROLLMENT_CREATED',
          resourceId: 'enrollment-1',
        }),
      );
    });
  });

  describe('redeemEnrollment', () => {
    it('rejects a malformed bootstrap token', async () => {
      await expect(service.redeemEnrollment('not-a-valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.connectorEnrollment.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an unknown enrollment id without leaking whether the id exists', async () => {
      mockPrisma.connectorEnrollment.findUnique.mockResolvedValue(null);

      await expect(service.redeemEnrollment('unknown-id.some-code')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired enrollment even with the correct code', async () => {
      const code = 'correct-code';
      const codeHash = await argon2.hash(code, { type: argon2.argon2id });
      mockPrisma.connectorEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        codeHash,
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.redeemEnrollment(`enrollment-1.${code}`)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an already-used enrollment even with the correct code', async () => {
      const code = 'correct-code';
      const codeHash = await argon2.hash(code, { type: argon2.argon2id });
      mockPrisma.connectorEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        codeHash,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
      });

      await expect(service.redeemEnrollment(`enrollment-1.${code}`)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects the wrong code for a valid enrollment', async () => {
      const codeHash = await argon2.hash('right-code', { type: argon2.argon2id });
      mockPrisma.connectorEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        codeHash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
      });

      await expect(service.redeemEnrollment('enrollment-1.wrong-code')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('on success: consumes the enrollment, creates an installation, and returns a credential not equal to the stored secretHash', async () => {
      const code = 'right-code';
      const codeHash = await argon2.hash(code, { type: argon2.argon2id });
      mockPrisma.connectorEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        codeHash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
      });
      mockPrisma.connectorEnrollment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.connectorInstallation.findFirst.mockResolvedValue(null);
      mockPrisma.connectorInstallation.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'installation-1', ...data }),
      );
      mockPrisma.staff.upsert.mockResolvedValue({
        id: 'system-actor',
        email: 'connector-system+org-1@verdura.internal',
      });

      const result = await service.redeemEnrollment(`enrollment-1.${code}`);

      expect(result.installationId).toBe('installation-1');
      expect(result.credential.startsWith('installation-1.')).toBe(true);
      const [, plaintextSecret] = result.credential.split('.');
      const storedHash = mockPrisma.connectorInstallation.create.mock.calls[0][0].data.secretHash;
      expect(storedHash).not.toBe(plaintextSecret);
      expect(await argon2.verify(storedHash, plaintextSecret)).toBe(true);
      expect(mockPrisma.connectorEnrollment.updateMany).toHaveBeenCalledWith({
        where: { id: 'enrollment-1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
        data: { usedAt: expect.any(Date) },
      });
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONNECTOR_ENROLLED', resourceId: 'installation-1' }),
      );
      // Story 12.15: the new installation is the actor; no synthetic Staff row.
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'device',
          deviceKind: 'venue_connector',
          deviceId: 'installation-1',
        }),
      );
      expect(mockPrisma.staff.upsert).not.toHaveBeenCalled();
    });

    it('rejects when the enrollment expires between the outer check and the atomic CAS (TOCTOU close)', async () => {
      const code = 'right-code';
      const codeHash = await argon2.hash(code, { type: argon2.argon2id });
      mockPrisma.connectorEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        codeHash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60), // valid at the outer check
      });
      // Simulates the token crossing its expiry boundary before the CAS
      // runs: the guarded update's own expiresAt condition now excludes it.
      mockPrisma.connectorEnrollment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.redeemEnrollment(`enrollment-1.${code}`)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.connectorInstallation.create).not.toHaveBeenCalled();
    });

    it('replaces a prior active installation and links replacement lineage on rotation', async () => {
      const code = 'right-code';
      const codeHash = await argon2.hash(code, { type: argon2.argon2id });
      mockPrisma.connectorEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-2',
        organizationId: 'org-1',
        venueId: 'venue-1',
        codeHash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
      });
      mockPrisma.connectorEnrollment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.connectorInstallation.findFirst.mockResolvedValue({
        id: 'installation-old',
        status: 'active',
      });
      mockPrisma.connectorInstallation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.connectorInstallation.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'installation-new', ...data }),
      );
      mockPrisma.staff.upsert.mockResolvedValue({ id: 'system-actor', email: 'x@x.com' });

      await service.redeemEnrollment(`enrollment-2.${code}`);

      expect(mockPrisma.connectorInstallation.updateMany).toHaveBeenCalledWith({
        where: { id: 'installation-old', status: 'active' },
        data: { status: 'replaced' },
      });
      expect(mockPrisma.connectorInstallation.update).toHaveBeenCalledWith({
        where: { id: 'installation-old' },
        data: { replacedByInstallationId: 'installation-new' },
      });
    });

    it('translates a concurrent-activation P2002 into a clean 409 conflict', async () => {
      const code = 'right-code';
      const codeHash = await argon2.hash(code, { type: argon2.argon2id });
      mockPrisma.connectorEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        codeHash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
      });
      mockPrisma.$transaction.mockImplementation(() => Promise.reject(fakeP2002()));

      await expect(service.redeemEnrollment(`enrollment-1.${code}`)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('authenticate', () => {
    it('returns null for a malformed credential', async () => {
      expect(await service.authenticate('not-a-valid-credential')).toBeNull();
      expect(mockPrisma.connectorInstallation.findUnique).not.toHaveBeenCalled();
    });

    it('returns null for an unknown installation id', async () => {
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue(null);
      expect(await service.authenticate('unknown-id.some-secret')).toBeNull();
    });

    it('returns null for a revoked installation even with the correct secret', async () => {
      const secret = 'right-secret';
      const secretHash = await argon2.hash(secret, { type: argon2.argon2id });
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({
        id: 'installation-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        secretHash,
        status: 'revoked',
      });

      expect(await service.authenticate(`installation-1.${secret}`)).toBeNull();
      expect(mockPrisma.connectorInstallation.updateMany).not.toHaveBeenCalled();
    });

    it('returns null for the wrong secret against an active installation', async () => {
      const secretHash = await argon2.hash('right-secret', { type: argon2.argon2id });
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({
        id: 'installation-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        secretHash,
        status: 'active',
      });

      expect(await service.authenticate('installation-1.wrong-secret')).toBeNull();
    });

    it('resolves identity and updates lastSeenAt for a valid active credential', async () => {
      const secret = 'right-secret';
      const secretHash = await argon2.hash(secret, { type: argon2.argon2id });
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({
        id: 'installation-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        secretHash,
        status: 'active',
      });
      mockPrisma.connectorInstallation.updateMany.mockResolvedValue({ count: 1 });

      const identity = await service.authenticate(`installation-1.${secret}`);

      expect(identity).toEqual({
        installationId: 'installation-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
      });
      expect(mockPrisma.connectorInstallation.updateMany).toHaveBeenCalledWith({
        where: { id: 'installation-1', status: 'active' },
        data: { lastSeenAt: expect.any(Date) },
      });
    });

    it('returns null if the installation is revoked between the read and the liveness-update CAS (real-time revocation is not best-effort)', async () => {
      const secret = 'right-secret';
      const secretHash = await argon2.hash(secret, { type: argon2.argon2id });
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({
        id: 'installation-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        secretHash,
        status: 'active',
      });
      // Simulates a revoke() landing between the read above and this CAS.
      mockPrisma.connectorInstallation.updateMany.mockResolvedValue({ count: 0 });

      expect(await service.authenticate(`installation-1.${secret}`)).toBeNull();
    });
  });

  describe('revoke', () => {
    it('rejects revocation for another organization (no row updated)', async () => {
      mockPrisma.connectorInstallation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revoke('installation-1', 'org-2', 'venue-1', 'staff-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockAuditLogService.logAuthEvent).not.toHaveBeenCalled();
    });

    it('revokes and audits on success', async () => {
      mockPrisma.connectorInstallation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.staff.findUniqueOrThrow.mockResolvedValue({
        id: 'staff-1',
        email: 'admin@x.com',
        role: StaffRole.admin,
      });

      await service.revoke('installation-1', 'org-1', 'venue-1', 'staff-1');

      expect(mockPrisma.connectorInstallation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'installation-1',
          organizationId: 'org-1',
          venueId: 'venue-1',
          status: 'active',
        },
        data: { status: 'revoked', revokedAt: expect.any(Date), revokedByStaffId: 'staff-1' },
      });
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONNECTOR_REVOKED', resourceId: 'installation-1' }),
      );
    });
  });

  describe('reportHealth', () => {
    it('rejects when the installation is no longer active', async () => {
      mockPrisma.connectorInstallation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reportHealth(
          { installationId: 'installation-1', organizationId: 'org-1', venueId: 'venue-1' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('updates version and capabilities on success', async () => {
      mockPrisma.connectorInstallation.updateMany.mockResolvedValue({ count: 1 });

      await service.reportHealth(
        { installationId: 'installation-1', organizationId: 'org-1', venueId: 'venue-1' },
        { version: '1.0.0', capabilities: { printers: 2 } },
      );

      expect(mockPrisma.connectorInstallation.updateMany).toHaveBeenCalledWith({
        where: { id: 'installation-1', status: 'active' },
        data: {
          lastSeenAt: expect.any(Date),
          reportedVersion: '1.0.0',
          reportedCapabilities: { printers: 2 },
        },
      });
    });
  });

  describe('getStatus', () => {
    it('never returns secretHash or any derivative', async () => {
      mockPrisma.connectorInstallation.findMany.mockResolvedValue([
        {
          id: 'installation-1',
          status: 'active',
          reportedVersion: '1.0.0',
          reportedCapabilities: null,
          lastSeenAt: new Date(),
          createdAt: new Date(),
          revokedAt: null,
          replacedByInstallationId: null,
        },
      ]);

      const result = await service.getStatus('org-1', 'venue-1');

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('secretHash');
      expect(mockPrisma.connectorInstallation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', venueId: 'venue-1' },
          select: expect.not.objectContaining({ secretHash: true }),
        }),
      );
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import {
  ConnectorCommandService,
  SELF_TEST_COMMAND_TYPE,
  SELF_TEST_REQUIRED_CAPABILITY,
} from './connector-command.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { ConnectorIdentity } from './connector.service';

const mockPrisma: any = {
  venue: { findFirst: jest.fn() },
  staff: { upsert: jest.fn() },
  connectorInstallation: { findUnique: jest.fn() },
  connectorCommand: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
};

const mockAuditLogService: any = { logAuthEvent: jest.fn() };

function fakeP2002(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const identity: ConnectorIdentity = {
  installationId: 'installation-1',
  organizationId: 'org-1',
  venueId: 'venue-1',
};

describe('ConnectorCommandService', () => {
  let service: ConnectorCommandService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.staff.upsert.mockResolvedValue({
      id: 'system-actor',
      email: 'connector-command-system+org-1@verdura.internal',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorCommandService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<ConnectorCommandService>(ConnectorCommandService);
  });

  describe('createTracerCommand', () => {
    it('rejects when the venue does not belong to the calling organization', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await expect(
        service.createTracerCommand('org-1', 'venue-1', 'staff-1', 'a@x.com', StaffRole.admin),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.connectorCommand.create).not.toHaveBeenCalled();
    });

    it('creates a self-test command with the correct type/capability and audits it', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.connectorCommand.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'cmd-1', status: 'pending', ...data }),
      );

      const result = await service.createTracerCommand(
        'org-1',
        'venue-1',
        'staff-1',
        'a@x.com',
        StaffRole.admin,
        'key-1',
      );

      expect(result.commandType).toBe(SELF_TEST_COMMAND_TYPE);
      expect(mockPrisma.connectorCommand.create.mock.calls[0][0].data.requiredCapability).toBe(
        SELF_TEST_REQUIRED_CAPABILITY,
      );
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONNECTOR_COMMAND_CREATED', resourceId: 'cmd-1' }),
      );
    });

    it('returns the existing command on an idempotency-key conflict rather than erroring', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.connectorCommand.create.mockRejectedValue(fakeP2002());
      mockPrisma.connectorCommand.findUnique.mockResolvedValue({
        id: 'cmd-existing',
        commandType: SELF_TEST_COMMAND_TYPE,
        status: 'pending',
        claimedByInstallationId: null,
        createdAt: new Date(),
        acceptedAt: null,
        reportedAt: null,
        resultType: null,
        failureReason: null,
      });

      const result = await service.createTracerCommand(
        'org-1',
        'venue-1',
        'staff-1',
        'a@x.com',
        StaffRole.admin,
        'dup-key',
      );

      expect(result.id).toBe('cmd-existing');
    });
  });

  describe('poll', () => {
    it('returns nothing when the installation is already at the outstanding-command cap', async () => {
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({
        reportedCapabilities: [SELF_TEST_REQUIRED_CAPABILITY],
      });
      mockPrisma.connectorCommand.count.mockResolvedValue(20);

      const result = await service.poll(identity);

      expect(result).toEqual([]);
      expect(mockPrisma.connectorCommand.findMany).not.toHaveBeenCalled();
    });

    it('does not claim a command whose requiredCapability the installation has not reported', async () => {
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({ reportedCapabilities: [] });
      mockPrisma.connectorCommand.count.mockResolvedValue(0);
      mockPrisma.connectorCommand.findMany.mockResolvedValue([
        {
          id: 'cmd-1',
          status: 'pending',
          requiredCapability: SELF_TEST_REQUIRED_CAPABILITY,
          claimAttemptCount: 0,
          maxClaimAttempts: 5,
        },
      ]);

      const result = await service.poll(identity);

      expect(result).toEqual([]);
      expect(mockPrisma.connectorCommand.updateMany).not.toHaveBeenCalled();
    });

    it('claims an eligible pending command and returns its envelope', async () => {
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({
        reportedCapabilities: [SELF_TEST_REQUIRED_CAPABILITY],
      });
      mockPrisma.connectorCommand.count.mockResolvedValue(0);
      mockPrisma.connectorCommand.findMany.mockResolvedValue([
        {
          id: 'cmd-1',
          status: 'pending',
          commandType: SELF_TEST_COMMAND_TYPE,
          schemaVersion: 1,
          payload: { echoNonce: 'abc' },
          requiredCapability: SELF_TEST_REQUIRED_CAPABILITY,
          correlationId: null,
          causationId: null,
          claimAttemptCount: 0,
          maxClaimAttempts: 5,
        },
      ]);
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.poll(identity);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cmd-1');
      expect(mockPrisma.connectorCommand.updateMany).toHaveBeenCalledTimes(1);
    });

    it('skips a candidate it loses the claim race for, without throwing', async () => {
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({
        reportedCapabilities: [SELF_TEST_REQUIRED_CAPABILITY],
      });
      mockPrisma.connectorCommand.count.mockResolvedValue(0);
      mockPrisma.connectorCommand.findMany.mockResolvedValue([
        {
          id: 'cmd-1',
          status: 'pending',
          requiredCapability: SELF_TEST_REQUIRED_CAPABILITY,
          claimAttemptCount: 0,
          maxClaimAttempts: 5,
        },
      ]);
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.poll(identity);

      expect(result).toEqual([]);
    });

    it('expires a stale-leased command whose claim-attempt budget is exhausted instead of re-claiming it', async () => {
      mockPrisma.connectorInstallation.findUnique.mockResolvedValue({
        reportedCapabilities: [SELF_TEST_REQUIRED_CAPABILITY],
      });
      mockPrisma.connectorCommand.count.mockResolvedValue(0);
      mockPrisma.connectorCommand.findMany.mockResolvedValue([
        {
          id: 'cmd-1',
          status: 'claimed',
          requiredCapability: SELF_TEST_REQUIRED_CAPABILITY,
          claimAttemptCount: 5,
          maxClaimAttempts: 5,
        },
      ]);
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.poll(identity);

      expect(result).toEqual([]);
      expect(mockPrisma.connectorCommand.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'expired' } }),
      );
    });
  });

  describe('accept', () => {
    it('accepts a claimed command and audits CONNECTOR_COMMAND_ACCEPTED', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 1 });

      await service.accept('cmd-1', identity);

      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONNECTOR_COMMAND_ACCEPTED', resourceId: 'cmd-1' }),
      );
      // Story 12.15: the connector installation is the actor, not a Staff row.
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'device',
          deviceKind: 'venue_connector',
          deviceId: identity.installationId,
        }),
      );
      expect(mockPrisma.staff.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: repeating accept on an already-accepted command by the same installation succeeds silently', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.connectorCommand.findFirst.mockResolvedValue({
        id: 'cmd-1',
        status: 'accepted',
        claimedByInstallationId: identity.installationId,
      });

      await expect(service.accept('cmd-1', identity)).resolves.toBeUndefined();
    });

    it('rejects accepting a command claimed by a different installation', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.connectorCommand.findFirst.mockResolvedValue({
        id: 'cmd-1',
        status: 'claimed',
        claimedByInstallationId: 'some-other-installation',
      });

      await expect(service.accept('cmd-1', identity)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for a command outside the caller tenant', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.connectorCommand.findFirst.mockResolvedValue(null);

      await expect(service.accept('cmd-1', identity)).rejects.toThrow(NotFoundException);
    });
  });

  describe('report', () => {
    const dto = {
      outcome: 'succeeded' as const,
      resultType: 'SIMULATED_ECHO',
      idempotencyKey: 'r-1',
    };

    it('records a truthful terminal report and audits it', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 1 });

      await service.report('cmd-1', identity, dto);

      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONNECTOR_COMMAND_SUCCEEDED', resourceId: 'cmd-1' }),
      );
    });

    it('is idempotent: an identical repeat report is a silent no-op', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.connectorCommand.findFirst.mockResolvedValue({
        id: 'cmd-1',
        status: 'succeeded',
        claimedByInstallationId: identity.installationId,
        reportIdempotencyKey: 'r-1',
        resultType: 'SIMULATED_ECHO',
      });

      await expect(service.report('cmd-1', identity, dto)).resolves.toBeUndefined();
      expect(mockAuditLogService.logAuthEvent).not.toHaveBeenCalled();
    });

    it('rejects and audits a conflicting terminal report for an already-terminal command', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.connectorCommand.findFirst.mockResolvedValue({
        id: 'cmd-1',
        status: 'succeeded',
        claimedByInstallationId: identity.installationId,
        reportIdempotencyKey: 'a-different-key',
        resultType: 'SOMETHING_ELSE',
      });

      await expect(service.report('cmd-1', identity, dto)).rejects.toThrow(ConflictException);
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONNECTOR_COMMAND_CONFLICTING_REPORT' }),
      );
    });

    it('rejects a report for a command never accepted by this installation', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.connectorCommand.findFirst.mockResolvedValue({
        id: 'cmd-1',
        status: 'claimed',
        claimedByInstallationId: identity.installationId,
      });

      await expect(service.report('cmd-1', identity, dto)).rejects.toThrow(ConflictException);
    });

    it('DL-093: a late report against an already-unknown command is rejected but durably audited, never mutating the command', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.connectorCommand.findFirst.mockResolvedValue({
        id: 'cmd-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        status: 'unknown',
        claimedByInstallationId: identity.installationId,
        reportIdempotencyKey: null,
        resultType: null,
      });

      await expect(service.report('cmd-1', identity, dto)).rejects.toThrow(ConflictException);

      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          venueId: 'venue-1',
          action: 'CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN',
          resourceId: 'cmd-1',
          after: expect.objectContaining({
            attemptedOutcome: 'succeeded',
            attemptedResultType: 'SIMULATED_ECHO',
            reportingInstallationId: identity.installationId,
          }),
        }),
      );
      // The only write attempted for this call is the initial CAS
      // (WHERE status: accepted), which matched zero rows — no other
      // mutation is ever issued for the unknown-command branch.
      expect(mockPrisma.connectorCommand.updateMany).toHaveBeenCalledTimes(1);
    });

    it('DL-093: a late FAILED report against an already-unknown command is also rejected and audited', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.connectorCommand.findFirst.mockResolvedValue({
        id: 'cmd-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
        status: 'unknown',
        claimedByInstallationId: identity.installationId,
        reportIdempotencyKey: null,
        resultType: null,
      });

      await expect(
        service.report('cmd-1', identity, {
          outcome: 'failed',
          resultType: 'bridge_unreachable_or_failed',
          idempotencyKey: 'r-2',
          failureReason: 'connection refused',
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN',
          after: expect.objectContaining({
            attemptedOutcome: 'failed',
            attemptedFailureReason: 'connection refused',
          }),
        }),
      );
    });
  });

  describe('cancel', () => {
    it('cancels a pending/claimed command and audits it', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 1 });

      await service.cancel('cmd-1', 'org-1', 'venue-1', 'staff-1', 'a@x.com', StaffRole.admin);

      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONNECTOR_COMMAND_CANCELLED' }),
      );
    });

    it('throws NotFoundException when the command is already accepted or terminal', async () => {
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.cancel('cmd-1', 'org-1', 'venue-1', 'staff-1', 'a@x.com', StaffRole.admin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sweep', () => {
    it('marks a never-claimed, expired-overall command as expired', async () => {
      mockPrisma.connectorCommand.findMany.mockResolvedValue([]);
      mockPrisma.connectorCommand.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.sweep();

      expect(result.expiredNeverClaimed).toBe(3);
    });

    it('marks an overdue accepted command as unknown and audits it', async () => {
      // pending-expiry branch: no candidates
      mockPrisma.connectorCommand.findMany
        .mockResolvedValueOnce([]) // idsForSweep for pending/expiresAt inside expiredNeverClaimed's own where.in call
        .mockResolvedValueOnce([]) // stale-lease ids
        .mockResolvedValueOnce([{ id: 'cmd-unknown-1' }]); // accepted/overdue ids
      mockPrisma.connectorCommand.updateMany
        .mockResolvedValueOnce({ count: 0 }) // expiredNeverClaimed's actual updateMany
        .mockResolvedValueOnce({ count: 1 }); // the unknown-marking updateMany
      mockPrisma.connectorCommand.findUnique.mockResolvedValue({
        id: 'cmd-unknown-1',
        organizationId: 'org-1',
        venueId: 'venue-1',
      });

      const result = await service.sweep();

      expect(result.markedUnknown).toBe(1);
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONNECTOR_COMMAND_MARKED_UNKNOWN',
          resourceId: 'cmd-unknown-1',
          actorType: 'system',
          systemActor: 'connector-command-sweep',
        }),
      );
      expect(mockPrisma.staff.upsert).not.toHaveBeenCalled();
    });
  });
});

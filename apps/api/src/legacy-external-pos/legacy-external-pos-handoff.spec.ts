import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POSAdapterType, POSSyncStatus, ServiceMode } from '@prisma/client';
import { LegacyExternalPosHandoff, LegacyExternalPosPlan } from './legacy-external-pos-handoff';
import { PosStrategyResolver } from '../pos-sync/pos-strategy-resolver';
import { PosSubmissionStrategy } from '../pos-sync/pos-submission-strategy';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConnectorCommandService } from '../connector/connector-command.service';

function build(env: Record<string, string> = {}) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const resolver = new PosStrategyResolver(config);
  const prisma = {
    pOSSyncRecord: { updateMany: jest.fn(), update: jest.fn() },
  } as unknown as PrismaService;
  const connector = { cancel: jest.fn() } as unknown as ConnectorCommandService;
  return { handoff: new LegacyExternalPosHandoff(prisma, connector, resolver), resolver };
}

describe('LegacyExternalPosHandoff (temporary)', () => {
  describe('planForNewOrder', () => {
    it('a venue with no external POS is the Servvia-native path and never consults IdealPOS config', () => {
      const { handoff, resolver } = build({ IDEALPOS_POS_STRATEGY: 'native_table_round' });
      const decide = jest.spyOn(resolver, 'decide');

      expect(
        handoff.planForNewOrder({ posAdapterType: POSAdapterType.none }, ServiceMode.dine_in),
      ).toEqual({
        kind: 'none',
      });
      expect(decide).not.toHaveBeenCalled();
    });

    it('an external-POS venue with nothing configured keeps the production default (webit)', () => {
      const { handoff } = build();

      expect(
        handoff.planForNewOrder({ posAdapterType: POSAdapterType.api }, ServiceMode.dine_in),
      ).toEqual({
        kind: 'external',
        adapterType: POSAdapterType.api,
        strategy: PosSubmissionStrategy.webit,
      });
    });

    it('an external-POS venue asking for native while the writer cannot send is refused, not re-routed', () => {
      const { handoff } = build({ IDEALPOS_POS_STRATEGY: 'native_table_round' });

      expect(() =>
        handoff.planForNewOrder({ posAdapterType: POSAdapterType.api }, ServiceMode.dine_in),
      ).toThrow(ServiceUnavailableException);
    });
  });

  describe('initialOrderPosSyncStatus', () => {
    it('maps none to not_applicable and external to not_synced', () => {
      const { handoff } = build();
      expect(handoff.initialOrderPosSyncStatus({ kind: 'none' })).toBe(
        POSSyncStatus.not_applicable,
      );
      expect(
        handoff.initialOrderPosSyncStatus({
          kind: 'external',
          adapterType: POSAdapterType.api,
          strategy: PosSubmissionStrategy.webit,
        }),
      ).toBe(POSSyncStatus.not_synced);
    });
  });

  describe('recordHandoffInTransaction', () => {
    const ids = { orderId: 'ORD-600001', venueId: 'venue-1' };

    function tx() {
      return { pOSSyncRecord: { create: jest.fn() } };
    }

    it('writes nothing for the Servvia-native path', async () => {
      const { handoff } = build();
      const t = tx();

      await handoff.recordHandoffInTransaction(t as never, { kind: 'none' }, ids);

      expect(t.pOSSyncRecord.create).not.toHaveBeenCalled();
    });

    it('writes a not_synced webit row that the dispatcher sweeps can claim', async () => {
      const { handoff } = build();
      const t = tx();
      const plan: LegacyExternalPosPlan = {
        kind: 'external',
        adapterType: POSAdapterType.api,
        strategy: PosSubmissionStrategy.webit,
      };

      await handoff.recordHandoffInTransaction(t as never, plan, ids);

      expect(t.pOSSyncRecord.create).toHaveBeenCalledWith({
        data: {
          orderId: 'ORD-600001',
          venueId: 'venue-1',
          adapterType: POSAdapterType.api,
          strategy: PosSubmissionStrategy.webit,
          status: POSSyncStatus.not_synced,
          attemptCount: 0,
          errorMessage: null,
        },
      });
    });

    it('writes an owned_by_native row that neither dispatcher sweep can claim', async () => {
      const { handoff } = build();
      const t = tx();

      await handoff.recordHandoffInTransaction(
        t as never,
        {
          kind: 'external',
          adapterType: POSAdapterType.api,
          strategy: PosSubmissionStrategy.native_table_round,
        },
        ids,
      );

      expect(t.pOSSyncRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          strategy: PosSubmissionStrategy.native_table_round,
          status: POSSyncStatus.owned_by_native,
        }),
      });
    });
  });

  describe('externalPosPrintsKitchenTicket', () => {
    it('is true only for Bridge venues; Servvia prints for every other venue', () => {
      const { handoff } = build();
      for (const adapter of Object.values(POSAdapterType)) {
        expect(handoff.externalPosPrintsKitchenTicket({ posAdapterType: adapter })).toBe(
          adapter === POSAdapterType.api,
        );
      }
    });
  });

  describe('stopHandoffForCancelledOrder', () => {
    it('reports stopped when no handoff row was ever created', async () => {
      const { handoff } = build();

      await expect(
        handoff.stopHandoffForCancelledOrder(
          { id: 'ORD-600001', venueId: 'venue-1', posSyncRecord: null } as never,
          'org-1',
          { id: 'staff-1', email: 'a@b.c', role: 'manager' },
        ),
      ).resolves.toBe(true);
    });
  });
});

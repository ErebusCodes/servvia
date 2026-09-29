/**
 * TEMPORARY. LEGACY. SCHEDULED FOR DELETION.
 *
 * Everything canonical order creation used to know about delivering an order
 * to an external POS (IdealPOS) lives here and nowhere else in `orders/`.
 * It exists only so the Servvia-native order path can stand on its own while
 * the IdealPOS integration is still installed. It is not a domain concept and
 * must not grow into a generic "POS adapter": Servvia is the operational POS
 * (docs/adr/0001-servvia-is-the-operational-pos.md), and the target order
 * model has no external-POS handoff at all.
 *
 * Removal condition and order: see ./README.md.
 *
 * The code below was MOVED from OrdersService, not rewritten. Its semantics -
 * route exclusivity decided once before any row exists, the POSSyncRecord
 * outbox row written inside the order's own transaction, KOT suppression for
 * Bridge venues, and best-effort dispatch stop on cancellation - are exactly
 * what they were. The only change is who owns them.
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  Order,
  POSAdapterType,
  POSSyncStatus,
  Prisma,
  ServiceMode,
  StaffRole,
  Venue,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { PosStrategyResolver } from '../pos-sync/pos-strategy-resolver';
import { PosSubmissionStrategy } from '../pos-sync/pos-submission-strategy';

/**
 * What order creation must do for the legacy external POS, decided once
 * before any row exists. `none` is the Servvia-native path: no handoff row,
 * no strategy, and no dependency on IdealPOS configuration.
 */
export type LegacyExternalPosPlan =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'external';
      readonly adapterType: POSAdapterType;
      readonly strategy: PosSubmissionStrategy;
    };

/**
 * The legacy relation every order-serving response still carries. The Order
 * Tablet reads `posSyncRecord.strategy` and the pos-sync panel reads the rest,
 * so dropping it would change the public response shape. Kept in one place so
 * its removal is a one-line change when the last consumer is gone.
 */
export const LEGACY_EXTERNAL_POS_ORDER_INCLUDE = { posSyncRecord: true } as const;

type LegacyHandoffRecord = {
  id: string;
  status: POSSyncStatus;
  connectorSubmitCommandId: string | null;
} | null;

@Injectable()
export class LegacyExternalPosHandoff {
  private readonly logger = new Logger(LegacyExternalPosHandoff.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorCommandService: ConnectorCommandService,
    // Which IdealPOS pipeline owns an order. See pos-submission-strategy.ts
    // for why the decision must happen before the creating transaction and
    // nowhere later.
    private readonly posStrategy: PosStrategyResolver,
  ) {}

  /**
   * Decide, BEFORE any row exists, whether and how this order is handed to
   * the external POS. Throws ServiceUnavailableException when the operator
   * configured the native IdealPOS route but its writer cannot send: that
   * order is rejected outright rather than silently routed through Webit.
   *
   * A venue with no external POS never consults IdealPOS configuration, so a
   * misconfigured IdealPOS setting can no longer refuse a Servvia-native order.
   */
  planForNewOrder(
    venue: Pick<Venue, 'posAdapterType'>,
    serviceMode: ServiceMode,
  ): LegacyExternalPosPlan {
    if (venue.posAdapterType === POSAdapterType.none) {
      return { kind: 'none' };
    }

    const decision = this.posStrategy.decide(serviceMode);
    if (decision.decision === 'refuse') {
      throw new ServiceUnavailableException(
        `This order was not created and nothing was sent to the POS. ${decision.reason}`,
      );
    }
    return { kind: 'external', adapterType: venue.posAdapterType, strategy: decision.strategy };
  }

  /** Initial value of the legacy `Order.posSyncStatus` column. */
  initialOrderPosSyncStatus(plan: LegacyExternalPosPlan): POSSyncStatus {
    return plan.kind === 'none' ? POSSyncStatus.not_applicable : POSSyncStatus.not_synced;
  }

  /**
   * Write the POSSyncRecord outbox row inside the order's own transaction.
   *
   * No enqueue happens here, and none should be added: the IdealPOS and
   * legacy dispatchers each sweep `not_synced` rows on their own schedule.
   *
   * ROUTE EXCLUSIVITY (see pos-sync/pos-submission-strategy.ts). The strategy
   * committed here is the only one this order will ever have, and it commits
   * atomically with the order, so an order that exists always has an owner.
   * `owned_by_native` is not `not_synced`, so a native order is outside both
   * dispatcher sweeps' candidate sets even for a query that ignores strategy.
   */
  async recordHandoffInTransaction(
    tx: Prisma.TransactionClient,
    plan: LegacyExternalPosPlan,
    ids: { orderId: string; venueId: string },
  ): Promise<void> {
    if (plan.kind === 'none') return;

    const nativeOwned = plan.strategy === PosSubmissionStrategy.native_table_round;
    await tx.pOSSyncRecord.create({
      data: {
        orderId: ids.orderId,
        venueId: ids.venueId,
        adapterType: plan.adapterType,
        strategy: plan.strategy,
        status: nativeOwned ? POSSyncStatus.owned_by_native : POSSyncStatus.not_synced,
        attemptCount: 0,
        errorMessage: nativeOwned
          ? 'Owned by the native IdealPOS handheld workflow (NativeTableRound). This ' +
            'order is deliberately outside the Webit connector pipeline; its real ' +
            'delivery state lives in NativeTableRound/NativeSendAttempt.'
          : null,
      },
    });
  }

  /**
   * True when the external POS prints the kitchen ticket itself, so Servvia
   * must not also create PrinterJobs (two physical tickets for one order).
   * Only Bridge venues (`api`); every other adapter type has no working
   * external KOT path, so Servvia's own printers stay authoritative for them.
   */
  externalPosPrintsKitchenTicket(venue: Pick<Venue, 'posAdapterType'>): boolean {
    return venue.posAdapterType === POSAdapterType.api;
  }

  /**
   * Best-effort attempt to stop an order's IdealPOS dispatch when it's
   * cancelled. Returns true only if dispatch was genuinely stopped (nothing
   * will ever reach IdealposBridge for this order); false means dispatch had
   * already progressed past the point this side can safely halt it (the
   * connector already committed to delivering it, or it already reached the
   * Bridge) - never silently reports true in that case. Never throws: a
   * failure here must not block staff from recording the cancellation
   * itself, but is logged loudly and written into the record staff already
   * sees on the Order Tablet's status panel.
   */
  async stopHandoffForCancelledOrder(
    order: Order & { posSyncRecord: LegacyHandoffRecord },
    organizationId: string,
    actor: { id: string; email: string; role: StaffRole },
  ): Promise<boolean> {
    const record = order.posSyncRecord;
    if (!record) return true; // nothing was ever created to dispatch

    try {
      if (record.status === POSSyncStatus.not_synced) {
        const result = await this.prisma.pOSSyncRecord.updateMany({
          where: { id: record.id, status: POSSyncStatus.not_synced },
          data: { status: POSSyncStatus.cancelled },
        });
        // count === 0 means sweepDispatch's own CAS won the race in the
        // instant between our read and this write - it is already in
        // flight and must be treated exactly like the queued_for_connector
        // "already accepted" case below (log + return false), not retried.
        if (result.count === 1) return true;
      }

      if (record.status === POSSyncStatus.queued_for_connector && record.connectorSubmitCommandId) {
        try {
          await this.connectorCommandService.cancel(
            record.connectorSubmitCommandId,
            organizationId,
            order.venueId,
            actor.id,
            actor.email,
            actor.role,
          );
          // Cancel succeeded: the ConnectorCommand was still pending/claimed
          // (never accepted by the connector) and is now terminally
          // cancelled - safe to mark the POSSyncRecord the same way. Ignore
          // a 0-row race against sweepReconcile picking up a terminal report
          // in the same instant; that report is more authoritative than us.
          await this.prisma.pOSSyncRecord.updateMany({
            where: { id: record.id, status: POSSyncStatus.queued_for_connector },
            data: { status: POSSyncStatus.cancelled },
          });
          return true;
        } catch {
          // ConnectorCommandService.cancel throws NotFoundException once the
          // command reached `accepted` (or any later terminal state) - the
          // connector already durably committed to delivering it, so this
          // side can no longer stop it in software.
        }
      }

      // Unstoppable: already queued_for_connector-but-accepted (handled
      // above), submitted_awaiting_confirmation, synced, failed,
      // not_applicable, unsupported, or already cancelled. Make this
      // visible on the same panel staff already watch instead of silently
      // leaving a "cancelled" order that may still print a real KOT.
      this.logger.error(
        `Order ${order.id} (venue ${order.venueId}) was cancelled but its POS dispatch (status=${record.status}) could not be stopped — it may already reach or have reached IdealPOS. Verify directly with the kitchen/till.`,
      );
      await this.prisma.pOSSyncRecord
        .update({
          where: { id: record.id },
          data: {
            // Existing staff-visible text, moved verbatim. The product-name
            // wording is tracked in docs/migration/naming-inventory.md.
            errorMessage: `Order was cancelled in Verdura, but POS dispatch (status was "${record.status}") could not be stopped in time — verify directly with IdealPOS/kitchen.`,
          },
        })
        .catch((err: unknown) => {
          this.logger.error(
            `Failed to write cancellation warning onto POSSyncRecord ${record.id} for order ${order.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      return false;
    } catch (err) {
      this.logger.error(
        `stopHandoffForCancelledOrder threw unexpectedly for order ${order.id} (venue ${order.venueId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}

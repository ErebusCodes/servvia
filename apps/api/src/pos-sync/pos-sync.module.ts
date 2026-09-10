import { Module } from '@nestjs/common';
import { PosSyncController } from './pos-sync.controller';
import { PosSyncRecordsController } from './pos-sync-records.controller';
import { PosSyncRecordsService } from './pos-sync-records.service';
import { PosSyncDispatcherService } from './pos-sync-dispatcher.service';
import { IdealposOrderDispatcherService } from './idealpos-order-dispatcher.service';
import { IdealposConfirmationService } from './idealpos-confirmation.service';
import { ConnectorBridgeOrderStatusReader } from './connector-bridge-order-status.reader';
import { BRIDGE_ORDER_STATUS_READER } from './bridge-order-status';
import { PosCatalogController } from './pos-catalog.controller';
import { PosCatalogService } from './pos-catalog.service';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { ConnectorModule } from '../connector/connector.module';
import { OrdersModule } from '../orders/orders.module';
import { tableRoundWriterProvider } from './waiterpad/waiterpad-writer.provider';
import { NativeSendAttemptStore } from './waiterpad/native-send-attempt.store';
import { NativeTableRoundService } from './waiterpad/native-table-round.service';
import { NativeRoundsController } from './native-rounds.controller';
import { NativeRoundReconciliationService } from './waiterpad/native-round-reconciliation.service';
import { NativeRoundRecoveryService } from './waiterpad/native-round-recovery.service';

@Module({
  // Story 9-3: QueueModule is imported so PosSyncDispatcherService can
  // inject the existing 'pos-sync' BullMQ Queue via @InjectQueue.
  // ConnectorModule is imported (its exported ConnectorCommandService)
  // so IdealposOrderDispatcherService can create real delivery commands
  // through the existing connector protocol rather than a second one.
  // OrdersModule is imported (its exported OrdersGateway) so
  // IdealposOrderDispatcherService can push real-time order.posSyncStatus
  // transitions to staff over the same WebSocket rooms order creation/
  // kitchen-status updates already use, instead of a second mechanism.
  imports: [AuthModule, QueueModule, ConnectorModule, OrdersModule],
  controllers: [
    PosSyncController,
    PosSyncRecordsController,
    PosCatalogController,
    // POST /api/admin/orders/:id/rounds - the Order Tablet's Send to Kitchen
    // for a native venue, and the only route into the native path. It lives
    // here rather than on OrdersController because NativeTableRoundService is
    // a provider of this module and this module already imports OrdersModule;
    // the reverse edge would need a forwardRef.
    NativeRoundsController,
  ],
  providers: [
    PosSyncRecordsService,
    PosSyncDispatcherService,
    IdealposOrderDispatcherService,
    // Advances submitted_awaiting_confirmation records using a real read of
    // IdealposBridge's GET /api/orders/{externalOrderId}, obtained through
    // the Venue Connector rather than by the API calling Bridge directly —
    // the API therefore never holds Bridge's URL or bearer key. Binding the
    // reader is what activates the sweep; leaving BRIDGE_ORDER_STATUS_READER
    // unbound remains a supported configuration in which sweepConfirm()
    // reports `disabled: true` and touches nothing.
    ConnectorBridgeOrderStatusReader,
    { provide: BRIDGE_ORDER_STATUS_READER, useExisting: ConnectorBridgeOrderStatusReader },
    IdealposConfirmationService,
    PosCatalogService,
    // The IdealPOS native handheld path (WPPacket Order2 over TCP 6983).
    // `tableRoundWriterProvider` is the single place the feature gate is
    // decided: with the feature off - the default, and production today - it
    // binds DisabledTableRoundWriter, which refuses every round with zero
    // socket activity. NativeTableRoundService therefore exists in every
    // build and is inert in every build that has not been explicitly and
    // completely configured. There is no fallback from it to the Webit path.
    tableRoundWriterProvider,
    NativeSendAttemptStore,
    NativeTableRoundService,
    // Settles rounds the wire could not settle. It holds NO writer and no
    // transport - reconciliation polls, it never resends, and that is enforced
    // by its dependency graph rather than by a rule in a branch. Its evidence
    // reader (NATIVE_ROUND_EVIDENCE_READER) is deliberately left UNBOUND: no
    // connector build can read the till's token row yet, and the escalation
    // half of the job works without one.
    NativeRoundReconciliationService,
    // Settles rounds that a CRASH left in a state no route and no other sweep
    // can reach. `submitting` holds a table's in-flight slot and was swept by
    // nothing, so a restart mid-send killed that table permanently. It holds no
    // writer and no transport either: recovery decides from our own durable
    // rows whether the writer reached the send boundary, and never guesses
    // toward retry.
    NativeRoundRecoveryService,
  ],
  exports: [
    IdealposConfirmationService,
    NativeTableRoundService,
    NativeRoundReconciliationService,
    NativeRoundRecoveryService,
  ],
})
export class PosSyncModule {}

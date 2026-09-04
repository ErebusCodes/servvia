import { Module } from '@nestjs/common';
import { PosSyncController } from './pos-sync.controller';
import { PosSyncRecordsController } from './pos-sync-records.controller';
import { PosSyncRecordsService } from './pos-sync-records.service';
import { PosSyncDispatcherService } from './pos-sync-dispatcher.service';
import { IdealposOrderDispatcherService } from './idealpos-order-dispatcher.service';
import { IdealposConfirmationService } from './idealpos-confirmation.service';
import { PosCatalogController } from './pos-catalog.controller';
import { PosCatalogService } from './pos-catalog.service';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { ConnectorModule } from '../connector/connector.module';
import { OrdersModule } from '../orders/orders.module';

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
  controllers: [PosSyncController, PosSyncRecordsController, PosCatalogController],
  providers: [
    PosSyncRecordsService,
    PosSyncDispatcherService,
    IdealposOrderDispatcherService,
    // Advances submitted_awaiting_confirmation records using a real read of
    // IdealposBridge's GET /api/orders/{externalOrderId}. Registered with no
    // BridgeOrderStatusReader bound, so it is INERT: sweepConfirm() reports
    // `disabled: true` and touches nothing until a reader is deliberately
    // provided. That keeps shipping it a no-op until the Bridge status
    // transport is configured, rather than a silent behaviour change.
    IdealposConfirmationService,
    PosCatalogService,
  ],
  exports: [IdealposConfirmationService],
})
export class PosSyncModule {}

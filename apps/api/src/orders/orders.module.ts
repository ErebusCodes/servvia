import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { KdsDispatcherService } from './kds-dispatcher.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectorModule } from '../connector/connector.module';
import { PosStrategyResolver } from '../pos-sync/pos-strategy-resolver';

@Module({
  // ConnectorModule (not PosSyncModule) is imported here deliberately: it
  // exports ConnectorCommandService with no dependency back on OrdersModule,
  // so OrdersService can attempt to stop an in-flight IdealPOS dispatch on
  // order cancellation (see updateStatus) without a circular module edge —
  // PosSyncModule already imports OrdersModule the other way for OrdersGateway.
  imports: [AuditModule, AuthModule, ConnectorModule],
  controllers: [OrdersController],
  // PosStrategyResolver is provided HERE rather than imported from
  // PosSyncModule on purpose: that module already imports this one (for
  // OrdersGateway), so the edge would be circular. The resolver depends on
  // nothing but ConfigService, so registering it directly costs nothing and
  // keeps the module graph acyclic. Both registrations resolve the same pure
  // function over the same configuration, so they cannot disagree.
  providers: [OrdersService, OrdersGateway, KdsDispatcherService, PosStrategyResolver],
  // OrdersGateway exported so IdealposOrderDispatcherService (pos-sync
  // module) can push real-time order.posSyncStatus transitions to the same
  // venue:{id}:orders/kds rooms this gateway already broadcasts order
  // creation/kitchen-status updates to, instead of a second WS mechanism.
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}

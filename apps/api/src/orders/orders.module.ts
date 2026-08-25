import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { KdsDispatcherService } from './kds-dispatcher.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectorModule } from '../connector/connector.module';

@Module({
  // ConnectorModule (not PosSyncModule) is imported here deliberately: it
  // exports ConnectorCommandService with no dependency back on OrdersModule,
  // so OrdersService can attempt to stop an in-flight IdealPOS dispatch on
  // order cancellation (see updateStatus) without a circular module edge —
  // PosSyncModule already imports OrdersModule the other way for OrdersGateway.
  imports: [AuditModule, AuthModule, ConnectorModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway, KdsDispatcherService],
  // OrdersGateway exported so IdealposOrderDispatcherService (pos-sync
  // module) can push real-time order.posSyncStatus transitions to the same
  // venue:{id}:orders/kds rooms this gateway already broadcasts order
  // creation/kitchen-status updates to, instead of a second WS mechanism.
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}

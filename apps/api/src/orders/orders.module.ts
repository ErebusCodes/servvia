import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { KdsDispatcherService } from './kds-dispatcher.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway, KdsDispatcherService],
  // OrdersGateway exported so IdealposOrderDispatcherService (pos-sync
  // module) can push real-time order.posSyncStatus transitions to the same
  // venue:{id}:orders/kds rooms this gateway already broadcasts order
  // creation/kitchen-status updates to, instead of a second WS mechanism.
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}

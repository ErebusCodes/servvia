import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { KdsDispatcherService } from './kds-dispatcher.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { LegacyExternalPosModule } from '../legacy-external-pos/legacy-external-pos.module';

@Module({
  // LegacyExternalPosModule is TEMPORARY: the only route from order creation
  // to IdealPOS (see legacy-external-pos/README.md). It must never import
  // OrdersModule or PosSyncModule - PosSyncModule already imports OrdersModule
  // for OrdersGateway, so either edge would be circular.
  imports: [AuditModule, AuthModule, LegacyExternalPosModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway, KdsDispatcherService],
  // OrdersGateway exported so IdealposOrderDispatcherService (pos-sync
  // module) can push real-time order.posSyncStatus transitions to the same
  // venue:{id}:orders/kds rooms this gateway already broadcasts order
  // creation/kitchen-status updates to, instead of a second WS mechanism.
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}

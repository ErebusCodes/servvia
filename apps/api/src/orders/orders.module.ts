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
  exports: [OrdersService],
})
export class OrdersModule {}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { OrdersModule } from '../orders/orders.module';
import { TabletAuthService } from './tablet-auth.service';
import { TabletAuthController } from './tablet-auth.controller';
import { TabletDevicesAdminController } from './tablet-devices-admin.controller';
import { TabletOrdersController } from './tablet-orders.controller';
import { TabletDeviceGuard } from './guards/tablet-device.guard';
import { TabletStaffGuard } from './guards/tablet-staff.guard';
import { ManagerStepUpGuard } from './guards/manager-step-up.guard';

@Module({
  imports: [PrismaModule, AuditModule, OrdersModule, JwtModule.register({})],
  controllers: [TabletAuthController, TabletDevicesAdminController, TabletOrdersController],
  providers: [TabletAuthService, TabletDeviceGuard, TabletStaffGuard, ManagerStepUpGuard],
  exports: [TabletAuthService],
})
export class TabletModule {}

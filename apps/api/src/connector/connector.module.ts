import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectorService } from './connector.service';
import { ConnectorAdminController } from './connector-admin.controller';
import { ConnectorController } from './connector.controller';
import { ConnectorAuthGuard } from '../auth/guards/connector-auth.guard';
import { ConnectorCommandService } from './connector-command.service';
import { ConnectorCommandSweeperService } from './connector-command-sweeper.service';
import { ConnectorCommandController } from './connector-command.controller';
import { ConnectorCommandAdminController } from './connector-command-admin.controller';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [
    ConnectorAdminController,
    ConnectorController,
    ConnectorCommandAdminController,
    ConnectorCommandController,
  ],
  providers: [
    ConnectorService,
    ConnectorAuthGuard,
    ConnectorCommandService,
    ConnectorCommandSweeperService,
  ],
  exports: [ConnectorService, ConnectorCommandService],
})
export class ConnectorModule {}

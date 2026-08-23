import { Module } from '@nestjs/common';
import { PrinterController } from './printer.controller';
import { PrinterJobsController } from './printer-jobs.controller';
import { PrinterJobsService } from './printer-jobs.service';
import { PrinterDispatcherService } from './printer-dispatcher.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ConnectorModule } from '../connector/connector.module';

@Module({
  // E8-S1 (expanded): ConnectorModule is imported so PrinterDispatcherService
  // can inject the existing ConnectorCommandService (stories 2-9/2-10) via
  // its createCommand() method. No BullMQ/QueueModule dependency is
  // introduced — the durable ConnectorCommand row is this producer's own
  // outbox; see printer-dispatcher.service.ts's doc comment.
  imports: [AuthModule, AuditModule, ConnectorModule],
  controllers: [PrinterController, PrinterJobsController],
  providers: [PrinterJobsService, PrinterDispatcherService],
})
export class PrinterModule {}

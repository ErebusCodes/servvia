import { Module } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { AuditModule } from '../audit/audit.module';
import { SessionsModule } from '../auth/sessions.module';
import { StaffAdministrationService } from './staff-administration.service';
import { CredentialSetupService } from './credential-setup.service';

@Module({
  imports: [AuditModule, SessionsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffAdministrationService, CredentialSetupService],
  exports: [StaffService, CredentialSetupService],
})
export class StaffModule {}

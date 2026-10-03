import { Module } from '@nestjs/common';
import { StaffSessionService } from './staff-session.service';
import { StaffSessionCleanupService } from './staff-session-cleanup.service';

/**
 * Staff login sessions (Story 2.8), shared by sign-in (AuthModule) and staff
 * administration (StaffModule), which revokes sessions when authority is
 * removed (Story 8.1).
 */
@Module({
  providers: [StaffSessionService, StaffSessionCleanupService],
  exports: [StaffSessionService],
})
export class SessionsModule {}

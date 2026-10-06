import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffSessionService } from './staff-session.service';

/** How often expired staff sessions are deleted. */
export const STAFF_SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Deletes expired staff sessions on a timer (Story 2.8), so the table holds
 * only sessions that could still authorize something. Like the other
 * background timers it is disabled under NODE_ENV=test; tests call
 * StaffSessionService.deleteExpired directly.
 */
@Injectable()
export class StaffSessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaffSessionCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly sessions: StaffSessionService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.runOnce(), STAFF_SESSION_CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    try {
      const deleted = await this.sessions.deleteExpired();
      if (deleted > 0) this.logger.log(`Deleted ${deleted} expired staff session(s)`);
      return deleted;
    } catch (err) {
      this.logger.error(`Expired staff session cleanup failed: ${(err as Error).message}`);
      return 0;
    }
  }
}

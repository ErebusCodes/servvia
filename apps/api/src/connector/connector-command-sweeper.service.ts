import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorCommandService } from './connector-command.service';

/**
 * Periodic reconciliation timer for ConnectorCommandService#sweep(). Mirrors
 * PosSyncDispatcherService's (story 9-3) established pattern of disabling
 * the timer entirely under `NODE_ENV=test` to prevent cross-test
 * contamination in the shared local dev database — every test in this
 * story calls `sweep()` directly instead.
 */
@Injectable()
export class ConnectorCommandSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorCommandSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly sweepIntervalMs: number;

  constructor(
    private readonly commandService: ConnectorCommandService,
    config: ConfigService,
  ) {
    this.sweepIntervalMs = config.get<number>('CONNECTOR_COMMAND_SWEEP_INTERVAL_MS', 15_000);
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.commandService.sweep().catch((err: unknown) => {
        this.logger.error(
          `Sweep tick failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }, this.sweepIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

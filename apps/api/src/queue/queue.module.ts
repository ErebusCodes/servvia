import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrintJobsProcessor } from './processors/print-jobs.processor';
import { PosSyncProcessor } from './processors/pos-sync.processor';
import { EmailsProcessor } from './processors/emails.processor';
import { EmailModule } from '../email/email.module';
import { QUEUE_NAMES } from './queue.constants';

export { QUEUE_NAMES };

@Module({
  imports: [
    EmailModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: parseInt(config.get<string>('REDIS_PORT', '6379'), 10),
          lazyConnect: true,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times: number) => {
            return Math.min(Math.pow(2, times) * 100, 10000);
          },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.PRINT_JOBS },
      {
        name: QUEUE_NAMES.POS_SYNC,
        // Story 9-3 independent review (crash/replay reviewer, 2026-08-16):
        // without these, a job that throws (e.g. a transient infra error
        // inside PosSyncProcessor's own DB calls) lands in BullMQ's
        // `failed` state and is NEVER removed by default. Because the
        // dispatcher's AC17 safety-net re-claim reuses a deterministic
        // jobId (`pos-sync-{id}`), a subsequent add() against that
        // already-failed-but-still-present job silently overwrites its
        // data in place without ever re-queuing it for a worker — the
        // safety net would then "succeed" (no thrown error, dispatchedAt
        // reconfirmed) while genuinely never reprocessing the record, all
        // the way until dispatchAttemptCount exhausts and the row is
        // marked dispatchExhaustedAt. Reproduced directly against real
        // Redis before this fix; see
        // test/pos-sync-dispatcher.integration-spec.ts's "AC17 BullMQ
        // failure-recovery mechanics" block. `attempts`/`backoff` gives
        // most transient failures an in-process retry within seconds,
        // before the dispatcher's much slower (minutes-later) safety net
        // is ever needed at all; `removeOnFail`/`removeOnComplete` ensure
        // a job's deterministic jobId becomes reusable once BullMQ itself
        // is done with it, so a genuine re-claim can actually re-queue.
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      },
      { name: QUEUE_NAMES.EMAILS },
      { name: QUEUE_NAMES.CALENDAR },
    ),
  ],
  providers: [PrintJobsProcessor, PosSyncProcessor, EmailsProcessor],
  exports: [BullModule],
})
export class QueueModule {}

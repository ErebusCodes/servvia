import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';
import { EmailService } from '../../email/email.service';
import { EmailJobPayload } from './email-job.types';

@Processor(QUEUE_NAMES.EMAILS)
export class EmailsProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailsProcessor.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    const { type, ...payload } = job.data;
    if (type === 'reservation-confirmed') {
      await this.emailService.sendReservationConfirmed(payload);
    } else if (type === 'reservation-cancelled') {
      await this.emailService.sendReservationCancelled(payload);
    } else {
      this.logger.warn(`Unknown email job type: ${String(type)}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `Email job ${job.id} failed after ${job.attemptsMade} attempt(s): ${err.message}`,
      err.stack,
    );
  }
}

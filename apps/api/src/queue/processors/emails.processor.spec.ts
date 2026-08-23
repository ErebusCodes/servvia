import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailsProcessor } from './emails.processor';
import { EmailService } from '../../email/email.service';
import { EmailJobPayload } from './email-job.types';

const mockEmailService = {
  sendReservationConfirmed: jest.fn().mockResolvedValue(undefined),
  sendReservationCancelled: jest.fn().mockResolvedValue(undefined),
};

function makeJob(data: EmailJobPayload, id = 'job-1', attemptsMade = 1): Job<EmailJobPayload> {
  return { id, data, attemptsMade } as unknown as Job<EmailJobPayload>;
}

describe('EmailsProcessor', () => {
  let processor: EmailsProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailsProcessor, { provide: EmailService, useValue: mockEmailService }],
    }).compile();

    processor = module.get<EmailsProcessor>(EmailsProcessor);
    jest.clearAllMocks();
  });

  const basePayload = {
    guestName: 'Alice Smith',
    guestEmail: 'alice@example.com',
    bookingRef: 'VR-1234',
    reservationDate: '2026-07-01',
    reservationTime: '19:00',
    partySize: 2,
    venueName: 'Verdura',
  };

  describe('process', () => {
    it('calls sendReservationConfirmed for reservation-confirmed type', async () => {
      const job = makeJob({ type: 'reservation-confirmed', ...basePayload });
      await processor.process(job);

      expect(mockEmailService.sendReservationConfirmed).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendReservationConfirmed).toHaveBeenCalledWith(basePayload);
      expect(mockEmailService.sendReservationCancelled).not.toHaveBeenCalled();
    });

    it('calls sendReservationCancelled for reservation-cancelled type', async () => {
      const job = makeJob({ type: 'reservation-cancelled', ...basePayload });
      await processor.process(job);

      expect(mockEmailService.sendReservationCancelled).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendReservationCancelled).toHaveBeenCalledWith(basePayload);
      expect(mockEmailService.sendReservationConfirmed).not.toHaveBeenCalled();
    });

    it('logs warning for unknown job type', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'warn');
      const job = makeJob({ type: 'unknown-type' as EmailJobPayload['type'], ...basePayload });
      await processor.process(job);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown email job type'));
      expect(mockEmailService.sendReservationConfirmed).not.toHaveBeenCalled();
      expect(mockEmailService.sendReservationCancelled).not.toHaveBeenCalled();
    });
  });

  describe('onFailed', () => {
    it('logs error with job id and message', () => {
      const logSpy = jest.spyOn(Logger.prototype, 'error');
      const job = makeJob({ type: 'reservation-confirmed', ...basePayload }, 'job-42', 3);
      const err = new Error('Resend API unreachable');

      processor.onFailed(job, err);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('job-42'), expect.anything());
    });
  });
});

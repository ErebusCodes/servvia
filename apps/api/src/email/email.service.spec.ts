const mockSend = jest.fn().mockResolvedValue({ id: 'email-id-1' });

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { ReservationEmailPayload } from '../queue/processors/email-job.types';

const payload: ReservationEmailPayload = {
  guestName: 'Alice Smith',
  guestEmail: 'alice@example.com',
  bookingRef: 'VR-1234',
  reservationDate: '2026-07-01',
  reservationTime: '19:00',
  partySize: 2,
  venueName: 'Verdura',
};

function makeService(apiKey: string | undefined): Promise<EmailService> {
  return Test.createTestingModule({
    providers: [
      EmailService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, defaultVal?: string) => {
            if (key === 'RESEND_API_KEY') return apiKey;
            if (key === 'EMAIL_FROM')
              return defaultVal ?? 'Verdura Reservations <no-reply@verdura.co.nz>';
            if (key === 'EMAIL_BOOKINGS_BCC') return defaultVal ?? 'bookings.verdura@gmail.com';
            return defaultVal;
          },
        },
      },
    ],
  })
    .compile()
    .then((m: TestingModule) => m.get<EmailService>(EmailService));
}

describe('EmailService', () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  describe('sendReservationConfirmed', () => {
    it('sends email with correct to, bcc, and subject when API key is set', async () => {
      const service = await makeService('re_test_key');
      await service.sendReservationConfirmed(payload);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = (mockSend.mock.calls[0] as [Record<string, unknown>])[0];
      expect(call.to).toEqual(['alice@example.com']);
      expect(call.bcc).toEqual(['bookings.verdura@gmail.com']);
      expect(call.subject).toBe('Booking confirmed — VR-1234');
    });

    it('html includes guest name, booking ref, date, time, and party size', async () => {
      const service = await makeService('re_test_key');
      await service.sendReservationConfirmed(payload);

      const html = (mockSend.mock.calls[0] as [Record<string, unknown>])[0].html as string;
      expect(html).toContain('Alice Smith');
      expect(html).toContain('VR-1234');
      expect(html).toContain('01 Jul 2026');
      expect(html).toContain('19:00');
      expect(html).toContain('2 guests');
    });

    it('skips delivery and logs warning when RESEND_API_KEY is not set', async () => {
      const service = await makeService(undefined);
      const logSpy = jest.spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      await service.sendReservationConfirmed(payload);

      expect(mockSend).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY'));
    });
  });

  describe('sendReservationCancelled', () => {
    it('sends email with correct to and subject; no bcc when API key is set', async () => {
      const service = await makeService('re_test_key');
      await service.sendReservationCancelled(payload);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = (mockSend.mock.calls[0] as [Record<string, unknown>])[0];
      expect(call.to).toEqual(['alice@example.com']);
      expect(call).not.toHaveProperty('bcc');
      expect(call.subject).toBe('Booking cancelled — VR-1234');
    });

    it('html includes guest name and booking ref', async () => {
      const service = await makeService('re_test_key');
      await service.sendReservationCancelled(payload);

      const html = (mockSend.mock.calls[0] as [Record<string, unknown>])[0].html as string;
      expect(html).toContain('Alice Smith');
      expect(html).toContain('VR-1234');
    });

    it('skips delivery and logs warning when RESEND_API_KEY is not set', async () => {
      const service = await makeService(undefined);
      const logSpy = jest.spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      await service.sendReservationCancelled(payload);

      expect(mockSend).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY'));
    });
  });

  // Story 2.7: guest-supplied text is HTML-escaped in every email.
  describe('HTML injection', () => {
    const hostile: ReservationEmailPayload = {
      ...payload,
      guestName: '<script>alert(1)</script><img src=x onerror="steal()">',
      venueName: 'Verdura & "Co" <b>',
    };

    it.each([
      ['confirmation', 'sendReservationConfirmed'],
      ['cancellation', 'sendReservationCancelled'],
    ] as const)('escapes the guest and venue names in the %s email', async (_name, method) => {
      const service = await makeService('re_test_key');
      await service[method](hostile);
      const html = (mockSend.mock.calls[0] as [Record<string, unknown>])[0].html as string;
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img');
      expect(html).toContain(
        '&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=&quot;steal()&quot;&gt;',
      );
      expect(html).toContain('Verdura &amp; &quot;Co&quot; &lt;b&gt;');
    });
  });
});

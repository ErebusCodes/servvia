import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { ReservationEmailPayload } from '../queue/processors/email-job.types';
import { escapeHtml } from '../common/utils/html-escape';

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${day} ${months[parseInt(month, 10) - 1]} ${year}`;
}

// Every interpolated value is HTML-escaped: guestName is public input.
function confirmationHtml(p: ReservationEmailPayload): string {
  return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
<h2 style="color:#2d6a4f;margin-bottom:8px">Booking Confirmed</h2>
<p>Hi ${escapeHtml(p.guestName)},</p>
<p>Your reservation at <strong>${escapeHtml(p.venueName)}</strong> has been confirmed.</p>
<table style="border-collapse:collapse;width:100%;margin:16px 0">
  <tr><td style="padding:6px 0;color:#555">Reference</td><td style="padding:6px 0;font-weight:600">${escapeHtml(p.bookingRef)}</td></tr>
  <tr><td style="padding:6px 0;color:#555">Date</td><td style="padding:6px 0">${escapeHtml(formatDate(p.reservationDate))}</td></tr>
  <tr><td style="padding:6px 0;color:#555">Time</td><td style="padding:6px 0">${escapeHtml(p.reservationTime)}</td></tr>
  <tr><td style="padding:6px 0;color:#555">Party size</td><td style="padding:6px 0">${escapeHtml(p.partySize)} guest${p.partySize !== 1 ? 's' : ''}</td></tr>
</table>
<p>See you soon!</p>
<p style="color:#888;font-size:12px">Questions? Reply to this email or call us directly.</p>
</body></html>`;
}

function cancellationHtml(p: ReservationEmailPayload): string {
  return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
<h2 style="color:#c0392b;margin-bottom:8px">Booking Cancelled</h2>
<p>Hi ${escapeHtml(p.guestName)},</p>
<p>Your reservation at <strong>${escapeHtml(p.venueName)}</strong> has been cancelled.</p>
<table style="border-collapse:collapse;width:100%;margin:16px 0">
  <tr><td style="padding:6px 0;color:#555">Reference</td><td style="padding:6px 0;font-weight:600">${escapeHtml(p.bookingRef)}</td></tr>
  <tr><td style="padding:6px 0;color:#555">Date</td><td style="padding:6px 0">${escapeHtml(formatDate(p.reservationDate))}</td></tr>
  <tr><td style="padding:6px 0;color:#555">Time</td><td style="padding:6px 0">${escapeHtml(p.reservationTime)}</td></tr>
</table>
<p>We're sorry we couldn't accommodate you this time. Contact us to rebook.</p>
<p style="color:#888;font-size:12px">Questions? Reply to this email or call us directly.</p>
</body></html>`;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly bcc: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = config.get<string>('EMAIL_FROM', 'Verdura Reservations <no-reply@verdura.co.nz>');
    this.bcc = config.get<string>('EMAIL_BOOKINGS_BCC', 'bookings.verdura@gmail.com');
  }

  async sendReservationConfirmed(payload: ReservationEmailPayload): Promise<void> {
    if (!this.resend) {
      // TODO: RESEND_API_KEY required - Skip sending emails and log warning when API Key is missing
      this.logger.warn('RESEND_API_KEY not set — skipping confirmation email');
      return;
    }
    await this.resend.emails.send({
      from: this.from,
      to: [payload.guestEmail],
      bcc: [this.bcc],
      subject: `Booking confirmed — ${payload.bookingRef}`,
      html: confirmationHtml(payload),
    });
  }

  async sendReservationCancelled(payload: ReservationEmailPayload): Promise<void> {
    if (!this.resend) {
      // TODO: RESEND_API_KEY required - Skip sending emails and log warning when API Key is missing
      this.logger.warn('RESEND_API_KEY not set — skipping cancellation email');
      return;
    }
    await this.resend.emails.send({
      from: this.from,
      to: [payload.guestEmail],
      subject: `Booking cancelled — ${payload.bookingRef}`,
      html: cancellationHtml(payload),
    });
  }
}

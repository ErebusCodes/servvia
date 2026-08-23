---
baseline_commit: 553c571
---

# Story 5.4: Email on Confirmation and Cancellation (Resend)

Status: review

> **Enterprise conformance addendum — 2026-08-15:** Customer communications must name the correct truth source and never describe pending POS handoff, pending Idealpos payment or queued kitchen delivery as confirmed/paid/printed. Messages are idempotent, correlated and suppress duplicates during retries. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant guest,
I want to receive an email when my reservation is confirmed or cancelled,
so that I have a clear record of my booking status.

## Acceptance Criteria

1. **Confirmation email (pending → confirmed transition):**
   - Customer receives an email at `guestEmail` within 30 seconds of status → `confirmed`.
   - BCC copy sent to the configured bookings address (`EMAIL_BOOKINGS_BCC`, default `bookings.verdura@gmail.com`).
   - Email contains: guest name, booking reference (`VR-NNNN`), date, time, party size, venue name.

2. **Cancellation email (any → cancelled transition):**
   - Customer receives an email at `guestEmail` within 30 seconds of status → `cancelled`.
   - No BCC on cancellation.
   - Email contains: guest name, booking reference, date, time, cancellation note.

3. **Email delivery via BullMQ `emails` queue:**
   - `ReservationsService.transition()` enqueues an `EmailJobPayload` job after the DB update.
   - `EmailsProcessor` picks it up and calls Resend SDK.
   - Failed Resend calls are retried up to 3 times (BullMQ `attempts: 3`, `backoff: { type: 'exponential', delay: 2000 }`).

4. **Graceful degradation:**
   - If Redis is unavailable and the enqueue fails, the transition still succeeds (204 HTTP response). Log the error but do not re-throw.
   - If `RESEND_API_KEY` is not set, processor logs a warning and skips delivery (no crash).

5. **Build quality:**
   - `npm run test --workspace=backend -- --testPathPattern='email|reservations'` passes.
   - `npx eslint "src/email/**/*.ts" "src/queue/processors/emails.processor.ts"` clean.

## Tasks / Subtasks

- [x] Task 1 — Install Resend SDK and add env vars
  - [x] `npm install resend --workspace=backend`
  - [x] Add `RESEND_API_KEY=re_...`, `EMAIL_FROM=Verdura Reservations <no-reply@verdura.co.nz>`, `EMAIL_BOOKINGS_BCC=bookings.verdura@gmail.com` to `backend/.env` and `backend/.env.example`
  - [x] Add `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_BOOKINGS_BCC` to `backend/src/config/config.ts` (or wherever env validation lives in `common/`)

- [x] Task 2 — Create EmailModule + EmailService
  - [x] Create `backend/src/email/email.service.ts` — wraps Resend SDK; exposes `sendReservationConfirmed()` and `sendReservationCancelled()` methods
  - [x] Create `backend/src/email/email.module.ts` — `@Global()` module; imports `ConfigModule`; exports `EmailService`
  - [x] Register `EmailModule` in `AppModule`

- [x] Task 3 — Create EmailsProcessor
  - [x] Create `backend/src/queue/processors/emails.processor.ts` — `@Processor(QUEUE_NAMES.EMAILS)` class; `@OnWorkerEvent` for failures; injects `EmailService`
  - [x] Add `EmailsProcessor` to `QueueModule` providers
  - [x] Import `EmailModule` in `QueueModule` (so processor can inject `EmailService`)

- [x] Task 4 — Wire ReservationsService → emails queue
  - [x] In `ReservationsService` constructor, inject `@InjectQueue(QUEUE_NAMES.EMAILS) private emailQueue: Queue`
  - [x] After the DB update in `transition()`, enqueue job for `confirmed` and `cancelled` transitions; wrap in try/catch so failures do not throw
  - [x] Import `QueueModule` in `ReservationsModule`

- [x] Task 5 — Tests
  - [x] `email.service.spec.ts` — mock Resend client; verify correct `to`, `bcc`, `subject`, `html` for confirmed and cancelled
  - [x] `emails.processor.spec.ts` — mock `EmailService`; verify processor calls correct method per job type; verify failure logging
  - [x] Update `reservations.service.spec.ts` — mock `emailQueue`; verify `add()` called with correct payload on `confirmed`/`cancelled`; verify transition still resolves when `add()` throws

- [x] Task 6 — Run verification
  - [x] `npm run test --workspace=backend -- --testPathPattern='email|reservations'` — all pass
  - [x] `npx eslint "src/email/**/*.ts" "src/queue/processors/emails.processor.ts" "src/reservations/reservations.service.ts"` — clean

## Dev Notes

### Email queue already exists — no schema changes needed

`QUEUE_NAMES.EMAILS = 'emails'` is already registered in `QueueModule` (`backend/src/queue/queue.module.ts`). Only `PrintJobsProcessor` and `PosSyncProcessor` are wired; `EmailsProcessor` is the missing piece.

### Resend SDK usage (v4.x)

```typescript
// backend/src/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

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
    if (!this.resend) { this.logger.warn('RESEND_API_KEY not set — skipping email'); return; }
    await this.resend.emails.send({
      from: this.from,
      to: [payload.guestEmail],
      bcc: [this.bcc],
      subject: `Booking confirmed — ${payload.bookingRef}`,
      html: confirmationHtml(payload),
    });
  }

  async sendReservationCancelled(payload: ReservationEmailPayload): Promise<void> {
    if (!this.resend) { this.logger.warn('RESEND_API_KEY not set — skipping email'); return; }
    await this.resend.emails.send({
      from: this.from,
      to: [payload.guestEmail],
      subject: `Booking cancelled — ${payload.bookingRef}`,
      html: cancellationHtml(payload),
    });
  }
}
```

Keep `confirmationHtml()` and `cancellationHtml()` as simple private functions in the same file — plain HTML strings, no template engine. Keep it readable, not fancy.

### EmailJobPayload interface

Define in `backend/src/queue/processors/emails.processor.ts` (or a shared types file):

```typescript
export interface EmailJobPayload {
  type: 'reservation-confirmed' | 'reservation-cancelled';
  guestName: string;
  guestEmail: string;
  bookingRef: string;
  reservationDate: string; // ISO date string from Prisma Date
  reservationTime: string;
  partySize: number;
  venueName: string;
}
```

### EmailsProcessor skeleton

```typescript
// backend/src/queue/processors/emails.processor.ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.module';
import { EmailService } from '../../email/email.service';
import { EmailJobPayload } from './email-job.types'; // or inline

@Processor(QUEUE_NAMES.EMAILS)
export class EmailsProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailsProcessor.name);

  constructor(private readonly emailService: EmailService) { super(); }

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
    this.logger.error(`Email job ${job.id} failed: ${err.message}`);
  }
}
```

### Enqueue in ReservationsService.transition()

```typescript
// After this.prisma.reservation.update(...) succeeds:
if (newStatus === ReservationStatus.confirmed || newStatus === ReservationStatus.cancelled) {
  const venue = await this.prisma.venue.findFirst({ where: { id: reservation.venueId } });
  const payload: EmailJobPayload = {
    type: newStatus === ReservationStatus.confirmed
      ? 'reservation-confirmed'
      : 'reservation-cancelled',
    guestName: reservation.guestName,
    guestEmail: reservation.guestEmail,
    bookingRef: reservation.bookingRef,
    reservationDate: reservation.reservationDate.toISOString().split('T')[0],
    reservationTime: reservation.reservationTime,
    partySize: reservation.partySize,
    venueName: venue?.name ?? 'Verdura',
  };
  try {
    await this.emailQueue.add('send-email', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  } catch (err) {
    this.logger.error('Failed to enqueue email job', err);
  }
}
```

### QueueModule changes

Add `EmailModule` import and `EmailsProcessor` to providers:

```typescript
imports: [...existing..., EmailModule],
providers: [PrintJobsProcessor, PosSyncProcessor, EmailsProcessor],
```

### ReservationsModule changes

Add `QueueModule` import (for `InjectQueue` to work):

```typescript
imports: [PrismaModule, QueueModule],
```

### Env vars to add to backend/src/common/ validation (if ConfigService uses Joi/class-validator schema)

Check `backend/src/common/` or `backend/src/app.module.ts` for the `validationSchema` / `ConfigModule.forRoot` call. Add:
- `RESEND_API_KEY` — optional string (graceful no-op if absent)
- `EMAIL_FROM` — optional string (has default)
- `EMAIL_BOOKINGS_BCC` — optional string (has default)

### HTML email templates

Keep them minimal — table-free HTML. Guest-facing copy:
- **Confirmed subject:** `Booking confirmed — VR-XXXX`
- **Confirmed body:** Guest name, ref, date (formatted `DD MMM YYYY`), time, party size, "See you soon!"
- **Cancelled subject:** `Booking cancelled — VR-XXXX`
- **Cancelled body:** Guest name, ref, apology line, "Contact us to rebook."

No external CSS frameworks. Inline styles only. Keep the HTML under ~30 lines per template.

### Test mocking pattern for Resend

```typescript
// In email.service.spec.ts
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ id: 'test-id' }) },
  })),
}));
```

### What NOT to do

- Do NOT use `@nestjs/mailer` or nodemailer — Resend SDK is the choice.
- Do NOT send emails synchronously inside the HTTP request — always enqueue.
- Do NOT add email fields to `CreateReservationDto` or `UpdateReservationDto`.
- Do NOT create a new Prisma model for email logs (out of scope).
- Do NOT add a "resend confirmation email" admin endpoint (E5-S6 scope if needed).

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6 (2026-06-22)

### Completion Notes List
- Implemented Resend SDK integration via `EmailService` with graceful no-op when `RESEND_API_KEY` is absent
- Extracted `QUEUE_NAMES` to `queue.constants.ts` to break circular import (`emails.processor.ts` → `queue.module.ts` → `emails.processor.ts`)
- `queue.module.ts` re-exports `QUEUE_NAMES` from constants so all existing consumers are unaffected
- `ReservationsService.transition()` wraps `emailQueue.add()` in try/catch; Redis failure does not interrupt the HTTP response (204 still returns)
- `reservationDate` is stored as `String` in Prisma (not DateTime); used directly in email payload without `.toISOString()` conversion
- Venue name fetched via `venue.findFirst()` after DB update; falls back to `'Verdura'` if null
- 45 new/updated tests added; full suite 208/208 pass; lint clean

### File List
- `backend/src/email/email.service.ts` (NEW)
- `backend/src/email/email.module.ts` (NEW)
- `backend/src/email/email.service.spec.ts` (NEW)
- `backend/src/queue/processors/emails.processor.ts` (NEW)
- `backend/src/queue/processors/email-job.types.ts` (NEW)
- `backend/src/queue/processors/emails.processor.spec.ts` (NEW)
- `backend/src/queue/queue.constants.ts` (NEW — extracted from queue.module.ts to break circular import)
- `backend/src/queue/queue.module.ts` (UPDATE — import EmailModule + EmailsProcessor + QUEUE_NAMES from constants)
- `backend/src/reservations/reservations.service.ts` (UPDATE — inject emailQueue, enqueue on transition)
- `backend/src/reservations/reservations.module.ts` (UPDATE — import QueueModule)
- `backend/src/reservations/reservations.service.spec.ts` (UPDATE — mock emailQueue, 9 new transition tests)
- `backend/src/app.module.ts` (UPDATE — register EmailModule, add optional Joi vars)
- `backend/.env` (UPDATE — add RESEND_API_KEY placeholder, EMAIL_FROM, EMAIL_BOOKINGS_BCC)
- `backend/.env.example` (UPDATE — document same vars)

## Change Log

- 2026-06-21: Story created. (bmad-create-story)
- 2026-06-22: Implementation complete. EmailModule/EmailService (Resend), EmailsProcessor (BullMQ), transition() email enqueue with graceful Redis degradation, QUEUE_NAMES constants extraction. 208/208 tests pass, lint clean. (claude-sonnet-4-6)

import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { VenuesModule } from './venues/venues.module';
import { TablesModule } from './tables/tables.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { ReservationsModule } from './reservations/reservations.module';
import { KioskModule } from './kiosk/kiosk.module';
import { PrinterModule } from './printer/printer.module';
import { PosSyncModule } from './pos-sync/pos-sync.module';
import { PaymentObservationModule } from './payment-observation/payment-observation.module';
import { ConnectorModule } from './connector/connector.module';
import { ReportingModule } from './reporting/reporting.module';
import { StaffModule } from './staff/staff.module';
import { MediaModule } from './media/media.module';
import { AuditModule } from './audit/audit.module';
import { RedisModule } from './redis/redis.module';
import { EmailModule } from './email/email.module';
import { TabletModule } from './tablet/tablet.module';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { CsrfMiddleware } from './common/middleware/csrf.middleware';
import { validateEnvironment } from './config/environment.validation';
import { QUEUE_PREFIX_PATTERN } from './queue/queue.constants';

export const configValidationSchema = Joi.object({
  // Required, no default: an unset environment refuses to start rather than
  // silently opening every development-only path (Story 1.5).
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().default(3000),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).default(0),
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('127.0.0.1'),
  REDIS_PORT: Joi.number().default(6379),
  // Story 12.14: BullMQ key prefix. Unset in production (BullMQ's default);
  // the integration-test harness sets a unique one per spec file.
  QUEUE_PREFIX: Joi.string().pattern(QUEUE_PREFIX_PATTERN).optional(),
  // Local filesystem media storage. All
  // optional — MediaService falls back to ./storage and http://localhost:PORT.
  MEDIA_STORAGE_PATH: Joi.string().optional(),
  MEDIA_BASE_URL: Joi.string().uri().optional(),
  MEDIA_MAX_FILE_SIZE_BYTES: Joi.number().default(5 * 1024 * 1024),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRY: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d'),
  INTERNAL_SERVICE_TOKEN: Joi.string().min(32).required(),
  // Not every production venue uses kiosk/Stripe Terminal payments (e.g.
  // DUNEDIN's IdealPOS-integrated Order Tablet chain has no Stripe
  // involvement at all). Requiring this at boot for every NODE_ENV=production
  // deployment would block venues that never touch the kiosk/Stripe
  // endpoints from starting at all. The actual security guarantee — that
  // createConnectionToken/createPaymentIntent refuse to run without a real
  // key — is already enforced independently at call time by
  // OrdersService.requireStripeKey(), which throws ServiceUnavailableException
  // whenever the key is absent, regardless of what booted. So this only
  // needs to be a well-formed key *if provided*, never a blanket boot
  // requirement.
  STRIPE_SECRET_KEY: Joi.string().min(20).optional().allow(''),
  // KDS device auth — venue-scoped PIN exchange (MVP-001): optional; absence
  // means the KDS PIN-exchange endpoint fails closed (rejects every request)
  // rather than granting access.
  KDS_VENUE_PINS: Joi.string().optional().allow(''),
  KDS_TOKEN_EXPIRY: Joi.string().default('12h'),
  // Order Tablet device identity / staff elevation / manager step-up
  // (story 15-1, DL-081). All optional with sensible defaults — the venue
  // unlock PIN itself reuses KDS_VENUE_PINS above (see TabletAuthService's
  // class doc comment on why it's read independently rather than shared
  // code with KdsAuthService).
  TABLET_DEVICE_TOKEN_EXPIRY: Joi.string().default('30d'),
  TABLET_STAFF_ELEVATION_EXPIRY: Joi.string().default('20m'),
  TABLET_MANAGER_STEPUP_EXPIRY: Joi.string().default('5m'),
  // Email — Resend (E5-S4): all optional; graceful no-op when absent
  RESEND_API_KEY: Joi.string().optional().allow(''),
  EMAIL_FROM: Joi.string().optional().default('Verdura Reservations <no-reply@verdura.co.nz>'),
  EMAIL_BOOKINGS_BCC: Joi.string().optional().default('bookings.verdura@gmail.com'),
  // Story 9-3: POS-sync outbox dispatcher tuning — all optional, sensible
  // defaults applied in PosSyncDispatcherService itself. This dispatcher is
  // cloud-internal only; it never contacts Idealpos, a connector, or a
  // venue LAN (see docs/decisions-log.md DL-069).
  //
  // DL-091 supersedes DL-069's "direct dispatch is safe now" for the
  // specific POSSyncRecord rows story 15-4/15-5 now also dispatches via
  // IdealposOrderDispatcherService: both services CAS the same
  // `status: not_synced` rows with no discriminator between them, so
  // whichever wins the race first is authoritative — DL-069 predates that
  // second dispatcher and never accounted for it. Defaulting this OFF makes
  // IdealposOrderDispatcherService the sole production owner of those rows
  // without deleting PosSyncDispatcherService/PosSyncProcessor; set to
  // `true` only for a deployment that genuinely still wants the
  // cloud-internal `unsupported`/`not_applicable` auto-classification this
  // dispatcher performs (DL-069's original, still-true justification for
  // any row the new dispatcher does not also claim).
  POS_SYNC_DISPATCH_ENABLED: Joi.boolean().default(false),
  POS_SYNC_DISPATCH_SWEEP_INTERVAL_MS: Joi.number().integer().min(1000).optional(),
  POS_SYNC_DISPATCH_BATCH_SIZE: Joi.number().integer().min(1).max(1000).optional(),
  // Cross-field constraint (claimLeaseMs < safetyNetMs) is enforced at
  // startup by PosSyncDispatcherService itself, not expressible in Joi.
  POS_SYNC_DISPATCH_CLAIM_LEASE_MS: Joi.number().integer().min(1000).max(600_000).optional(),
  POS_SYNC_DISPATCH_SAFETY_NET_MS: Joi.number().integer().min(60_000).optional(),
  POS_SYNC_DISPATCH_MAX_ATTEMPTS: Joi.number().integer().min(1).optional(),

  // DL-092: bounded exponential backoff for a transient IdealPOS Bridge/
  // connector delivery failure (bridge_unreachable_or_failed, or a
  // ConnectorCommand that expired before ever being claimed — zero side
  // effects either way). The existing IDEALPOS_DISPATCH_MAX_ATTEMPTS
  // (IdealposOrderDispatcherService's own constructor default: 5) is
  // reused as the retry ceiling — no second attempt-count concept was
  // introduced.
  IDEALPOS_RETRY_BASE_DELAY_MS: Joi.number().integer().min(1000).optional(),
  IDEALPOS_RETRY_MAX_DELAY_MS: Joi.number().integer().min(1000).optional(),

  // DL-093: how long a stale `unknown` idealpos.submit_order.v1
  // ConnectorCommand (accepted, no terminal report within
  // ConnectorCommandService's own 5-minute TERMINAL_REPORT_WINDOW_MS) waits
  // before IdealposOrderDispatcherService creates a new recovery transport
  // attempt (same externalOrderId, same stored payload — never rebuilt).
  // Service default (10 minutes) is applied in IdealposOrderDispatcherService
  // itself, matching this schema's existing optional-with-service-default
  // convention for every other IDEALPOS_* timing knob above.
  IDEALPOS_UNKNOWN_RECOVERY_GRACE_MS: Joi.number().integer().min(60_000).optional(),

  // Table 19 controlled live-validation guard (Order Tablet Idealpos+KDS+KOT
  // orchestration validation) — see OrdersService.assertTable19ValidationModeAllows.
  // Both optional; the guard is entirely inert unless BOTH are set AND
  // NODE_ENV !== 'production' (production is hard-disabled regardless of
  // these values, matching IdealposFixtureInjectionController's pattern).
  TABLE19_LIVE_TEST_ENABLED: Joi.boolean().optional().default(false),
  TABLE19_LIVE_TEST_VENUE_ID: Joi.string().uuid().optional().allow(''),

  // E8-S1 (expanded): KOT dispatch producer tuning — all optional, sensible
  // defaults applied in PrinterDispatcherService itself. This producer is
  // cloud-internal only; it writes durable ConnectorCommand rows and never
  // contacts a printer, a connector, or a venue LAN directly (DL-069).
  PRINTER_DISPATCH_SWEEP_INTERVAL_MS: Joi.number().integer().min(1000).optional(),
  PRINTER_DISPATCH_BATCH_SIZE: Joi.number().integer().min(1).max(1000).optional(),
  // Cross-field constraint (claimLeaseMs < safetyNetMs) is enforced at
  // startup by PrinterDispatcherService itself, not expressible in Joi.
  PRINTER_DISPATCH_CLAIM_LEASE_MS: Joi.number().integer().min(1000).max(600_000).optional(),
  PRINTER_DISPATCH_SAFETY_NET_MS: Joi.number().integer().min(60_000).optional(),
  PRINTER_DISPATCH_MAX_ATTEMPTS: Joi.number().integer().min(1).optional(),

  // Durable KDS delivery-intent dispatch/sweep tuning — all optional,
  // sensible defaults applied in KdsDispatcherService itself. Same pattern as
  // POS_SYNC_DISPATCH_*/PRINTER_DISPATCH_* above. This dispatcher only emits
  // over the existing in-process WebSocket gateway — it never contacts a
  // connector, a venue LAN, or any external system.
  KDS_DISPATCH_SWEEP_INTERVAL_MS: Joi.number().integer().min(1000).optional(),
  KDS_DISPATCH_BATCH_SIZE: Joi.number().integer().min(1).max(1000).optional(),
  // Cross-field constraint (claimLeaseMs < safetyNetMs) is enforced at
  // startup by KdsDispatcherService itself, not expressible in Joi.
  KDS_DISPATCH_CLAIM_LEASE_MS: Joi.number().integer().min(1000).max(600_000).optional(),
  KDS_DISPATCH_SAFETY_NET_MS: Joi.number().integer().min(60_000).optional(),
  KDS_DISPATCH_MAX_ATTEMPTS: Joi.number().integer().min(1).optional(),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) =>
        validateEnvironment(configValidationSchema, config),
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    HealthModule,
    AuthModule,
    VenuesModule,
    TablesModule,
    MenuModule,
    OrdersModule,
    ReservationsModule,
    KioskModule,
    PrinterModule,
    PaymentObservationModule,
    PosSyncModule,
    ConnectorModule,
    ReportingModule,
    StaffModule,
    MediaModule,
    AuditModule,
    EmailModule,
    TabletModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SecurityHeadersMiddleware, CsrfMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}

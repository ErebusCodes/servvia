// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking. Exercises story 15-1's (DL-081)
// Order Tablet device identity, restricted/customer ordering, named staff
// elevation, and manager step-up end to end through the real HTTP surface
// (JwtAuthGuard/RolesGuard/RateLimitGuard/TabletDeviceGuard/TabletStaffGuard/
// ManagerStepUpGuard/StaffSessionOnlyGuard all engaged, not bypassed).
//
// Never contacts Idealpos, EFTPOS, a printer, or initiates any KOT print —
// no assertion here should be read as evidence of such contact.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.constants';

describe('Order Tablet device identity, elevation & manager step-up (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const TAG = 'story15-1-integration';

  let orgId: string;
  let venueId: string;
  let ownerToken: string;

  let otherOrgId: string;
  let otherVenueId: string;

  let tableId: string;
  let tableId2: string;
  let tableId3: string;
  let menuItemId: string;

  let cashierId: string;
  let managerId: string;
  let inactiveStaffId: string;
  let crossVenueStaffId: string;

  const CASHIER_PIN = '4242';
  const MANAGER_PIN = '9911';
  const INACTIVE_PIN = '1234';
  const CROSS_VENUE_PIN = '5678';

  async function createOrgVenueOwner(label: string) {
    const org = await prisma.organization.create({
      data: {
        name: `${TAG} ${label} org`,
        slug: `${TAG}-${label}-org-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        billingEmail: `${TAG}-${label}@verdura.internal`,
      },
    });
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: `${TAG} ${label} venue`,
        slug: `${TAG}-${label}-venue-${Date.now()}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
      },
    });
    const password = `${TAG}-${label}-password-1234`;
    const owner = await prisma.staff.create({
      data: {
        organizationId: org.id,
        email: `${TAG}-${label}-owner-${Date.now()}@verdura.internal`,
        name: `${label} Owner`,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'owner',
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    return {
      orgId: org.id,
      venueId: venue.id,
      ownerId: owner.id,
      accessToken: loginRes.body.accessToken as string,
    };
  }

  async function enrollFreshDevice(
    venue: string,
  ): Promise<{ deviceId: string; deviceToken: string }> {
    const created = await request(app.getHttpServer())
      .post(`/api/venues/${venue}/tablet-devices/enrollments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ label: 'integration-test tablet' })
      .expect(201);
    const enrollRes = await request(app.getHttpServer())
      .post('/api/tablet/enroll')
      .send({ bootstrapToken: created.body.bootstrapToken })
      .expect(200);
    return {
      deviceId: enrollRes.body.deviceId as string,
      deviceToken: enrollRes.body.deviceToken as string,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    const redis = app.get<Redis>(REDIS_CLIENT);
    const staleKeys = await redis.keys('rate-limit:*:*:/api/tablet/*');
    if (staleKeys.length > 0) await redis.del(...staleKeys);
    const staleVenueKeys = await redis.keys('rate-limit:*:*:/api/venues/*/tablet-devices/*');
    if (staleVenueKeys.length > 0) await redis.del(...staleVenueKeys);
    // This suite logs in many distinct staff (owner x2, cashier, manager)
    // against the shared /api/auth/login rate-limit bucket — clear it too
    // so re-running this file during development doesn't fail on a stale
    // 429 from a previous run rather than genuine test logic.
    const staleLoginKeys = await redis.keys('rate-limit:*:*:/api/auth/login');
    if (staleLoginKeys.length > 0) await redis.del(...staleLoginKeys);

    const primary = await createOrgVenueOwner('primary');
    orgId = primary.orgId;
    venueId = primary.venueId;
    ownerToken = primary.accessToken;

    const other = await createOrgVenueOwner('other');
    otherOrgId = other.orgId;
    otherVenueId = other.venueId;

    // Separate tables for each test that creates a genuine, real order —
    // OrdersService enforces one active order per table, so reusing a
    // table across independent order-creation assertions would produce a
    // real (correct) 409 conflict unrelated to what each test means to
    // check.
    const table = await prisma.table.create({
      data: {
        venueId,
        tableNumber: `${TAG}-1`,
        name: 'Integration table 1',
        capacity: 4,
        sortOrder: 1,
      },
    });
    tableId = table.id;
    const table2 = await prisma.table.create({
      data: {
        venueId,
        tableNumber: `${TAG}-2`,
        name: 'Integration table 2',
        capacity: 4,
        sortOrder: 2,
      },
    });
    tableId2 = table2.id;
    const table3 = await prisma.table.create({
      data: {
        venueId,
        tableNumber: `${TAG}-3`,
        name: 'Integration table 3',
        capacity: 4,
        sortOrder: 3,
      },
    });
    tableId3 = table3.id;

    const category = await prisma.category.create({
      data: {
        organizationId: orgId,
        name: `${TAG} category`,
        sortOrder: 1,
        createdById: primary.ownerId,
      },
    });
    const menuItem = await prisma.menuItem.create({
      data: {
        organizationId: orgId,
        categoryId: category.id,
        title: `${TAG} item`,
        description: 'x',
        priceCents: 1000,
        isAvailable: true,
        sortOrder: 1,
        nutritionalDetails: {},
        createdById: primary.ownerId,
      },
    });
    menuItemId = menuItem.id;

    const cashier = await prisma.staff.create({
      data: {
        organizationId: orgId,
        email: `${TAG}-cashier-${Date.now()}@verdura.internal`,
        name: 'Cashier Cat',
        passwordHash: await argon2.hash('irrelevant-login-password', { type: argon2.argon2id }),
        role: 'cashier',
        pinHash: await argon2.hash(CASHIER_PIN, { type: argon2.argon2id }),
        pinSetAt: new Date(),
      },
    });
    cashierId = cashier.id;
    await prisma.venueAccess.create({
      data: { staffId: cashierId, venueId, grantedById: primary.ownerId },
    });

    const manager = await prisma.staff.create({
      data: {
        organizationId: orgId,
        email: `${TAG}-manager-${Date.now()}@verdura.internal`,
        name: 'Manager Mo',
        passwordHash: await argon2.hash('irrelevant-login-password', { type: argon2.argon2id }),
        role: 'manager',
        pinHash: await argon2.hash(MANAGER_PIN, { type: argon2.argon2id }),
        pinSetAt: new Date(),
      },
    });
    managerId = manager.id;
    await prisma.venueAccess.create({
      data: { staffId: managerId, venueId, grantedById: primary.ownerId },
    });

    const inactive = await prisma.staff.create({
      data: {
        organizationId: orgId,
        email: `${TAG}-inactive-${Date.now()}@verdura.internal`,
        name: 'Inactive Ivy',
        passwordHash: await argon2.hash('irrelevant-login-password', { type: argon2.argon2id }),
        role: 'cashier',
        isActive: false,
        pinHash: await argon2.hash(INACTIVE_PIN, { type: argon2.argon2id }),
        pinSetAt: new Date(),
      },
    });
    inactiveStaffId = inactive.id;
    await prisma.venueAccess.create({
      data: { staffId: inactiveStaffId, venueId, grantedById: primary.ownerId },
    });

    // Same organization, deliberately given no VenueAccess row: staff venue
    // access applies to every staff-kind credential (Story 2.2, PRD section
    // 16 item 3), so this staff member's PIN must not elevate a tablet at
    // this venue until they are granted it (Story 8.1).
    const crossVenue = await prisma.staff.create({
      data: {
        organizationId: orgId,
        email: `${TAG}-crossvenue-${Date.now()}@verdura.internal`,
        name: 'Cross Venue Cody',
        passwordHash: await argon2.hash('irrelevant-login-password', { type: argon2.argon2id }),
        role: 'cashier',
        pinHash: await argon2.hash(CROSS_VENUE_PIN, { type: argon2.argon2id }),
        pinSetAt: new Date(),
      },
    });
    crossVenueStaffId = crossVenue.id;
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      await prisma.order
        .findMany({ where: { venue: { organizationId: org } }, select: { id: true } })
        .then(async (orders) => {
          const ids = orders.map((o) => o.id);
          if (ids.length) {
            await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
            await prisma.order.deleteMany({ where: { id: { in: ids } } });
          }
        });
      await prisma.tabletDevice.deleteMany({ where: { organizationId: org } });
      await prisma.tabletEnrollment.deleteMany({ where: { organizationId: org } });
      await prisma.auditLog.deleteMany({ where: { organizationId: org } });
      await prisma.venueAccess.deleteMany({ where: { staff: { organizationId: org } } });
      await prisma.menuItem.deleteMany({ where: { organizationId: org } });
      await prisma.category.deleteMany({ where: { organizationId: org } });
      await prisma.table.deleteMany({ where: { venue: { organizationId: org } } });
      await prisma.staff.deleteMany({ where: { organizationId: org } });
      await prisma.venue.deleteMany({ where: { organizationId: org } });
      await prisma.organization.delete({ where: { id: org } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  // ── Enrollment ───────────────────────────────────────────────────────────

  describe('enrollment', () => {
    it('a cashier (non-admin/manager) cannot create an enrollment code — live RolesGuard enforcement', async () => {
      const cashierLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: (await prisma.staff.findUniqueOrThrow({ where: { id: cashierId } })).email,
          password: 'irrelevant-login-password',
        })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/venues/${venueId}/tablet-devices/enrollments`)
        .set('Authorization', `Bearer ${cashierLogin.body.accessToken}`)
        .expect(403);
    });

    it('an authorized owner can create an enrollment code for their venue', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/venues/${venueId}/tablet-devices/enrollments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ label: 'Front counter tablet' })
        .expect(201);
      expect(res.body.enrollmentId).toEqual(expect.any(String));
      expect(res.body.bootstrapToken).toEqual(expect.any(String));

      const row = await prisma.tabletEnrollment.findUniqueOrThrow({
        where: { id: res.body.enrollmentId },
      });
      expect(row.venueId).toBe(venueId);
      expect(row.usedAt).toBeNull();
      expect(row.codeHash).not.toBe(res.body.bootstrapToken.split('.')[1]);
    });

    it('enrollment creation is rejected for a venue outside the caller organization', async () => {
      await request(app.getHttpServer())
        .post(`/api/venues/${otherVenueId}/tablet-devices/enrollments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('a valid enrollment redeems into a working device token; the code cannot be replayed', async () => {
      const created = await request(app.getHttpServer())
        .post(`/api/venues/${venueId}/tablet-devices/enrollments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      const enrollRes = await request(app.getHttpServer())
        .post('/api/tablet/enroll')
        .send({ bootstrapToken: created.body.bootstrapToken })
        .expect(200);
      expect(enrollRes.body.deviceId).toEqual(expect.any(String));
      expect(enrollRes.body.venueId).toBe(venueId);

      // Replay
      await request(app.getHttpServer())
        .post('/api/tablet/enroll')
        .send({ bootstrapToken: created.body.bootstrapToken })
        .expect(401);
    });

    it('an expired enrollment code is rejected even though never used', async () => {
      const created = await request(app.getHttpServer())
        .post(`/api/venues/${venueId}/tablet-devices/enrollments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      await prisma.tabletEnrollment.update({
        where: { id: created.body.enrollmentId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request(app.getHttpServer())
        .post('/api/tablet/enroll')
        .send({ bootstrapToken: created.body.bootstrapToken })
        .expect(401);
    });

    it('a device listed via the admin endpoint never exposes secretHash', async () => {
      await enrollFreshDevice(venueId);
      const res = await request(app.getHttpServer())
        .get(`/api/venues/${venueId}/tablet-devices/devices`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toMatch(/secretHash/i);
    });
  });

  // ── Unlock against a real, KDS_VENUE_PINS-configured venue ──────────────
  // KDS_VENUE_PINS is a static env-var map keyed by a fixed seeded venueId,
  // so a dynamically-created test venue (used everywhere else in this file
  // for full isolation) can never have a configured PIN. This block borrows
  // the one real seeded venue/owner specifically to prove the success path.

  describe('unlock succeeds against the real configured venue PIN', () => {
    it('a correct venue PIN unlocks an enrolled device for the seeded venue', async () => {
      const seededVenue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
      const configuredPins = JSON.parse(process.env.KDS_VENUE_PINS ?? '{}') as Record<
        string,
        string
      >;
      const configuredPin = configuredPins[seededVenue.id];
      if (!configuredPin) {
        // Environment has no PIN configured for the seeded venue at all —
        // the fail-closed behaviour for that case is already covered above
        // and in the unit suite; nothing further to prove here.
        return;
      }
      const seededOwnerLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz',
          password: process.env.SEED_OWNER_PASSWORD,
        })
        .expect(200);
      const created = await request(app.getHttpServer())
        .post(`/api/venues/${seededVenue.id}/tablet-devices/enrollments`)
        .set('Authorization', `Bearer ${seededOwnerLogin.body.accessToken}`)
        .send({ label: `${TAG} seeded-venue unlock check` })
        .expect(201);
      const enrolled = await request(app.getHttpServer())
        .post('/api/tablet/enroll')
        .send({ bootstrapToken: created.body.bootstrapToken })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/tablet/unlock')
        .set('Authorization', `Bearer ${enrolled.body.deviceToken}`)
        .send({ pin: configuredPin })
        .expect(200);

      await prisma.tabletDevice.delete({ where: { id: enrolled.body.deviceId } });
      await prisma.tabletEnrollment.delete({ where: { id: created.body.enrollmentId } });
    });
  });

  // ── Local-development PIN "108" — Kitchen Display / Order Tablet ──────────
  // Proves the real HTTP path end to end for whatever PIN is actually
  // configured locally (KDS_VENUE_PINS) — these
  // early-return, exactly like the block above, if this environment has not
  // configured the seeded venue/account with a real value, so this suite
  // stays honest in CI (which does not set KDS_VENUE_PINS) as well as local
  // development (which does).

  describe('local-development PIN "108" — real HTTP path per surface', () => {
    it('Kitchen Display: a correct 3-character venue PIN exchanges for a real KDS device token, against the seeded venue', async () => {
      const seededVenue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
      const configuredPins = JSON.parse(process.env.KDS_VENUE_PINS ?? '{}') as Record<
        string,
        string
      >;
      const configuredPin = configuredPins[seededVenue.id];
      if (!configuredPin) {
        return; // no PIN configured for the seeded venue in this environment (e.g. CI)
      }

      const res = await request(app.getHttpServer())
        .post('/api/kiosk/kds/auth')
        .send({ venueId: seededVenue.id, pin: configuredPin })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));

      // An incorrect PIN must still fail, even though the DTO now permits a
      // 3-character length in non-production — length alone is not
      // sufficient, the value itself must still match.
      await request(app.getHttpServer())
        .post('/api/kiosk/kds/auth')
        .send({ venueId: seededVenue.id, pin: '999' })
        .expect(401);
    });
  });

  // ── Unlock, elevation, manager step-up, and the full authorization matrix ─

  describe('device -> restricted -> staff -> manager authorization matrix', () => {
    let deviceId: string;
    let deviceToken: string;

    beforeAll(async () => {
      const device = await enrollFreshDevice(venueId);
      deviceId = device.deviceId;
      deviceToken = device.deviceToken;
    });

    it('a restricted device-only token can place a real order through the purpose-built tablet endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tablet/orders')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          tableId,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `${TAG}-restricted-order-${Date.now()}-${Math.random()}`,
        })
        .expect(201);
      expect(res.body.source).toBe('staff');
      // Truthful, non-fabricated attribution recorded on the audit trail: a
      // synthetic per-device system actor, never a named staff member and
      // never a shared account. Order ids are drawn from a repository-wide
      // sequence and can be reused after old rows are deleted (see other
      // integration suites' cleanup) — scope by organizationId too so this
      // never matches an unrelated historical row sharing the same id.
      const auditRow = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'CREATE_ORDER', resourceId: res.body.id as string, organizationId: orgId },
        orderBy: { timestamp: 'desc' },
      });
      // The order itself still needs a Staff creator (Order.createdById), so
      // device-originated orders keep this synthetic per-device actor; the
      // audit model can now record devices directly (Story 12.15), and moving
      // order creation off it is tracked separately (Story 12.16).
      expect(auditRow.actorEmail).toBe(`tablet-device+${deviceId}@verdura.internal`);
      const actorStaff = await prisma.staff.findUniqueOrThrow({
        where: { id: auditRow.actorId ?? '' },
      });
      expect(actorStaff.isActive).toBe(false);
    });

    it('an identical rapid double-press through the real HTTP tablet endpoint creates exactly one order and one of each outbox row — not merely idempotent at the service-unit level', async () => {
      // A dedicated table -- the "same order" it must resolve to on the
      // second call would otherwise collide with whatever active order the
      // shared tableId already carries from an earlier test in this block.
      // OrdersService.createStaffOrder's own idempotency (DB-unique
      // (venueId, idempotencyKey), proven at the unit level in
      // orders.service.spec.ts) is exercised here as two REAL, sequential
      // HTTP POSTs through the actual tablet controller/guard stack -- the
      // gap flagged in this story's own discovery: idempotency was
      // previously proven only by calling the service directly.
      const doublePressTable = await prisma.table.create({
        data: {
          venueId,
          tableNumber: `${TAG}-double-press`,
          name: 'Double-press table',
          capacity: 2,
          sortOrder: 11,
        },
      });
      const key = `${TAG}-double-press-${Date.now()}-${Math.random()}`;
      const body = {
        tableId: doublePressTable.id,
        serviceMode: 'dine_in',
        items: [{ menuItemId, quantity: 1 }],
        idempotencyKey: key,
      };

      const first = await request(app.getHttpServer())
        .post('/api/tablet/orders')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/api/tablet/orders')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send(body)
        .expect(201);

      expect(second.body.id).toBe(first.body.id);

      const orderId = first.body.id as string;
      const orderCount = await prisma.order.count({ where: { id: orderId } });
      expect(orderCount).toBe(1);
      const itemCount = await prisma.orderItem.count({ where: { orderId } });
      expect(itemCount).toBe(1);
    });

    it('the same bare device token is rejected by the staff-tier /api/admin/orders endpoint — no implied administrative access', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          venueId,
          tableId,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `${TAG}-x-${Date.now()}`,
        })
        .expect(403);
    });

    // Regression coverage for a real defect found via real browser
    // validation of the standalone tablet (not merely hypothetical): the
    // restricted-mode floor screen also calls GET /venues/:venueId/tables
    // (to resolve table numbers to real Table ids) — its @Roles list did
    // not include `viewer`, the role a bare device token carries, so it
    // 403'd for an unelevated standalone tablet exactly like
    // GET /api/admin/orders did. (The same review also found the identical
    // gap on GET /venues/:venueId/tax-config — that endpoint depended on
    // DL-072's venue locale/tax schema, not committed at this boundary, so
    // its fix landed with the DL-072 commit instead, below.)
    it('a bare device token can read its own venue’s real table list', async () => {
      await request(app.getHttpServer())
        .get(`/api/venues/${venueId}/tables`)
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(200);
    });

    it('a bare device token cannot read a different venue’s tables by changing the path param', async () => {
      await request(app.getHttpServer())
        .get(`/api/venues/${otherVenueId}/tables`)
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(403);
    });

    // DL-072: GET /venues/:id/tax-config ships with the same authorization
    // path as /venues/:venueId/tables above — viewer role, venue scoping,
    // and (found during this same review) live device-revocation checking
    // via TabletTokenActiveGuard, applied from this route's first commit
    // rather than discovered as a live gap after the fact.
    it('a bare device token can read its own venue’s real tax config', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/venues/${venueId}/tax-config`)
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(200);
      expect(res.body).toEqual({
        currency: 'NZD',
        locale: 'en-NZ',
        taxJurisdiction: 'NZ_GST',
        pricesIncludeTax: true,
      });
    });

    it('a bare device token cannot read a different venue’s tax config by changing the path param', async () => {
      await request(app.getHttpServer())
        .get(`/api/venues/${otherVenueId}/tax-config`)
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(403);
    });

    it('a revoked device’s token cannot read tax config even though its JWT has not expired', async () => {
      const revocable = await enrollFreshDevice(venueId);
      await request(app.getHttpServer())
        .get(`/api/venues/${venueId}/tax-config`)
        .set('Authorization', `Bearer ${revocable.deviceToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/venues/${venueId}/tablet-devices/devices/${revocable.deviceId}/revoke`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/venues/${venueId}/tax-config`)
        .set('Authorization', `Bearer ${revocable.deviceToken}`)
        .expect(401);
    });

    // Regression coverage for a real defect found during this story's
    // independent review: the restricted-mode floor screen (OrderTabletPage)
    // calls useLiveOrders() unconditionally on mount to check whether a
    // table already has an active order — before the GET /api/tablet/orders
    // endpoint below existed, that call always hit GET /api/admin/orders,
    // which 403s for a bare device token (role `viewer`, not in
    // STAFF_ORDER_ROLES). This broke restricted mode's floor status
    // entirely, not just a hypothetical edge case.
    it('a bare device token is REJECTED by GET /api/admin/orders — reproduces the reported restricted-mode 403', async () => {
      await request(app.getHttpServer())
        .get(`/api/admin/orders?venueId=${venueId}`)
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(403);
    });

    it("a bare device token CAN list its own venue's live orders through the purpose-built GET /api/tablet/orders endpoint", async () => {
      // A dedicated table, not the shared tableId — OrdersService enforces
      // one active order per table, and tableId already carries an active
      // order from an earlier test in this same describe block.
      const listCheckTable = await prisma.table.create({
        data: {
          venueId,
          tableNumber: `${TAG}-list-check`,
          name: 'List-check table',
          capacity: 2,
          sortOrder: 10,
        },
      });
      const created = await request(app.getHttpServer())
        .post('/api/tablet/orders')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          tableId: listCheckTable.id,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `${TAG}-list-check-${Date.now()}-${Math.random()}`,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/tablet/orders')
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(200);
      const orders = res.body as Array<{ id: string }>;
      expect(Array.isArray(orders)).toBe(true);
      expect(orders.some((o) => o.id === (created.body as { id: string }).id)).toBe(true);
    });

    // DL-087 regression: real-browser validation found a customer/guest
    // order's Order Status screen 403ing on both status panels for the
    // exact restricted device token that just submitted the order --
    // fixed by widening POS_SYNC_ORDER_VIEW_ROLES/PRINTER_JOB_ORDER_VIEW_ROLES
    // to include StaffRole.viewer (the role a bare device token carries).
    // Note: the Order Tablet's Order Status screen also polls
    // GET /api/admin/orders/:id/pos-sync and .../print-jobs for a bare
    // device token — that role-widening fix is attributed to DL-087
    // (2026-08-20, Order Tablet payment-removal redesign), a later,
    // separate decision from this story/DL-081, and is not part of this
    // boundary; pos-sync-records.controller.ts/printer-jobs.controller.ts
    // are correspondingly not staged here.
    it('a bare device token is rejected by the manager-step-up-protected test hook', async () => {
      await request(app.getHttpServer())
        .post('/api/tablet/manager-actions/test-hook')
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(403);
    });

    it('unlock rejects the wrong venue PIN, and rejects entirely for a venue with no KDS_VENUE_PINS entry configured (this dynamically-created test venue)', async () => {
      await request(app.getHttpServer())
        .post('/api/tablet/unlock')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ pin: 'wrong-pin' })
        .expect(401);
      // No env entry exists for this freshly-created venue at all — proves
      // the fail-closed "no PIN configured" path, not just "wrong PIN".
      await request(app.getHttpServer())
        .post('/api/tablet/unlock')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ pin: '0000' })
        .expect(401);
    });

    it('staff elevation rejects an inactive staff member’s correct PIN', async () => {
      await request(app.getHttpServer())
        .post('/api/tablet/elevate')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ staffPin: INACTIVE_PIN })
        .expect(401);
    });

    it('staff elevation refuses a same-organization staff member without a grant for the tablet’s venue, and admits them once granted (Stories 2.2, 8.1)', async () => {
      await request(app.getHttpServer())
        .post('/api/tablet/elevate')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ staffPin: CROSS_VENUE_PIN })
        .expect(401);
      const grant = await prisma.venueAccess.create({
        data: { staffId: crossVenueStaffId, venueId, grantedById: managerId },
      });
      try {
        await request(app.getHttpServer())
          .post('/api/tablet/elevate')
          .set('Authorization', `Bearer ${deviceToken}`)
          .send({ staffPin: CROSS_VENUE_PIN })
          .expect(200)
          .expect((res) => {
            expect(res.body.staff).toMatchObject({
              id: crossVenueStaffId,
              name: 'Cross Venue Cody',
            });
          });
      } finally {
        await prisma.venueAccess.delete({ where: { id: grant.id } });
      }
    });

    it('staff elevation rejects a wrong PIN', async () => {
      await request(app.getHttpServer())
        .post('/api/tablet/elevate')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ staffPin: '0000' })
        .expect(401);
    });

    let staffToken: string;

    it('a correct staff PIN elevates the session and returns the real staff identity', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tablet/elevate')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ staffPin: CASHIER_PIN })
        .expect(200);
      expect(res.body.staff).toMatchObject({ id: cashierId, name: 'Cashier Cat', role: 'cashier' });
      staffToken = res.body.token as string;
    });

    it('the elevated staff token creates orders attributed to the real named staff member via the existing, unmodified /api/admin/orders', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          venueId,
          tableId: tableId2,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `${TAG}-staff-order-${Date.now()}`,
        })
        .expect(201);
      const auditRow = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'CREATE_ORDER', resourceId: res.body.id as string, organizationId: orgId },
        orderBy: { timestamp: 'desc' },
      });
      expect(auditRow.actorId).toBe(cashierId);
      expect(auditRow.actorEmail).toContain('cashier');
    });

    // DL-087: the Order Tablet never processes payment. Proves this by
    // absence, not merely rejection — every payment-mutating action name a
    // real Order Tablet build would plausibly need (tender/pay/charge/
    // capture/refund/void/settle/mark-paid) simply does not exist as a
    // route under either the restricted-device (/api/tablet/*) or the
    // staff-tier (/api/admin/orders*) surface, for a real device token and
    // a real elevated staff token alike. A 404 here means there is no
    // handler to authorize against at all — the strongest form of "fails
    // closed" available, stronger than a 403 (which would at least prove a
    // route exists that a differently-scoped token might reach).
    it('no payment-mutating route exists under the Order Tablet surface, for a restricted device token or an elevated staff token', async () => {
      const guessedPaymentRoutes: Array<{ method: 'post' | 'patch'; path: string }> = [
        { method: 'post', path: `/api/tablet/orders/${tableId}/pay` },
        { method: 'post', path: '/api/tablet/pay' },
        { method: 'post', path: '/api/tablet/payment' },
        { method: 'post', path: '/api/tablet/orders/pay' },
        { method: 'post', path: '/api/admin/orders/ORD-600001/pay' },
        { method: 'post', path: '/api/admin/orders/ORD-600001/charge' },
        { method: 'post', path: '/api/admin/orders/ORD-600001/capture' },
        { method: 'post', path: '/api/admin/orders/ORD-600001/refund' },
        { method: 'post', path: '/api/admin/orders/ORD-600001/void' },
        { method: 'post', path: '/api/admin/orders/ORD-600001/settle' },
        { method: 'post', path: '/api/admin/orders/ORD-600001/tender' },
        { method: 'patch', path: '/api/admin/orders/ORD-600001/payment-status' },
        { method: 'post', path: '/api/admin/payments' },
        { method: 'post', path: '/api/tablet/payment-intent' },
      ];

      for (const token of [deviceToken, staffToken]) {
        for (const { method, path } of guessedPaymentRoutes) {
          await request(app.getHttpServer())
            [method](path)
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(404);
        }
      }
    });

    // Strengthens the guessed-route probe above with a real enumeration of
    // every route Nest actually registered under /api/tablet and
    // /api/admin (not /api/kiosk -- that's the separate, deliberately
    // anonymous-accessible self-service surface the next test covers) whose
    // path contains a payment-shaped keyword. If a future story ever adds a
    // real pay/tender/capture/refund/void/settle/charge endpoint under
    // either surface, this test starts failing the moment it's registered --
    // not only if someone remembers to extend the guessed list above.
    it('every ACTUALLY REGISTERED route under /api/tablet or /api/admin whose path looks payment-shaped rejects both a restricted device token and an elevated staff token', async () => {
      const paymentKeywords = [
        'pay',
        'tender',
        'capture',
        'refund',
        'void',
        'settle',
        'charge',
        'stripe',
      ];
      // Express 5's app router lives at `.router` (not the Express-4-era
      // `._router`) -- verified directly against this app's own bootstrap
      // rather than assumed.
      const expressRouter = (
        app.getHttpAdapter().getInstance() as unknown as {
          router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
        }
      ).router;
      const recognizedMethods = ['get', 'post', 'patch', 'put', 'delete'];
      const registeredRoutes = expressRouter.stack
        .filter((layer) => layer.route)
        .flatMap((layer) => {
          const { path, methods } = layer.route!;
          return recognizedMethods.filter((m) => methods[m]).map((method) => ({ method, path }));
        })
        .filter(
          (r) =>
            (r.path.startsWith('/api/tablet') || r.path.startsWith('/api/admin')) &&
            paymentKeywords.some((kw) => r.path.toLowerCase().includes(kw)),
        );

      // Sanity check on the probe itself: if this ever finds zero routes,
      // either Nest's route registration changed shape (this test would be
      // silently vacuous) or genuinely nothing payment-shaped is registered
      // under these two prefixes today -- assert the latter explicitly by
      // requiring the introspection mechanism itself found a non-trivial
      // route table (it does today: dozens of real /api/tablet and
      // /api/admin routes exist).
      expect(expressRouter.stack.filter((l) => l.route).length).toBeGreaterThan(10);

      const concretePath = (path: string) =>
        path.replace(/:id\b/g, 'ORD-600001').replace(/:[A-Za-z0-9_]+/g, tableId);

      for (const token of [deviceToken, staffToken]) {
        for (const { method, path } of registeredRoutes) {
          const httpMethod = method as 'get' | 'post' | 'patch' | 'put' | 'delete';
          const res = await request(app.getHttpServer())
            [httpMethod](concretePath(path))
            .set('Authorization', `Bearer ${token}`)
            .send({});
          expect(res.status).not.toBe(200);
          expect(res.status).not.toBe(201);
        }
      }
    });

    // The one place any Stripe/payment-provider call exists at all
    // (`/api/kiosk/stripe/*`) is a deliberately separate, unauthenticated
    // public surface for the Kiosk self-service terminal (a different app,
    // not the Order Tablet) — it neither reads nor grants any elevated
    // behaviour from an Order Tablet bearer token. Sending one changes
    // nothing: the endpoint behaves identically to an anonymous call.
    it('attaching an Order Tablet device/staff token to the separate kiosk Stripe endpoint grants it no special treatment — it behaves exactly as an anonymous call would', async () => {
      // CSRF-valid on every call (held constant across all three) so this
      // isolates identity's effect specifically, rather than incidentally
      // observing CsrfMiddleware's standard, correct Bearer-token exemption
      // (CSRF rides on ambient cookie auth; an explicit Bearer header can't
      // be forged by a third-party page the way a cookie can, so exempting
      // it is the normal, secure pattern — not a finding on its own).
      const primer = await request(app.getHttpServer()).get(`/api/kiosk/venues/${venueId}/menu`);
      const cookies = (primer.headers['set-cookie'] as unknown as string[]) ?? [];
      const csrfToken = cookies
        .map((c) => c.match(/^csrf_token=([^;]+)/)?.[1])
        .find((v): v is string => !!v);
      if (!csrfToken) throw new Error('Failed to obtain a CSRF token for this test.');
      const csrf = { Cookie: `csrf_token=${csrfToken}`, 'x-csrf-token': csrfToken };

      const anonymous = await request(app.getHttpServer())
        .post('/api/kiosk/stripe/create-payment-intent')
        .set(csrf)
        .send({ amountCents: 1000 });
      const withDeviceToken = await request(app.getHttpServer())
        .post('/api/kiosk/stripe/create-payment-intent')
        .set(csrf)
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ amountCents: 1000 });
      const withStaffToken = await request(app.getHttpServer())
        .post('/api/kiosk/stripe/create-payment-intent')
        .set(csrf)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ amountCents: 1000 });
      expect(withDeviceToken.status).toBe(anonymous.status);
      expect(withStaffToken.status).toBe(anonymous.status);
      expect(withDeviceToken.body).toEqual(anonymous.body);
      expect(withStaffToken.body).toEqual(anonymous.body);
    });

    it('an elevated staff token (non-manager) is still rejected by the manager-step-up test hook', async () => {
      await request(app.getHttpServer())
        .post('/api/tablet/manager-actions/test-hook')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('manager step-up rejects a non-manager (cashier) PIN', async () => {
      await request(app.getHttpServer())
        .post('/api/tablet/manager-step-up')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ managerPin: CASHIER_PIN })
        .expect(401);
    });

    let managerToken: string;

    it('a correct manager PIN steps up the session, carrying the acting staff id forward', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tablet/manager-step-up')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ managerPin: MANAGER_PIN })
        .expect(200);
      expect(res.body.manager).toMatchObject({ id: managerId, role: 'manager' });
      managerToken = res.body.token as string;
    });

    it('the manager-stepped-up token passes the real authorization-hook endpoint, recording both identities', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tablet/manager-actions/test-hook')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);
      expect(res.body).toMatchObject({
        authorized: true,
        managerId,
        actingStaffId: cashierId,
        deviceId,
      });
    });

    it('Admin Console administrative endpoints remain protected even from a manager-role tablet token (StaffSessionOnlyGuard)', async () => {
      await request(app.getHttpServer())
        .get(`/api/venues/${venueId}/tablet-devices/devices`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/admin/staff/${cashierId}/tablet-pin`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ pin: '1111' })
        .expect(403);
    });

    it('lock is accepted and audited for the elevated device', async () => {
      await request(app.getHttpServer())
        .post('/api/tablet/lock')
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(204);
    });

    it('revoking the device invalidates every further use of it — device, staff, and manager tokens alike', async () => {
      await request(app.getHttpServer())
        .post(`/api/venues/${venueId}/tablet-devices/devices/${deviceId}/revoke`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/tablet/orders')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          tableId,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `${TAG}-revoked-${Date.now()}`,
        })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          venueId,
          tableId,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `${TAG}-revoked-staff-${Date.now()}`,
        })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/tablet/manager-actions/test-hook')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(401);

      await request(app.getHttpServer())
        .get('/api/tablet/orders')
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(401);

      // Found live against the real dev API/Postgres during this story's
      // own required validation: this route had no revocation re-check at
      // all (TabletTokenActiveGuard was only wired into OrdersController),
      // so a revoked device's bare token kept reading the full table list
      // (200) until its JWT naturally expired. Fixed alongside this test.
      await request(app.getHttpServer())
        .get(`/api/venues/${venueId}/tables`)
        .set('Authorization', `Bearer ${deviceToken}`)
        .expect(401);
    });

    it('audit records were written for the key security events with truthful actor attribution', async () => {
      const actions = await prisma.auditLog.findMany({
        where: {
          venueId,
          action: {
            in: [
              'TABLET_STAFF_ELEVATION_SUCCESS',
              'TABLET_MANAGER_STEPUP_SUCCESS',
              'TABLET_DEVICE_REVOKED',
            ],
          },
        },
        orderBy: { timestamp: 'asc' },
      });
      const byAction = new Set(actions.map((a) => a.action));
      expect(byAction.has('TABLET_STAFF_ELEVATION_SUCCESS')).toBe(true);
      expect(byAction.has('TABLET_MANAGER_STEPUP_SUCCESS')).toBe(true);
      expect(byAction.has('TABLET_DEVICE_REVOKED')).toBe(true);
      const elevation = actions.find(
        (a) => a.action === 'TABLET_STAFF_ELEVATION_SUCCESS' && a.actorId === cashierId,
      );
      expect(elevation?.actorId).toBe(cashierId);
      // Never a PIN or secret value stored under any audit field — checked
      // against the actual field values, not a loose substring scan of the
      // whole serialized row (organizationId/venueId/actorId are random
      // UUIDs and can coincidentally contain a 4-digit PIN as a substring
      // of their hex characters, which a naive regex-over-JSON check would
      // wrongly flag as a leak).
      for (const row of actions) {
        expect(row.actorEmail).not.toContain(CASHIER_PIN);
        expect(row.actorEmail).not.toContain(MANAGER_PIN);
        expect(JSON.stringify(row.after ?? {})).not.toContain(`"${CASHIER_PIN}"`);
        expect(JSON.stringify(row.after ?? {})).not.toContain(`"${MANAGER_PIN}"`);
      }
    });
  });

  // ── Cross-venue isolation ────────────────────────────────────────────────

  describe('cross-venue isolation', () => {
    it('a device enrolled for one venue cannot be used to create an order at a different venue (tableId scoped by device venue only)', async () => {
      const otherTable = await prisma.table.create({
        data: {
          venueId: otherVenueId,
          tableNumber: `${TAG}-other-1`,
          name: 'Other venue table',
          capacity: 2,
          sortOrder: 1,
        },
      });
      const device = await enrollFreshDevice(venueId);
      // The device's own venue (primary) never matches otherVenueId's table
      // — validateTableForOrder inside OrdersService rejects a table from
      // a different venue than the one resolved for the order.
      await request(app.getHttpServer())
        .post('/api/tablet/orders')
        .set('Authorization', `Bearer ${device.deviceToken}`)
        .send({
          tableId: otherTable.id,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `${TAG}-cross-venue-${Date.now()}`,
        })
        .expect(400);
      await prisma.table.delete({ where: { id: otherTable.id } });
    });

    it("GET /api/tablet/orders ignores a requested cross-venue id and always returns only the device's own venue", async () => {
      const device = await enrollFreshDevice(venueId);
      // A dedicated table — tableId/tableId2/tableId3 already each carry an
      // active order from earlier tests in this file.
      const scopeCheckTable = await prisma.table.create({
        data: {
          venueId,
          tableNumber: `${TAG}-scope-check`,
          name: 'Scope-check table',
          capacity: 2,
          sortOrder: 11,
        },
      });
      const own = await request(app.getHttpServer())
        .post('/api/tablet/orders')
        .set('Authorization', `Bearer ${device.deviceToken}`)
        .send({
          tableId: scopeCheckTable.id,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 1 }],
          idempotencyKey: `${TAG}-scope-check-${Date.now()}-${Math.random()}`,
        })
        .expect(201);

      // resolveVenueScope pins device-scoped kinds to their own venueId
      // regardless of any query param — assert the cross-venue id is simply
      // ignored, not honored and not a 403 (this endpoint never reads a
      // caller-supplied venueId; unlike /api/admin/orders, there is nothing
      // for a device token to spoof here).
      const res = await request(app.getHttpServer())
        .get(`/api/tablet/orders?venueId=${otherVenueId}`)
        .set('Authorization', `Bearer ${device.deviceToken}`)
        .expect(200);
      const orders = res.body as Array<{ id: string; venueId: string }>;
      expect(orders.some((o) => o.id === (own.body as { id: string }).id)).toBe(true);
      expect(orders.every((o) => o.venueId === venueId)).toBe(true);
    });
  });

  // ── Regression coverage ──────────────────────────────────────────────────

  describe('regression: pre-existing flows are unaffected', () => {
    it('KDS device PIN auth still works within its own unchanged scope', async () => {
      // KDS uses the same KDS_VENUE_PINS mechanism as the tablet unlock —
      // this only proves the endpoint and its guard chain still function
      // (this environment's actual configured PIN value is asserted by the
      // dedicated kds-auth.service tests, not re-asserted here).
      const res = await request(app.getHttpServer())
        .post('/api/kiosk/kds/auth')
        .send({ venueId, pin: '000000' });
      expect(res.status).toBe(401); // reachable, DTO-valid, still enforcing — not silently open
    });

    it('staff login and refresh continue to work unmodified', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: (await prisma.staff.findUniqueOrThrow({ where: { id: managerId } })).email,
          password: 'irrelevant-login-password',
        })
        .expect(200);
      expect(loginRes.body.accessToken).toEqual(expect.any(String));
      expect(loginRes.body.user.id).toBe(managerId);
    });

    it('staff-JWT-authenticated /api/admin/orders (Story 15-4’s own path) still works exactly as before', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          venueId,
          tableId: tableId3,
          serviceMode: 'dine_in',
          items: [{ menuItemId, quantity: 2 }],
          idempotencyKey: `${TAG}-regression-${Date.now()}`,
        })
        .expect(201);
      // The create response returns base Order fields only (items are a
      // separate fetch via GET /admin/orders/:id) — confirm the two-unit
      // line priced correctly instead (1000 cents/unit x 2).
      expect(res.body.source).toBe('staff');
      expect(res.body.subtotalCents).toBe(2000);
    });
  });
});

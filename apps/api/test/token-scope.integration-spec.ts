// Integration test against a REAL local Postgres and Redis — no mocking.
// Story 2.9 (SEC-16.1): a tablet elevated by an owner's PIN carries the
// owner's role, which RolesGuard lets through everywhere. It must still be
// refused on administration routes, keep working on the routes made for
// tablets, and lose those too once its device is revoked.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const TAG = `story29-${Date.now()}`;

describe('Token scope (integration, real Postgres and Redis)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let venueId: string;
  let deviceId: string;
  let enrollmentId: string;
  let elevatedOwnerToken: string;
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

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

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    venueId = venue.id;
    const owner = await prisma.staff.findFirstOrThrow({
      where: { email: process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz' },
    });
    const enrollment = await prisma.tabletEnrollment.create({
      data: {
        organizationId: venue.organizationId,
        venueId,
        codeHash: 'not-a-real-code',
        createdByStaffId: owner.id,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });
    enrollmentId = enrollment.id;
    const device = await prisma.tabletDevice.create({
      data: {
        organizationId: venue.organizationId,
        venueId,
        enrollmentId,
        label: `${TAG} tablet`,
        secretHash: 'not-a-real-secret',
      },
    });
    deviceId = device.id;
    // The token TabletAuthService.signManagerToken issues after an owner's
    // manager PIN on this tablet.
    elevatedOwnerToken = app.get(JwtService).sign(
      {
        sub: owner.id,
        email: owner.email,
        role: owner.role,
        organizationId: owner.organizationId,
        venueId,
        kind: 'tablet_manager',
        deviceId,
      },
      { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '5m' },
    );
  });

  afterAll(async () => {
    await prisma.tabletDevice.delete({ where: { id: deviceId } });
    await prisma.tabletEnrollment.delete({ where: { id: enrollmentId } });
    await app.close();
  });

  it('refuses administration to a PIN-elevated tablet, even with an owner’s role', async () => {
    const attempts = [
      () => http().get('/api/admin/menu/categories'),
      () => http().post('/api/admin/menu/items').send({}),
      () => http().post('/api/admin/media-assets/request-upload').send({}),
      () => http().get('/api/admin/reservations'),
      () => http().post(`/api/venues/${venueId}/connector/enrollments`).send({}),
      () => http().get('/api/venues'),
      () => http().patch(`/api/venues/${venueId}`).send({ name: 'Taken over' }),
      () => http().delete(`/api/venues/${venueId}`),
      () => http().post(`/api/venues/${venueId}/tables`).send({}),
      () => http().get('/api/admin/staff'),
    ];
    for (const attempt of attempts) {
      const res = await attempt().set(as(elevatedOwnerToken));
      expect({ status: res.status, message: res.body.message }).toEqual({
        status: 403,
        message: 'This action requires a genuine staff login session',
      });
    }
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: venueId } });
    expect(venue.name).not.toBe('Taken over');
  });

  it('keeps the routes made for tablets, and loses them when the device is revoked', async () => {
    await http().get(`/api/venues/${venueId}/tables`).set(as(elevatedOwnerToken)).expect(200);
    await http().get(`/api/venues/${venueId}/tax-config`).set(as(elevatedOwnerToken)).expect(200);
    await http().get('/api/admin/orders').set(as(elevatedOwnerToken)).expect(200);

    await prisma.tabletDevice.update({
      where: { id: deviceId },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    await http().get(`/api/venues/${venueId}/tables`).set(as(elevatedOwnerToken)).expect(401);
    await http().get('/api/admin/orders').set(as(elevatedOwnerToken)).expect(401);
  });
});

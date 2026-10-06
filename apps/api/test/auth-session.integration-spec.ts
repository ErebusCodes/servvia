// Integration test against a REAL local Postgres and Redis — no mocking.
// Story 2.5 (token revocation and active-staff re-checks), through the real
// HTTP surface: logout revokes the session for its access and refresh
// tokens, and deactivating a staff member ends their tokens.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffSessionService } from '../src/auth/staff-session.service';

const PASSWORD = 'story-2-5-integration-password';
const ENDED = 'Session expired or account deactivated';

describe('Staff sessions: logout and deactivation (integration, real Postgres and Redis)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffId: string;
  let email: string;

  async function startApp(): Promise<INestApplication> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const started = moduleFixture.createNestApplication();
    started.setGlobalPrefix('api');
    started.use(cookieParser());
    started.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await started.init();
    return started;
  }

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    email = `story-2-5-${Date.now()}@integration.test`;
    const staff = await prisma.staff.create({
      data: {
        organizationId: venue.organizationId,
        email,
        name: 'Story 2.5 Manager',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        role: StaffRole.manager,
      },
    });
    staffId = staff.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: staffId } });
    await prisma.staff.delete({ where: { id: staffId } });
    await app.close();
    await prisma.$disconnect();
  });

  async function login(): Promise<{ accessToken: string; refreshCookie: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const refresh = setCookie.find((c) => c.startsWith('refresh_token='));
    if (!refresh) throw new Error('login set no refresh cookie');
    // The cookie is scoped to /api/auth so the browser sends it to logout too.
    expect(refresh).toContain('Path=/api/auth;');
    return { accessToken: res.body.accessToken as string, refreshCookie: refresh.split(';')[0] };
  }

  const protectedRoute = (accessToken: string) =>
    request(app.getHttpServer())
      .get('/api/admin/staff')
      .set('Authorization', `Bearer ${accessToken}`);

  const refresh = (refreshCookie: string) =>
    request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', refreshCookie);

  it('logout revokes the session: its access and refresh tokens are refused', async () => {
    const session = await login();
    const other = await login();
    await protectedRoute(session.accessToken).expect(200);
    const refreshed = await refresh(session.refreshCookie).expect(200);
    const refreshedAccess = refreshed.body.accessToken as string;
    await protectedRoute(refreshedAccess).expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', session.refreshCookie)
      .expect(204);

    for (const token of [session.accessToken, refreshedAccess]) {
      const res = await protectedRoute(token).expect(401);
      expect(res.body.message).toBe(ENDED);
    }
    await refresh(session.refreshCookie).expect(401);
    // Another login session of the same staff member is unaffected.
    await protectedRoute(other.accessToken).expect(200);
    await refresh(other.refreshCookie).expect(200);
  });

  it('logout with only the access token revokes its session', async () => {
    const session = await login();
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(204);
    await protectedRoute(session.accessToken).expect(401);
    await refresh(session.refreshCookie).expect(401);
  });

  it('deactivation ends every token of the staff member at once', async () => {
    const session = await login();
    await protectedRoute(session.accessToken).expect(200);
    await prisma.staff.update({ where: { id: staffId }, data: { isActive: false } });
    try {
      const res = await protectedRoute(session.accessToken).expect(401);
      expect(res.body.message).toBe(ENDED);
      await refresh(session.refreshCookie).expect(401);
    } finally {
      await prisma.staff.update({ where: { id: staffId }, data: { isActive: true } });
    }
    // Reactivation does not resurrect anything that was revoked; this
    // session was never logged out, so it works again.
    await protectedRoute(session.accessToken).expect(200);
  });

  describe('Story 2.8: the session row is the source of truth', () => {
    const sidOf = (accessToken: string): string =>
      (
        JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()) as {
          sid: string;
        }
      ).sid;

    it('login records a live session; logout revokes it, idempotently', async () => {
      const session = await login();
      const sid = sidOf(session.accessToken);
      expect(await prisma.staffSession.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({
        staffId,
        revokedAt: null,
      });
      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer())
          .post('/api/auth/logout')
          .set('Cookie', session.refreshCookie)
          .expect(204);
      }
      const row = await prisma.staffSession.findUniqueOrThrow({ where: { id: sid } });
      expect(row.revokedReason).toBe('logout');
      expect(row.revokedAt).not.toBeNull();
    });

    it('a restarted API still refuses a logged-out session (no in-memory or cache state)', async () => {
      const session = await login();
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', session.refreshCookie)
        .expect(204);
      await app.close();
      app = await startApp();
      prisma = app.get(PrismaService);
      await protectedRoute(session.accessToken).expect(401);
      await refresh(session.refreshCookie).expect(401);
    });

    it('an expired session is refused even before its tokens expire', async () => {
      const session = await login();
      await prisma.staffSession.update({
        where: { id: sidOf(session.accessToken) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await protectedRoute(session.accessToken).expect(401);
      await refresh(session.refreshCookie).expect(401);
    });

    it('a token minted before a role change is refused', async () => {
      const session = await login();
      await prisma.staff.update({ where: { id: staffId }, data: { role: StaffRole.cashier } });
      try {
        await protectedRoute(session.accessToken).expect(401);
      } finally {
        await prisma.staff.update({ where: { id: staffId }, data: { role: StaffRole.manager } });
      }
    });

    it('expired sessions are deleted after the retention margin, live ones kept', async () => {
      const live = await login();
      const old = await prisma.staffSession.create({
        data: { staffId, expiresAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) },
      });
      const deleted = await app.get(StaffSessionService).deleteExpired();
      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(await prisma.staffSession.findUnique({ where: { id: old.id } })).toBeNull();
      expect(
        await prisma.staffSession.findUnique({ where: { id: sidOf(live.accessToken) } }),
      ).not.toBeNull();
    });
  });
});

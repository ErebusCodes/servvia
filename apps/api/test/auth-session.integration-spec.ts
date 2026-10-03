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

const PASSWORD = 'story-2-5-integration-password';
const ENDED = 'Session expired or account deactivated';

describe('Staff sessions: logout and deactivation (integration, real Postgres and Redis)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffId: string;
  let email: string;

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
});

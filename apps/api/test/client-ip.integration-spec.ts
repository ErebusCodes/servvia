// Integration test against a REAL local Postgres and Redis — no mocking.
// Client IP trust boundary: the address a sign-in's audit row, its security
// event and its rate limit name is the one the API can verify, never a
// header a client wrote (config/client-ip.ts). The test client connects over
// loopback, so it stands where the venue's static proxy stands.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureTrustProxy } from '../src/config/client-ip';

const TAG = `client-ip-${Date.now()}`;

describe('Client IP trust boundary (integration, real Postgres and Redis)', () => {
  const apps: INestApplication[] = [];
  let prisma: PrismaService;
  let staffId: string;
  let email: string;
  let redis: Redis;

  async function appWithHops(hops: number) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    configureTrustProxy(
      app.getHttpAdapter().getInstance() as { set?: (n: string, v: unknown) => void },
      hops,
    );
    await app.init();
    apps.push(app);
    return app;
  }

  async function refusedSignInAddress(app: INestApplication, headers: Record<string, string>) {
    const keys = [...(await redis.keys('rate-limit:*')), ...(await redis.keys('login-account:*'))];
    if (keys.length) await redis.del(...keys);
    const since = new Date();
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(headers)
      .send({ email, password: 'not the password' })
      .expect(401);
    for (let i = 0; i < 50; i += 1) {
      const row = await prisma.auditLog.findFirst({
        where: { actorId: staffId, action: 'login_failed', timestamp: { gte: since } },
        orderBy: { timestamp: 'desc' },
      });
      if (row) {
        const buckets = await redis.keys('rate-limit:*/api/auth/login');
        return { audit: row.ipAddress, rateLimitKeys: buckets };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('no audit row');
  }

  beforeAll(async () => {
    const app = await appWithHops(0);
    prisma = app.get(PrismaService);
    redis = new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    email = `${TAG}@example.test`;
    staffId = (
      await prisma.staff.create({
        data: {
          organizationId: venue.organizationId,
          email,
          name: 'Client IP',
          role: 'cashier',
          passwordHash: await argon2.hash(`${TAG} password`, { type: argon2.argon2id }),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: staffId } });
    await prisma.staff.delete({ where: { id: staffId } });
    redis.disconnect();
    for (const app of apps) await app.close();
  });

  const forged = { 'X-Forwarded-For': '203.0.113.9', 'X-Real-IP': '198.51.100.7' };

  it('believes no forwarding header by default: the socket address is the client', async () => {
    const seen = await refusedSignInAddress(apps[0], forged);
    expect(seen.audit).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    expect(seen.rateLimitKeys.join(' ')).not.toMatch(/203\.0\.113\.9|198\.51\.100\.7/);
  });

  it('behind the local proxy (one loopback hop), names the client it forwarded, never X-Real-IP', async () => {
    const app = await appWithHops(1);
    const seen = await refusedSignInAddress(app, forged);
    expect(seen.audit).toBe('203.0.113.9');
    expect(seen.rateLimitKeys.join(' ')).toContain('203.0.113.9');
    const onlyRealIp = await refusedSignInAddress(app, { 'X-Real-IP': '198.51.100.7' });
    expect(onlyRealIp.audit).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });
});

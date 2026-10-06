// Integration test against a REAL local Postgres and Redis — no mocking.
// Story 2.11 (NFR-SEC-1, NFR-AUD): a real installation's first owner comes
// only from the governed bootstrap, which refuses while an active owner
// exists and never knows the password; the development seed refuses a
// production runtime and a production-looking database.
//
// Run with: npm run test:integration --workspace=apps/api
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditLogService } from '../src/audit/audit.service';
import { CredentialSetupService } from '../src/staff/credential-setup.service';
import {
  OWNER_BOOTSTRAP_ACTOR,
  OwnerBootstrapRefused,
  bootstrapFirstOwner,
} from '../src/staff/owner-bootstrap';

const TAG = `story211-${Date.now()}`;
const PASSWORD = 'a long owner password 211';

describe('Governed first-owner bootstrap (integration, real Postgres and Redis)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizations: string[] = [];

  const http = () => request(app.getHttpServer());

  async function resetRateLimits() {
    const redis = new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
    try {
      const keys = await redis.keys('rate-limit:*');
      if (keys.length > 0) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
  }

  async function organizationWithVenues(label: string, venues: number) {
    const org = await prisma.organization.create({
      data: { name: `${TAG} ${label}`, slug: `${TAG}-${label}`, billingEmail: 'b@example.test' },
    });
    organizations.push(org.id);
    const venueIds: string[] = [];
    for (let i = 0; i < venues; i += 1) {
      const venue = await prisma.venue.create({
        data: {
          organizationId: org.id,
          name: `${TAG} ${label} ${i}`,
          slug: `${TAG}-${label}-${i}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      });
      venueIds.push(venue.id);
    }
    return { slug: org.slug, id: org.id, venueIds };
  }

  const bootstrap = (organizationSlug: string, email: string, name = 'First Owner') =>
    bootstrapFirstOwner(prisma, app.get(CredentialSetupService), app.get(AuditLogService), {
      organizationSlug,
      email,
      name,
    });

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
  });

  afterAll(async () => {
    for (const organizationId of organizations) {
      const staff = { organizationId };
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await prisma.staffCredentialToken.deleteMany({ where: { staff } });
      await prisma.staffSession.deleteMany({ where: { staff } });
      await prisma.venueAccess.deleteMany({ where: { venue: { organizationId } } });
      await prisma.staff.deleteMany({ where: staff });
      await prisma.venue.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await app.close();
  });

  it('creates the first owner with no usable password, every venue, and an audited single-use code', async () => {
    const org = await organizationWithVenues('first', 2);
    const email = `${TAG}-owner@example.test`;
    const owner = await bootstrap(org.slug, ` ${email.toUpperCase()} `);
    expect(owner.venueIds.sort()).toEqual([...org.venueIds].sort());

    const staff = await prisma.staff.findUniqueOrThrow({
      where: { id: owner.staffId },
      include: { venueAccess: true },
    });
    expect({ role: staff.role, email: staff.email }).toEqual({ role: 'owner', email });
    expect(staff.venueAccess.map((g) => g.venueId).sort()).toEqual([...org.venueIds].sort());

    const token = await prisma.staffCredentialToken.findFirstOrThrow({
      where: { staffId: owner.staffId },
    });
    expect({ by: token.issuedById, system: token.issuedBySystem }).toEqual({
      by: null,
      system: OWNER_BOOTSTRAP_ACTOR,
    });
    const audit = await prisma.auditLog.findMany({ where: { resourceId: owner.staffId } });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'STAFF_CREATED',
      'STAFF_CREDENTIAL_SETUP_ISSUED',
    ]);
    for (const row of audit) {
      expect(row).toMatchObject({ actorType: 'system', systemActor: OWNER_BOOTSTRAP_ACTOR });
    }
    expect(JSON.stringify(audit)).not.toContain(owner.code.split('.')[1]);

    // Nobody knows a password until the owner sets one with the code.
    await resetRateLimits();
    await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    await http()
      .post('/api/auth/credential-setup')
      .send({ code: owner.code, password: PASSWORD })
      .expect(204);
    await resetRateLimits();
    const signedIn = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    await http()
      .get(`/api/venues/${org.venueIds[1]}`)
      .set('Authorization', `Bearer ${signedIn.body.accessToken as string}`)
      .expect(200);
  });

  it('refuses once the organization has an active owner, so it is no way back in', async () => {
    const org = await organizationWithVenues('again', 1);
    await bootstrap(org.slug, `${TAG}-again-1@example.test`);
    await expect(bootstrap(org.slug, `${TAG}-again-2@example.test`)).rejects.toThrow(
      OwnerBootstrapRefused,
    );
    expect(await prisma.staff.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it('creates exactly one owner when two operators run it at once', async () => {
    const org = await organizationWithVenues('race', 1);
    const results = await Promise.allSettled([
      bootstrap(org.slug, `${TAG}-race-a@example.test`),
      bootstrap(org.slug, `${TAG}-race-b@example.test`),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason).toBeInstanceOf(OwnerBootstrapRefused);
    expect(await prisma.staff.count({ where: { organizationId: org.id, role: 'owner' } })).toBe(1);
  });

  it('refuses an unknown organization, an address already in use and a system address', async () => {
    const org = await organizationWithVenues('refusals', 0);
    const seeded = process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz';
    for (const [slug, email] of [
      [`${TAG}-no-such-org`, `${TAG}-x@example.test`],
      [org.slug, seeded],
      [org.slug, 'kiosk@verdura.internal'],
    ]) {
      await expect(bootstrap(slug, email)).rejects.toThrow(OwnerBootstrapRefused);
    }
    expect(await prisma.staff.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('the development seed refuses a production runtime and a production-looking database', () => {
    const apiRoot = join(__dirname, '..');
    const seed = (env: Record<string, string>) =>
      spawnSync(
        process.execPath,
        [require.resolve('ts-node/dist/bin.js'), '-r', 'tsconfig-paths/register', 'prisma/seed.ts'],
        { cwd: apiRoot, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120_000 },
      );
    const production = seed({ NODE_ENV: 'production' });
    expect(production.status).not.toBe(0);
    expect(production.stderr).toContain('Refusing to seed: NODE_ENV is production');

    const productionName = seed({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/verdura_production',
    });
    expect(productionName.status).not.toBe(0);
    expect(productionName.stderr).toContain(
      "the database 'verdura_production' looks like production",
    );
  });
});

// Integration test against a REAL local Postgres and Redis — no mocking.
// Story 12.13 foundation (with Story 12.2's request IDs): security events
// leave the API as JSON lines carrying the request's ID, and no credential,
// token or address the request carried reaches them.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setSecurityEventSink } from '../src/observability/security-events';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD!;

describe('Security events (integration, real Postgres and Redis)', () => {
  let app: INestApplication;
  let lines: string[] = [];
  let restoreSink: (line: string) => void;
  const http = () => request(app.getHttpServer());
  const events = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    restoreSink = setSecurityEventSink((line) => lines.push(line));
  });

  beforeEach(() => {
    lines = [];
  });

  afterAll(async () => {
    setSecurityEventSink(restoreSink);
    await app.close();
  });

  it('logs a refused sign-in with the response’s request ID and none of what was sent', async () => {
    const forgedToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXZhbHVlLWhlcmUtMTIz';
    const res = await http()
      .post('/api/auth/login')
      .set('Authorization', `Bearer ${forgedToken}`)
      .send({ email: 'unknown.person@example.com', password: `pw ${forgedToken}` })
      .expect(401);

    const requestId = res.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(res.headers['x-correlation-id']).toBe(requestId);
    const [event] = events().filter((e) => e.event === 'login_failed_unknown_account');
    expect(event).toMatchObject({ service: 'api', level: 'WARN', request_id: requestId });
    expect(event.account).toMatch(/^[0-9a-f]{32}$/);

    const all = lines.join('\n');
    expect(all).not.toContain('unknown.person');
    expect(all).not.toContain(forgedToken);
    expect(all).not.toContain('pw ');
  });

  it('keeps a safe inbound request ID, and logs a revoked session’s refusal under it', async () => {
    const login = await http()
      .post('/api/auth/login')
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
      .expect(200);
    const token = login.body.accessToken as string;
    await http().post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    lines = [];

    const res = await http()
      .get('/api/admin/staff')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Request-Id', 'proxy-req-7')
      .set('X-Correlation-Id', 'flow-7')
      .expect(401);
    expect(res.headers['x-request-id']).toBe('proxy-req-7');

    const refused = events().find((e) => e.event === 'staff_session_refused');
    expect(refused).toMatchObject({
      request_id: 'proxy-req-7',
      correlation_id: 'flow-7',
      staff_id: login.body.user.id,
      kind: 'staff_session',
    });
    const all = lines.join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain(OWNER_EMAIL);
  });

  it('replaces an unsafe inbound request ID instead of echoing it', async () => {
    const res = await http()
      .get('/api/admin/staff')
      .set('X-Request-Id', 'bad id with spaces')
      .expect(401);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{32}$/);
  });
});

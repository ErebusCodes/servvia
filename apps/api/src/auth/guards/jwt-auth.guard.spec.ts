import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { App } from 'supertest/types';
import { Roles } from '../decorators/roles.decorator';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { StaffService } from '../../staff/staff.service';
import { SessionRevocationService } from '../session-revocation.service';
import { StaffSessionVerifier } from '../staff-session-verifier.service';

const SECRET = 'integration-test-jwt-access-secret-32chars!!';

@Controller('test')
class ProtectedTestController {
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(StaffRole.admin, StaffRole.kitchen)
  @Get('protected')
  protectedRoute() {
    return { ok: true };
  }
}

function sign(payload: Record<string, unknown>, options: jwt.SignOptions = {}): string {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', ...options });
}

const validStaffPayload = {
  sub: 'staff-uuid',
  email: 'owner@verdura.co.nz',
  role: StaffRole.admin,
  organizationId: 'org-uuid',
  sid: 'session-uuid',
};

// The staff row and the session revocation store, as the strategy sees them.
const staffState: { isActive: boolean | null; error?: Error } = { isActive: true };
const revocationState: { revoked: boolean; error?: Error } = { revoked: false };
const fakeStaffService = {
  findById: jest.fn((id: string) => {
    if (staffState.error) return Promise.reject(staffState.error);
    return Promise.resolve(
      staffState.isActive === null ? null : { id, isActive: staffState.isActive },
    );
  }),
};
const fakeRevocations = {
  isRevoked: jest.fn(() =>
    revocationState.error
      ? Promise.reject(revocationState.error)
      : Promise.resolve(revocationState.revoked),
  ),
};

/**
 * Full guard-chain integration test (real Passport strategy + real
 * JwtAuthGuard + real RolesGuard, no mocks) — proves end-to-end that only a
 * genuinely signed, well-formed, unexpired token can reach a protected
 * route, and specifically that the previous hard-coded bypass string
 * ("Bearer kiosk-kds-bypass-token") no longer works now that JwtAuthGuard
 * has no special-case branch at all.
 */
describe('JwtAuthGuard + RolesGuard (integration)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PassportModule],
      controllers: [ProtectedTestController],
      providers: [
        JwtStrategy,
        StaffSessionVerifier,
        JwtAuthGuard,
        RolesGuard,
        { provide: StaffService, useValue: fakeStaffService },
        { provide: SessionRevocationService, useValue: fakeRevocations },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    staffState.isActive = true;
    staffState.error = undefined;
    revocationState.revoked = false;
    revocationState.error = undefined;
  });

  it('rejects a request with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/test/protected').expect(401);
  });

  it('rejects the old hard-coded bypass token', async () => {
    await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', 'Bearer kiosk-kds-bypass-token')
      .expect(401);
  });

  it('rejects a malformed (non-JWT) token', async () => {
    await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = jwt.sign(validStaffPayload, 'a-completely-different-secret', {
      algorithm: 'HS256',
    });
    await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects an expired token', async () => {
    const token = sign(validStaffPayload, { expiresIn: -10 });
    await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a validly-signed token missing organizationId', async () => {
    const { organizationId, ...withoutOrg } = validStaffPayload;
    void organizationId;
    const token = sign(withoutOrg);
    await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('accepts a valid, well-formed staff JWT', async () => {
    const token = sign(validStaffPayload);
    await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true });
  });

  it('accepts a valid KDS device token carrying an allowed role', async () => {
    const token = sign({
      sub: 'kds-device:venue-1',
      email: 'kds-device+venue-1@verdura.internal',
      role: StaffRole.kitchen,
      organizationId: 'org-uuid',
      venueId: 'venue-1',
      kind: 'kds_device',
    });
    await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true });
  });

  it('rejects a valid JWT whose role RolesGuard does not permit', async () => {
    const token = sign({ ...validStaffPayload, role: StaffRole.cashier });
    await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  describe('Story 2.5: deactivated staff and logged-out sessions', () => {
    const ended = {
      statusCode: 401,
      message: 'Session expired or account deactivated',
      error: 'Unauthorized',
    };

    it('refuses a staff token after the staff member is deactivated', async () => {
      staffState.isActive = false;
      await request(app.getHttpServer())
        .get('/test/protected')
        .set('Authorization', `Bearer ${sign(validStaffPayload)}`)
        .expect(401, ended);
    });

    it('refuses a staff token of a deleted or unknown staff member', async () => {
      staffState.isActive = null;
      await request(app.getHttpServer())
        .get('/test/protected')
        .set('Authorization', `Bearer ${sign(validStaffPayload)}`)
        .expect(401, ended);
    });

    it('refuses a staff token after logout revoked its session', async () => {
      revocationState.revoked = true;
      await request(app.getHttpServer())
        .get('/test/protected')
        .set('Authorization', `Bearer ${sign(validStaffPayload)}`)
        .expect(401, ended);
    });

    it('refuses a staff session token without a session id', async () => {
      const { sid, ...withoutSid } = validStaffPayload;
      void sid;
      await request(app.getHttpServer())
        .get('/test/protected')
        .set('Authorization', `Bearer ${sign(withoutSid)}`)
        .expect(401, ended);
    });

    it('fails closed with 500 when the revocation store cannot be reached', async () => {
      revocationState.error = new Error('Command timed out');
      await request(app.getHttpServer())
        .get('/test/protected')
        .set('Authorization', `Bearer ${sign(validStaffPayload)}`)
        .expect(500);
    });

    it('fails closed with 500 when the staff member cannot be looked up', async () => {
      staffState.error = new Error('connection refused');
      await request(app.getHttpServer())
        .get('/test/protected')
        .set('Authorization', `Bearer ${sign(validStaffPayload)}`)
        .expect(500);
    });
  });
});

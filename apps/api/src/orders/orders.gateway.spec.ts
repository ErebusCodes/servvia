import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { IncomingMessage } from 'http';
import {
  OrdersGateway,
  SOCKET_CREDENTIAL_RECHECK_MS,
  allowSocketRequest,
  socketCorsOrigin,
} from './orders.gateway';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  StaffSessionCheckError,
  StaffSessionVerifier,
} from '../auth/staff-session-verifier.service';

const mockAuthService = {
  verifyAccessToken: jest.fn(),
};

const mockPrismaService = {
  venue: {
    findUnique: jest.fn(),
  },
  tabletDevice: {
    findUnique: jest.fn(),
  },
};

const mockStaffSessions = {
  assertLive: jest.fn(),
};

const ENDED = new UnauthorizedException('Session expired or account deactivated');

function mockSocket(
  overrides: {
    auth?: Record<string, unknown>;
    authorizationHeader?: string;
    origin?: string;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (overrides.authorizationHeader) headers.authorization = overrides.authorizationHeader;
  if (overrides.origin) headers.origin = overrides.origin;
  return {
    id: 'socket-1',
    handshake: {
      auth: overrides.auth ?? {},
      headers,
    },
    data: {} as { user?: unknown },
    disconnect: jest.fn(),
    join: jest.fn(),
  };
}

describe('OrdersGateway', () => {
  let gateway: OrdersGateway;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStaffSessions.assertLive.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersGateway,
        { provide: AuthService, useValue: mockAuthService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StaffSessionVerifier, useValue: mockStaffSessions },
      ],
    }).compile();
    gateway = module.get<OrdersGateway>(OrdersGateway);
  });

  describe('handleConnection', () => {
    it('disconnects a socket with no token', async () => {
      const socket = mockSocket();
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(mockAuthService.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('disconnects a socket presenting an invalid/expired token', async () => {
      mockAuthService.verifyAccessToken.mockImplementation(() => {
        throw new UnauthorizedException('Invalid or expired token');
      });
      const socket = mockSocket({ auth: { token: 'bad-token' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a socket presenting the old hard-coded bypass string as a token', async () => {
      mockAuthService.verifyAccessToken.mockImplementation(() => {
        throw new UnauthorizedException('Invalid or expired token');
      });
      const socket = mockSocket({ authorizationHeader: 'Bearer kiosk-kds-bypass-token' });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('accepts a socket with a valid token and stores the decoded user', async () => {
      const payload = { sub: 'staff-1', role: StaffRole.admin, organizationId: 'org-1' };
      mockAuthService.verifyAccessToken.mockReturnValue(payload);
      const socket = mockSocket({ auth: { token: 'good-token' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.user).toEqual(payload);
      gateway.handleDisconnect(socket as never);
    });
  });

  describe('Story 2.6: origins', () => {
    const allowed = (origin?: string) => {
      const callback = jest.fn();
      allowSocketRequest({ headers: origin ? { origin } : {} } as IncomingMessage, callback);
      return callback.mock.calls[0] as [unknown, boolean];
    };

    it('refuses the handshake from an origin outside the CORS allow-list', () => {
      expect(allowed('https://evil.example')).toEqual([null, false]);
      expect(allowed('http://localhost:9999')).toEqual([null, false]);
    });

    it('admits an allow-listed origin and a native client without an Origin', () => {
      expect(allowed('https://admin.verdura.co.nz')).toEqual([null, true]);
      expect(allowed('http://localhost:5177')).toEqual([null, true]);
      expect(allowed(undefined)).toEqual([null, true]);
    });

    it('answers polling CORS with the same allow-list (no wildcard)', () => {
      const callback = jest.fn();
      socketCorsOrigin('https://evil.example', callback);
      socketCorsOrigin('https://admin.verdura.co.nz', callback);
      expect(callback.mock.calls).toEqual([
        [null, false],
        [null, true],
      ]);
    });

    it('disconnects a connection whose origin is not allowed, before reading its token', async () => {
      const socket = mockSocket({ auth: { token: 'good-token' }, origin: 'https://evil.example' });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(mockAuthService.verifyAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('Story 2.6: credential re-checks', () => {
    const staffPayload = {
      sub: 'staff-1',
      role: StaffRole.admin,
      organizationId: 'org-1',
      sid: 'session-1',
    };
    const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

    afterEach(() => {
      jest.useRealTimers();
    });

    it('refuses a logged-out session or deactivated staff at connection', async () => {
      mockAuthService.verifyAccessToken.mockReturnValue({ ...staffPayload, exp: inAnHour() });
      mockStaffSessions.assertLive.mockRejectedValue(ENDED);
      const socket = mockSocket({ auth: { token: 'good-token' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.data.user).toBeUndefined();
    });

    it('fails closed at connection when the credential cannot be checked', async () => {
      mockAuthService.verifyAccessToken.mockReturnValue({ ...staffPayload, exp: inAnHour() });
      mockStaffSessions.assertLive.mockRejectedValue(new StaffSessionCheckError());
      const socket = mockSocket({ auth: { token: 'good-token' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.data.user).toBeUndefined();
    });

    it('refuses a tablet token whose device was revoked', async () => {
      mockAuthService.verifyAccessToken.mockReturnValue({
        sub: 'tablet-device:d-1',
        role: StaffRole.viewer,
        organizationId: 'org-1',
        venueId: 'venue-1',
        kind: 'tablet_device',
        deviceId: 'd-1',
        exp: inAnHour(),
      });
      mockPrismaService.tabletDevice.findUnique.mockResolvedValue({ status: 'revoked' });
      const socket = mockSocket({ auth: { token: 'tablet-token' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects when the access token expires during the connection', async () => {
      jest.useFakeTimers();
      mockAuthService.verifyAccessToken.mockReturnValue({
        ...staffPayload,
        exp: Math.floor(Date.now() / 1000) + 30,
      });
      const socket = mockSocket({ auth: { token: 'good-token' } });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(29_000);
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1_000);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects at the next re-check after logout or deactivation', async () => {
      jest.useFakeTimers();
      mockAuthService.verifyAccessToken.mockReturnValue({ ...staffPayload, exp: inAnHour() });
      const socket = mockSocket({ auth: { token: 'good-token' } });
      await gateway.handleConnection(socket as never);
      await jest.advanceTimersByTimeAsync(SOCKET_CREDENTIAL_RECHECK_MS);
      expect(socket.disconnect).not.toHaveBeenCalled();
      mockStaffSessions.assertLive.mockRejectedValue(ENDED);
      await jest.advanceTimersByTimeAsync(SOCKET_CREDENTIAL_RECHECK_MS);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects at the next re-check when the check cannot be made', async () => {
      jest.useFakeTimers();
      mockAuthService.verifyAccessToken.mockReturnValue({ ...staffPayload, exp: inAnHour() });
      const socket = mockSocket({ auth: { token: 'good-token' } });
      await gateway.handleConnection(socket as never);
      mockStaffSessions.assertLive.mockRejectedValue(new StaffSessionCheckError());
      await jest.advanceTimersByTimeAsync(SOCKET_CREDENTIAL_RECHECK_MS);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('stops re-checking once the socket disconnects', async () => {
      jest.useFakeTimers();
      mockAuthService.verifyAccessToken.mockReturnValue({ ...staffPayload, exp: inAnHour() });
      const socket = mockSocket({ auth: { token: 'good-token' } });
      await gateway.handleConnection(socket as never);
      gateway.handleDisconnect(socket as never);
      mockStaffSessions.assertLive.mockClear();
      await jest.advanceTimersByTimeAsync(SOCKET_CREDENTIAL_RECHECK_MS * 3);
      expect(mockStaffSessions.assertLive).not.toHaveBeenCalled();
    });
  });

  describe('handleJoinVenue', () => {
    it('rejects a connection with no authenticated user', async () => {
      const socket = mockSocket();
      const result = await gateway.handleJoinVenue(socket as never, { venueId: 'venue-1' });
      expect(result).toEqual({ error: 'Unauthorized' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('rejects a missing venueId', async () => {
      const socket = mockSocket();
      socket.data.user = { sub: 'staff-1', role: StaffRole.admin, organizationId: 'org-1' };
      const result = await gateway.handleJoinVenue(socket as never, {} as never);
      expect(result).toEqual({ error: 'Invalid venueId' });
    });

    it('lets a kds_device token join only its own venue', async () => {
      const socket = mockSocket();
      socket.data.user = {
        sub: 'kds-device:venue-1',
        role: StaffRole.kitchen,
        organizationId: 'org-1',
        venueId: 'venue-1',
        kind: 'kds_device',
      };
      const result = await gateway.handleJoinVenue(socket as never, { venueId: 'venue-1' });
      expect(result).toEqual({
        status: 'joined',
        rooms: ['venue:venue-1:orders', 'venue:venue-1:kds'],
      });
      expect(socket.join).toHaveBeenCalledWith('venue:venue-1:orders');
      expect(socket.join).toHaveBeenCalledWith('venue:venue-1:kds');
    });

    it('rejects a kds_device token attempting to join a different venue', async () => {
      const socket = mockSocket();
      socket.data.user = {
        sub: 'kds-device:venue-1',
        role: StaffRole.kitchen,
        organizationId: 'org-1',
        venueId: 'venue-1',
        kind: 'kds_device',
      };
      const result = await gateway.handleJoinVenue(socket as never, {
        venueId: 'someone-elses-venue',
      });
      expect(result).toEqual({ error: 'Unauthorized for this venue' });
      expect(socket.join).not.toHaveBeenCalled();
      expect(mockPrismaService.venue.findUnique).not.toHaveBeenCalled();
    });

    it('lets a staff token join a venue within its own organization', async () => {
      mockPrismaService.venue.findUnique.mockResolvedValue({ organizationId: 'org-1' });
      const socket = mockSocket();
      socket.data.user = { sub: 'staff-1', role: StaffRole.admin, organizationId: 'org-1' };
      const result = await gateway.handleJoinVenue(socket as never, { venueId: 'venue-1' });
      expect(result).toEqual({
        status: 'joined',
        rooms: ['venue:venue-1:orders', 'venue:venue-1:kds'],
      });
    });

    it('rejects a staff token joining a venue belonging to another organization', async () => {
      mockPrismaService.venue.findUnique.mockResolvedValue({ organizationId: 'some-other-org' });
      const socket = mockSocket();
      socket.data.user = { sub: 'staff-1', role: StaffRole.admin, organizationId: 'org-1' };
      const result = await gateway.handleJoinVenue(socket as never, { venueId: 'venue-1' });
      expect(result).toEqual({ error: 'Unauthorized for this venue' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('rejects a staff token when the venue does not exist', async () => {
      mockPrismaService.venue.findUnique.mockResolvedValue(null);
      const socket = mockSocket();
      socket.data.user = { sub: 'staff-1', role: StaffRole.admin, organizationId: 'org-1' };
      const result = await gateway.handleJoinVenue(socket as never, { venueId: 'nonexistent' });
      expect(result).toEqual({ error: 'Unauthorized for this venue' });
    });
  });
});

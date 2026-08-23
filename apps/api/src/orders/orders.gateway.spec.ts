import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { OrdersGateway } from './orders.gateway';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

const mockAuthService = {
  verifyAccessToken: jest.fn(),
};

const mockPrismaService = {
  venue: {
    findUnique: jest.fn(),
  },
};

function mockSocket(
  overrides: {
    auth?: Record<string, unknown>;
    authorizationHeader?: string;
  } = {},
) {
  return {
    id: 'socket-1',
    handshake: {
      auth: overrides.auth ?? {},
      headers: overrides.authorizationHeader
        ? { authorization: overrides.authorizationHeader }
        : {},
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersGateway,
        { provide: AuthService, useValue: mockAuthService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();
    gateway = module.get<OrdersGateway>(OrdersGateway);
  });

  describe('handleConnection', () => {
    it('disconnects a socket with no token', () => {
      const socket = mockSocket();
      gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(mockAuthService.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('disconnects a socket presenting an invalid/expired token', () => {
      mockAuthService.verifyAccessToken.mockImplementation(() => {
        throw new UnauthorizedException('Invalid or expired token');
      });
      const socket = mockSocket({ auth: { token: 'bad-token' } });
      gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a socket presenting the old hard-coded bypass string as a token', () => {
      mockAuthService.verifyAccessToken.mockImplementation(() => {
        throw new UnauthorizedException('Invalid or expired token');
      });
      const socket = mockSocket({ authorizationHeader: 'Bearer kiosk-kds-bypass-token' });
      gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('accepts a socket with a valid token and stores the decoded user', () => {
      const payload = { sub: 'staff-1', role: StaffRole.admin, organizationId: 'org-1' };
      mockAuthService.verifyAccessToken.mockReturnValue(payload);
      const socket = mockSocket({ auth: { token: 'good-token' } });
      gateway.handleConnection(socket as never);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.user).toEqual(payload);
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

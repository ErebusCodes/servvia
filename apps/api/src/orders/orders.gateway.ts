import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

interface SocketAuthData {
  user?: JwtPayload;
}

// `Socket.data` is typed `any` by socket.io's generic default; funnel every
// read/write through these two helpers so the intersection never collapses
// back to `any` at the call sites below.
function getSocketUser(client: Socket): JwtPayload | undefined {
  return (client.data as SocketAuthData).user;
}

function setSocketUser(client: Socket, user: JwtPayload): void {
  (client.data as SocketAuthData).user = user;
}

function extractToken(client: Socket): string | undefined {
  const authToken = client.handshake.auth?.['token'] as string | undefined;
  if (authToken) return authToken;
  const header = client.handshake.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return undefined;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrdersGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(client: Socket) {
    const token = extractToken(client);
    if (!token) {
      this.logger.warn(`Rejected socket ${client.id}: no auth token`);
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.authService.verifyAccessToken(token);
      setSocketUser(client, payload);
    } catch {
      this.logger.warn(`Rejected socket ${client.id}: invalid/expired token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinVenue')
  async handleJoinVenue(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { venueId: string },
  ) {
    const user = getSocketUser(client);
    if (!user) {
      return { error: 'Unauthorized' };
    }
    if (!data || !data.venueId) {
      return { error: 'Invalid venueId' };
    }

    const authorized = await this.isAuthorizedForVenue(user, data.venueId);
    if (!authorized) {
      return { error: 'Unauthorized for this venue' };
    }

    const ordersRoom = `venue:${data.venueId}:orders`;
    const kdsRoom = `venue:${data.venueId}:kds`;
    void client.join(ordersRoom);
    void client.join(kdsRoom);
    return { status: 'joined', rooms: [ordersRoom, kdsRoom] };
  }

  /**
   * Mirrors REST authorization for the same data (org-scoped RBAC — see
   * orders.controller.ts): a KDS device token may only join the single
   * venue room baked into its token; a staff token may join any venue room
   * within its own organization.
   */
  private async isAuthorizedForVenue(user: JwtPayload, venueId: string): Promise<boolean> {
    if (user.kind === 'kds_device') {
      return user.venueId === venueId;
    }
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { organizationId: true },
    });
    return !!venue && venue.organizationId === user.organizationId;
  }

  sendOrderUpdate(venueId: string, order: any) {
    if (this.server) {
      this.server.to(`venue:${venueId}:orders`).emit('orderUpdate', order);
      this.server.to(`venue:${venueId}:kds`).emit('orderUpdate', order);
    }
  }
}

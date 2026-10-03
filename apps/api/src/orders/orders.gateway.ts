import { Logger, UnauthorizedException } from '@nestjs/common';
import { IncomingMessage } from 'http';
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
import { StaffSessionVerifier } from '../auth/staff-session-verifier.service';
import { isAllowedOrigin } from '../config/allowed-origins';
import {
  VenueAccessDecision,
  decideVenueAccess,
  isStaffPrincipal,
} from '../auth/venue-access/venue-access';
import { logSecurityEvent } from '../observability/security-events';

/**
 * How often a connected socket's credential is checked again (Story 2.6):
 * a logout, a deactivation or a revoked tablet ends the connection within
 * this interval. The same interval as the Core realtime re-check.
 */
export const SOCKET_CREDENTIAL_RECHECK_MS = 60_000;

// setTimeout's longest delay; a token expiring later than this is caught by
// the periodic re-check instead.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const TABLET_KINDS = new Set(['tablet_device', 'tablet_staff', 'tablet_manager']);

interface SocketAuthData {
  user?: JwtPayload;
  timers?: NodeJS.Timeout[];
  /** Venues whose rooms the socket joined, re-checked with the credential. */
  venues?: Set<string>;
}

/**
 * socket.io `allowRequest`: refuses the handshake (both transports) from a
 * browser origin outside the API's CORS allow-list. CORS alone does not
 * protect a WebSocket upgrade.
 */
export function allowSocketRequest(
  req: IncomingMessage,
  callback: (err: string | null | undefined, success: boolean) => void,
): void {
  callback(null, isAllowedOrigin(req.headers.origin));
}

/** socket.io `cors.origin`: the same allow-list for the polling transport. */
export function socketCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  callback(null, isAllowedOrigin(origin));
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
  cors: { origin: socketCorsOrigin, credentials: true },
  allowRequest: allowSocketRequest,
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrdersGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly staffSessions: StaffSessionVerifier,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    // Defence in depth: allowRequest already refused a disallowed origin.
    if (!isAllowedOrigin(client.handshake.headers.origin)) {
      this.logger.warn(`Rejected socket ${client.id}: origin not allowed`);
      client.disconnect(true);
      return;
    }
    const token = extractToken(client);
    if (!token) {
      this.logger.warn(`Rejected socket ${client.id}: no auth token`);
      client.disconnect(true);
      return;
    }
    let payload: JwtPayload;
    try {
      payload = this.authService.verifyAccessToken(token);
    } catch {
      this.logger.warn(`Rejected socket ${client.id}: invalid/expired token`);
      client.disconnect(true);
      return;
    }
    if (!(await this.credentialStillValid(client, payload))) {
      return;
    }
    // The client may have gone while the check ran; handleDisconnect has
    // then already run, and no timer may outlive it.
    if (client.disconnected) {
      return;
    }
    setSocketUser(client, payload);
    this.watchCredential(client, payload);
  }

  handleDisconnect(client: Socket) {
    for (const timer of (client.data as SocketAuthData).timers ?? []) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    (client.data as SocketAuthData).timers = [];
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Story 2.6: the credential is checked when the socket connects and again
   * while it stays connected. An expired token, a logged-out session, a
   * deactivated staff member or a revoked tablet disconnects the socket; a
   * check that cannot be made disconnects it too (fails closed).
   */
  private async credentialStillValid(client: Socket, payload: JwtPayload): Promise<boolean> {
    if (payload.exp !== undefined && payload.exp * 1000 <= Date.now()) {
      this.logger.warn(`Disconnecting socket ${client.id}: credential expired`);
      client.disconnect(true);
      return false;
    }
    try {
      await this.staffSessions.assertLive(payload);
      await this.assertTabletDeviceActive(payload);
      await this.leaveVenuesNoLongerGranted(client, payload);
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        this.logger.warn(
          `Disconnecting socket ${client.id}: credential revoked or staff deactivated`,
        );
      } else {
        this.logger.error(
          `Disconnecting socket ${client.id}: credential check failed: ${(err as Error).message}`,
        );
      }
      client.disconnect(true);
      return false;
    }
  }

  private async assertTabletDeviceActive(payload: JwtPayload): Promise<void> {
    if (!payload.kind || !TABLET_KINDS.has(payload.kind) || !payload.deviceId) return;
    const device = await this.prisma.tabletDevice.findUnique({ where: { id: payload.deviceId } });
    if (!device || device.status !== 'active') {
      throw new UnauthorizedException('This device has been revoked or is unknown');
    }
  }

  private watchCredential(client: Socket, payload: JwtPayload): void {
    const timers: NodeJS.Timeout[] = [];
    if (payload.exp !== undefined) {
      const untilExpiry = payload.exp * 1000 - Date.now();
      if (untilExpiry <= MAX_TIMER_DELAY_MS) {
        timers.push(
          setTimeout(() => {
            this.logger.warn(`Disconnecting socket ${client.id}: credential expired`);
            client.disconnect(true);
          }, untilExpiry),
        );
      }
    }
    timers.push(
      setInterval(() => {
        void this.credentialStillValid(client, payload);
      }, SOCKET_CREDENTIAL_RECHECK_MS),
    );
    for (const timer of timers) timer.unref();
    (client.data as SocketAuthData).timers = timers;
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
    const auth = client.data as SocketAuthData;
    (auth.venues ??= new Set()).add(data.venueId);
    return { status: 'joined', rooms: [ordersRoom, kdsRoom] };
  }

  /**
   * Mirrors REST authorization for the same data (Story 2.10, and Core's
   * realtime subscribe check): a device-scoped token (a KDS screen or a
   * tablet, elevated or not) joins only the venue in its token; a staff
   * principal joins only a venue of its organization it has been granted,
   * and an elevated tablet needs both. A grant that cannot be checked
   * refuses (fails closed).
   */
  private async isAuthorizedForVenue(user: JwtPayload, venueId: string): Promise<boolean> {
    const deviceScoped = !!user.kind && user.kind !== 'staff';
    if (deviceScoped && user.venueId !== venueId) return false;
    // A KDS screen or an unelevated tablet: its token's venue is the rule.
    if (!isStaffPrincipal(user)) return true;
    try {
      const decision = await decideVenueAccess(this.prisma, user.sub, user.organizationId, venueId);
      if (decision === VenueAccessDecision.NotGranted) this.logVenueDenied(user, venueId);
      return decision === VenueAccessDecision.Granted;
    } catch (err) {
      this.logger.error(`Venue access check failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * A staff member whose grant for a joined venue was revoked stops
   * receiving that venue's events at the next credential re-check.
   */
  private async leaveVenuesNoLongerGranted(client: Socket, user: JwtPayload): Promise<void> {
    const venues = (client.data as SocketAuthData).venues;
    if (!venues || !isStaffPrincipal(user)) return;
    for (const venueId of [...venues]) {
      const decision = await decideVenueAccess(this.prisma, user.sub, user.organizationId, venueId);
      if (decision !== VenueAccessDecision.Granted) {
        if (decision === VenueAccessDecision.NotGranted) this.logVenueDenied(user, venueId);
        void client.leave(`venue:${venueId}:orders`);
        void client.leave(`venue:${venueId}:kds`);
        venues.delete(venueId);
      }
    }
  }

  private logVenueDenied(user: JwtPayload, venueId: string): void {
    logSecurityEvent('venue_access_denied', 'staff venue access denied', {
      staff_id: user.sub,
      kind: user.kind ?? 'staff_session',
      role: user.role,
      organization_id: user.organizationId,
      venue_id: venueId,
      transport: 'realtime',
    });
  }

  sendOrderUpdate(venueId: string, order: any) {
    if (this.server) {
      this.server.to(`venue:${venueId}:orders`).emit('orderUpdate', order);
      this.server.to(`venue:${venueId}:kds`).emit('orderUpdate', order);
    }
  }
}

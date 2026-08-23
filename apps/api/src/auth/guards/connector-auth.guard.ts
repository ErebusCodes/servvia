import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ConnectorIdentity, ConnectorService } from '../../connector/connector.service';
import { extractBearerToken } from '../../common/utils/extract-bearer-token';

/**
 * Authenticates a venue connector's own outbound requests
 * (`Authorization: Bearer ${installationId}.${secret}`) — structurally
 * separate from `req.user` (staff/kds_device, see jwt-payload.interface.ts)
 * rather than overloading that union, since a connector is not a JWT
 * principal and must be checked against the DB on every request to make
 * revocation actually real-time (see connector.service.ts#authenticate).
 */
@Injectable()
export class ConnectorAuthGuard implements CanActivate {
  constructor(private readonly connectorService: ConnectorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { connector?: ConnectorIdentity }>();
    const credential = extractBearerToken(request.headers.authorization);
    if (!credential) {
      throw new UnauthorizedException('Missing or invalid connector credential');
    }

    const identity = await this.connectorService.authenticate(credential);
    if (!identity) {
      throw new UnauthorizedException('Missing or invalid connector credential');
    }

    request.connector = identity;
    return true;
  }
}

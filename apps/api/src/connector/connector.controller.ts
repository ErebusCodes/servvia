import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { ConnectorAuthGuard } from '../auth/guards/connector-auth.guard';
import { extractBearerToken } from '../common/utils/extract-bearer-token';
import { ConnectorHeartbeatDto } from './dto/connector-heartbeat.dto';
import { ConnectorIdentity, ConnectorService } from './connector.service';

/**
 * Connector-facing surface: the venue connector itself calls these
 * endpoints. `enroll` is publicly reachable but rate-limited and requires
 * a short-lived, single-use bootstrap token; `heartbeat` requires a
 * durable, revocable connector credential. Both credentials travel as
 * `Authorization: Bearer <token>` (not in the request body) so an
 * unattended connector — which has no browser session or CSRF cookie —
 * is naturally covered by CsrfMiddleware's existing Bearer-token bypass,
 * the same mechanism already used for internal-service calls. Neither
 * endpoint contacts Idealpos, EFTPOS, a printer, or a Windows host, and a
 * successful call here is never evidence that such contact occurred.
 */
@Controller('connector')
export class ConnectorController {
  constructor(private readonly connectorService: ConnectorService) {}

  @Post('enroll')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 900 })
  @HttpCode(200)
  async enroll(@Req() req: Request): Promise<{ installationId: string; credential: string }> {
    const bootstrapToken = extractBearerToken(req.headers.authorization);
    if (!bootstrapToken) {
      throw new UnauthorizedException('Missing or invalid bootstrap token');
    }
    return this.connectorService.redeemEnrollment(bootstrapToken);
  }

  @Post('heartbeat')
  // RateLimitGuard must run before ConnectorAuthGuard: guards execute in
  // array order and NestJS short-circuits on the first rejection, so
  // ConnectorAuthGuard-first would let every failed-auth request (a flood
  // of garbage bearer tokens) skip the limiter entirely and still pay the
  // full memory-hard Argon2id verify cost on every single attempt — an
  // unauthenticated computational-amplification vector, found in
  // independent review. Ordering the limiter first bounds that cost.
  @UseGuards(RateLimitGuard, ConnectorAuthGuard)
  @RateLimit({ limit: 120, windowSeconds: 60 })
  @HttpCode(200)
  async heartbeat(
    @Body() dto: ConnectorHeartbeatDto,
    @Req() req: Request & { connector: ConnectorIdentity },
  ): Promise<{ ok: true }> {
    await this.connectorService.reportHealth(req.connector, dto);
    return { ok: true };
  }
}

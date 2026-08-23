import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { ConnectorAuthGuard } from '../auth/guards/connector-auth.guard';
import { ConnectorIdentity } from './connector.service';
import { ConnectorCommandService, ConnectorCommandView } from './connector-command.service';
import { ConnectorCommandReportDto } from './dto/connector-command-report.dto';

/**
 * Connector-facing surface for Story 2-10's command protocol. Every route
 * requires a durable Story 2-9 connector credential (`ConnectorAuthGuard`)
 * and resolves the caller's organization/venue from that authenticated
 * identity only — never from a request parameter. `RateLimitGuard` is
 * ordered before `ConnectorAuthGuard` on every route (established during
 * story 2-9's own independent review, `connector.controller.ts`'s
 * `heartbeat` route): guards run in array order and NestJS short-circuits
 * on the first rejection, so putting the limiter first bounds the cost of
 * an unauthenticated flood of garbage bearer tokens before it can pay the
 * full memory-hard Argon2id verify cost on every attempt.
 */
@Controller('connector/commands')
export class ConnectorCommandController {
  constructor(private readonly commandService: ConnectorCommandService) {}

  @Post('poll')
  @UseGuards(RateLimitGuard, ConnectorAuthGuard)
  @RateLimit({ limit: 120, windowSeconds: 60 })
  @HttpCode(200)
  async poll(
    @Req() req: Request & { connector: ConnectorIdentity },
  ): Promise<{ commands: ConnectorCommandView[] }> {
    return { commands: await this.commandService.poll(req.connector) };
  }

  @Post(':commandId/accept')
  @UseGuards(RateLimitGuard, ConnectorAuthGuard)
  @RateLimit({ limit: 120, windowSeconds: 60 })
  @HttpCode(200)
  async accept(
    @Param('commandId', ParseUUIDPipe) commandId: string,
    @Req() req: Request & { connector: ConnectorIdentity },
  ): Promise<{ accepted: true }> {
    await this.commandService.accept(commandId, req.connector);
    return { accepted: true };
  }

  @Post(':commandId/report')
  @UseGuards(RateLimitGuard, ConnectorAuthGuard)
  @RateLimit({ limit: 120, windowSeconds: 60 })
  @HttpCode(200)
  async report(
    @Param('commandId', ParseUUIDPipe) commandId: string,
    @Body() dto: ConnectorCommandReportDto,
    @Req() req: Request & { connector: ConnectorIdentity },
  ): Promise<{ reported: true }> {
    await this.commandService.report(commandId, req.connector, dto);
    return { reported: true };
  }
}

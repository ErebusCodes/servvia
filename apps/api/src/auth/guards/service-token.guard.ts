import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { safeCompare } from '../../common/utils/safe-compare';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid service token');
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('Missing or invalid service token');
    }
    // getOrThrow fails closed: a missing INTERNAL_SERVICE_TOKEN configuration
    // throws rather than silently permitting any/no token through.
    const expectedToken = this.config.getOrThrow<string>('INTERNAL_SERVICE_TOKEN');
    if (!safeCompare(token, expectedToken)) {
      throw new UnauthorizedException('Missing or invalid service token');
    }
    return true;
  }
}

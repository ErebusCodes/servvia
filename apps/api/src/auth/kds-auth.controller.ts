import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { RateLimit } from './decorators/rate-limit.decorator';
import { KdsAuthDto } from './dto/kds-auth.dto';
import { KdsAuthService } from './kds-auth.service';

/**
 * Public (kiosk-namespaced) PIN exchange for unattended kitchen-display
 * terminals — see docs/ux.md §3.3 ("/kds — PIN entry on first load").
 * Rate-limited like the staff login endpoint to slow PIN brute-forcing.
 */
@Controller('kiosk/kds')
@UseGuards(RateLimitGuard)
export class KdsAuthController {
  constructor(private readonly kdsAuthService: KdsAuthService) {}

  @Post('auth')
  @RateLimit({ limit: 10, windowSeconds: 900 })
  @HttpCode(200)
  authenticate(@Body() dto: KdsAuthDto): Promise<{ accessToken: string; expiresIn: string }> {
    return this.kdsAuthService.authenticate(dto.venueId, dto.pin);
  }
}

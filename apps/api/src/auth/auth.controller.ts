import { Controller, Post, Body, Res, Req, HttpCode, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { StaffWithSession } from './strategies/jwt-refresh.strategy';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { RateLimit } from './decorators/rate-limit.decorator';
import { LoginDto } from './dto/login.dto';
import { AdminPinLoginDto } from './dto/admin-pin-login.dto';
import { CredentialSetupDto } from '../staff/dto/staff-account.dto';
import { CredentialSetupService } from '../staff/credential-setup.service';

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly credentialSetup: CredentialSetupService,
  ) {}

  @Post('login')
  @RateLimit({ limit: 10, windowSeconds: 900 })
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: Request,
  ): Promise<{
    accessToken: string;
    user: { id: string; email: string; name: string; role: string };
  }> {
    const ipAddress = req
      ? (req.headers['x-real-ip'] as string) || (req.headers['x-forwarded-for'] as string) || req.ip
      : undefined;
    const userAgent = req ? (req.headers['user-agent'] as string) : undefined;

    const staff = await this.authService.validateLogin(
      dto.email,
      dto.password,
      ipAddress,
      userAgent,
    );
    const sessionId = await this.authService.startSession(staff);
    const accessToken = this.authService.signAccessToken(staff, sessionId);
    const refreshToken = this.authService.signRefreshToken(staff, sessionId);
    this.authService.setRefreshCookie(res, refreshToken);

    await this.authService.logLoginSuccess(staff, ipAddress, userAgent);

    return {
      accessToken,
      user: { id: staff.id, email: staff.email, name: staff.name, role: staff.role },
    };
  }

  @Post('admin-pin')
  @RateLimit({ limit: 5, windowSeconds: 900 })
  @HttpCode(200)
  async loginWithAdminPin(
    @Body() dto: AdminPinLoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: Request,
  ): Promise<{
    accessToken: string;
    user: { id: string; email: string; name: string; role: string };
  }> {
    const ipAddress = req
      ? (req.headers['x-real-ip'] as string) || (req.headers['x-forwarded-for'] as string) || req.ip
      : undefined;
    const userAgent = req ? (req.headers['user-agent'] as string) : undefined;
    const staff = await this.authService.validateAdminPin(dto.pin, ipAddress, userAgent);
    const sessionId = await this.authService.startSession(staff);
    const accessToken = this.authService.signAccessToken(staff, sessionId);
    const refreshToken = this.authService.signRefreshToken(staff, sessionId);
    this.authService.setRefreshCookie(res, refreshToken);

    return {
      accessToken,
      user: { id: staff.id, email: staff.email, name: staff.name, role: staff.role },
    };
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @RateLimit({ limit: 10, windowSeconds: 900 })
  @HttpCode(200)
  refresh(@Req() req: Request & { user: StaffWithSession }): { accessToken: string } {
    const accessToken = this.authService.signAccessToken(req.user, req.user.sessionId);
    return { accessToken };
  }

  /**
   * Story 8.1: a staff member sets their own password with the single-use
   * code an owner or admin was given for them. Unauthenticated (the code is
   * the credential), rate limited like login, and every refusal is the same
   * generic 401. On success every session of the staff member is revoked;
   * they then sign in with the new password.
   */
  @Post('credential-setup')
  @RateLimit({ limit: 10, windowSeconds: 900 })
  @HttpCode(204)
  async setupCredential(@Body() dto: CredentialSetupDto, @Req() req?: Request): Promise<void> {
    const ipAddress = req
      ? (req.headers['x-real-ip'] as string) || (req.headers['x-forwarded-for'] as string) || req.ip
      : undefined;
    const userAgent = req ? (req.headers['user-agent'] as string) : undefined;
    await this.credentialSetup.redeem(dto.code, dto.password, ipAddress, userAgent);
  }

  @Post('logout')
  @RateLimit({ limit: 10, windowSeconds: 900 })
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) res: Response, @Req() req?: Request): Promise<void> {
    const cookies = req?.cookies as Record<string, string> | undefined;
    const token = cookies?.['refresh_token'];
    const ipAddress = req
      ? (req.headers['x-real-ip'] as string) || (req.headers['x-forwarded-for'] as string) || req.ip
      : undefined;
    const userAgent = req ? (req.headers['user-agent'] as string) : undefined;

    const authorization = req?.headers.authorization;
    const accessToken = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

    this.authService.clearRefreshCookie(res);
    await this.authService.logout(token, accessToken, ipAddress, userAgent);
  }
}

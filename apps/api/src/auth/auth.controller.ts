import { Controller, Post, Body, Res, Req, HttpCode, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { Staff } from '@prisma/client';
import { AuthService } from './auth.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { RateLimit } from './decorators/rate-limit.decorator';
import { LoginDto } from './dto/login.dto';
import { AdminPinLoginDto } from './dto/admin-pin-login.dto';

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
    const accessToken = this.authService.signAccessToken(staff);
    const refreshToken = this.authService.signRefreshToken(staff);
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
    const accessToken = this.authService.signAccessToken(staff);
    const refreshToken = this.authService.signRefreshToken(staff);
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
  refresh(@Req() req: Request & { user: Staff }): { accessToken: string } {
    const accessToken = this.authService.signAccessToken(req.user);
    return { accessToken };
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

    this.authService.clearRefreshCookie(res);
    await this.authService.logout(token, ipAddress, userAgent);
  }
}

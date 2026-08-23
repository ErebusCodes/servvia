import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res() res: Response) {
    try {
      const result = await this.healthService.check();
      const httpStatus = result.db === 'ok' && result.redis === 'ok' ? 200 : 503;
      return res.status(httpStatus).json(result);
    } catch {
      return res.status(503).json({ db: 'error', redis: 'error' });
    }
  }
}

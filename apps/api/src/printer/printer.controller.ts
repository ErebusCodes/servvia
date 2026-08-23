import { Controller, Get, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from '../auth/guards/service-token.guard';

@Controller('printer')
@UseGuards(ServiceTokenGuard)
export class PrinterController {
  @Get('jobs')
  getJobs() {
    return { status: 'success', jobs: [] };
  }
}

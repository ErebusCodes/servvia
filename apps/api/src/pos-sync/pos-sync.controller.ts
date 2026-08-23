import { Controller, Get, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from '../auth/guards/service-token.guard';

@Controller('pos-sync')
@UseGuards(ServiceTokenGuard)
export class PosSyncController {
  @Get('records')
  getRecords() {
    return { status: 'success', records: [] };
  }
}

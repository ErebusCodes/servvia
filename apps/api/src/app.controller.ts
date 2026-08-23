import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot(): { status: string; message: string } {
    return {
      status: 'ok',
      message: 'Verdura API is running. See GET /health for service status.',
    };
  }
}

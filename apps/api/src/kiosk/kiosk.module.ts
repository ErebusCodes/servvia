import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KioskController } from './kiosk.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KioskController],
  providers: [],
})
export class KioskModule {}

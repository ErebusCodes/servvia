import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import Redis from 'ioredis';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: 'HEALTH_REDIS',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: parseInt(config.getOrThrow<string>('REDIS_PORT'), 10),
          lazyConnect: true,
        }),
    },
  ],
})
export class HealthModule {}

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
          // Same reasoning as redis.module.ts's REDIS_CLIENT: bounds
          // checkRedis()'s ping() so /api/health itself can never hang on
          // a down/unreachable Redis — it must report 'error' promptly,
          // not join the outage by never responding.
          commandTimeout: 1500,
        }),
    },
  ],
})
export class HealthModule {}

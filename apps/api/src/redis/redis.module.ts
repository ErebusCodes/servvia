import { Module, Global, Logger, OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('REDIS_HOST', '127.0.0.1');
        const rawPort = config.get<string>('REDIS_PORT', '6379');
        const port = parseInt(rawPort, 10);
        if (isNaN(port) || port < 0 || port > 65535) {
          throw new Error(`Invalid REDIS_PORT environment variable: ${rawPort}`);
        }
        const logger = new Logger('RedisModule');
        const client = new Redis({
          host,
          port,
          lazyConnect: true,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times: number) => {
            return Math.min(Math.pow(2, times) * 100, 10000);
          },
        });
        client.on('error', (err: Error) => {
          logger.warn(`Redis client error (will retry): ${err.message}`);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

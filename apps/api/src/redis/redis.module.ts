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
          // Bounds every command's wait time regardless of connection state
          // (ioredis starts this timer at dispatch, even for a command
          // sitting in the offline queue waiting to (re)connect) — without
          // it, maxRetriesPerRequest: null + an unreachable Redis meant a
          // command here could hang the HTTP request indefinitely.
          // RateLimitGuard's existing catch block already fails closed
          // (503) on any rejected command; this just guarantees that path
          // is reached within a bounded time instead of never.
          commandTimeout: 1500,
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

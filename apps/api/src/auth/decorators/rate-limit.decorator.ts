import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export const RateLimit = (options: RateLimitOptions): CustomDecorator<string> =>
  SetMetadata(RATE_LIMIT_KEY, options);

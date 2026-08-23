import { ConfigService } from '@nestjs/config';
import * as path from 'path';

// Shared by MediaService and main.ts's static-asset middleware so both
// resolve the exact same directory regardless of how MEDIA_STORAGE_PATH is
// expressed (relative paths are resolved against the backend process cwd).
export function resolveMediaStoragePath(config: ConfigService): string {
  const configured = config.get<string>('MEDIA_STORAGE_PATH') || 'storage';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

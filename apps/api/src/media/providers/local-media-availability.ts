import { ConfigService } from '@nestjs/config';
import { isNonProductionRuntime } from '../../config/runtime-environment';

/**
 * The local media emulation routes (the unauthenticated upload stand-in for
 * a GCS signed URL, and the anonymous public read) exist only in an explicit
 * development or test environment with the local storage provider active.
 * Anywhere else they answer 404: they do not exist. This is decided per
 * request from validated configuration, never from a NODE_ENV default
 * (Story 2.3).
 */
export function localMediaRoutesAvailable(config: ConfigService): boolean {
  return (
    isNonProductionRuntime(config.get<string>('NODE_ENV')) &&
    config.get<string>('MEDIA_STORAGE_PROVIDER') !== 'gcs'
  );
}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { MediaAssetsService } from './media-assets.service';
import { MediaAssetsController } from './media-assets.controller';
import { STORAGE_PROVIDER_PORT } from './providers/storage-provider.port';
import { GcsStorageProvider } from './providers/gcs-storage.provider';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { LocalMediaUploadController } from './providers/local-media-upload.controller';
import { LocalMediaPublicController } from './providers/local-media-public.controller';
import { resolveMediaStoragePath } from './media-storage.util';
import { DEFAULT_LOCAL_PUBLIC_BUCKET } from './media-assets.constants';
import { StorageProviderPort } from './providers/storage-provider.port';

/**
 * Throws `message` when `value` is absent or contains only whitespace —
 * catching the same "not really set" a bare `if (!value)` check misses for
 * a stray blank `.env` line (e.g. `GCS_MEDIA_BUCKET=   `) — otherwise
 * returns it narrowed to `string`, so callers never need a lying `as
 * string` cast (the exact defect this function replaces — see
 * media.module.spec.ts's regression-coverage comment).
 */
function requireNonBlank(value: string | undefined, message: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

/**
 * GCP_PROJECT_ID is the explicit override; GOOGLE_CLOUD_PROJECT is what
 * Cloud Run/GKE/Cloud Functions set automatically — either name works.
 * Extracted so the fallback itself is unit-testable, the same reason
 * resolveStorageProvider below is its own exported function rather than
 * being inlined in the factory.
 */
export function resolveProjectId(
  gcpProjectId: string | undefined,
  googleCloudProject: string | undefined,
): string | undefined {
  return gcpProjectId || googleCloudProject;
}

/**
 * Fails closed, at boot, with a truthful error naming exactly what's
 * missing — not app.module.ts's Joi schema (which does not cover these;
 * there is no cross-field "required only when MEDIA_STORAGE_PROVIDER=gcs"
 * validation there), and not a silent `as string` cast into
 * GcsStorageProvider that would instead defer this to a confusing failure
 * deep inside the Google auth library the first time a request actually
 * needs a signed URL. Exported (not inlined in the factory below) so this
 * decision is unit-testable without booting Nest's DI container.
 *
 * The two bucket names are validated here, once, even though
 * GcsStorageProvider's own constructor never takes them (MediaAssetsService
 * reads them directly) — this is the single point every GCS-bound boot
 * passes through, so it is also the single place that can refuse to start
 * before MediaAssetsService's own `config.get(...) || <local-style
 * default>` fallback (needed so the same lookup also works for the local
 * provider's disk-directory naming) would otherwise substitute a bucket
 * name never actually reviewed by an operator.
 */
export function resolveStorageProvider(
  activeProvider: string | undefined,
  projectId: string | undefined,
  serviceAccountEmail: string | undefined,
  mediaBucket: string | undefined,
  mediaPublicBucket: string | undefined,
  local: LocalStorageProvider,
): StorageProviderPort {
  if (activeProvider !== 'gcs') {
    return local;
  }
  const resolvedProjectId = requireNonBlank(
    projectId,
    'MEDIA_STORAGE_PROVIDER=gcs requires GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) to be set. ' +
      'Refusing to start with an incomplete GCS configuration.',
  );
  const resolvedServiceAccountEmail = requireNonBlank(
    serviceAccountEmail,
    'MEDIA_STORAGE_PROVIDER=gcs requires GCS_SERVICE_ACCOUNT_EMAIL to be set. ' +
      'Refusing to start with an incomplete GCS configuration.',
  );
  requireNonBlank(
    mediaBucket,
    'MEDIA_STORAGE_PROVIDER=gcs requires GCS_MEDIA_BUCKET to be set. ' +
      'Refusing to start with an incomplete GCS configuration.',
  );
  requireNonBlank(
    mediaPublicBucket,
    'MEDIA_STORAGE_PROVIDER=gcs requires GCS_MEDIA_PUBLIC_BUCKET to be set. ' +
      'Refusing to start with an incomplete GCS configuration.',
  );
  return new GcsStorageProvider(resolvedProjectId, resolvedServiceAccountEmail);
}

@Module({
  imports: [PrismaModule, AuditModule, ConfigModule],
  controllers: [
    MediaController,
    MediaAssetsController,
    LocalMediaUploadController,
    LocalMediaPublicController,
  ],
  providers: [
    MediaService,
    MediaAssetsService,
    {
      // LocalStorageProvider is always constructed (LocalMediaUploadController
      // depends on it directly for local dev's upload endpoint), but is only
      // ever wired as the active STORAGE_PROVIDER_PORT when
      // MEDIA_STORAGE_PROVIDER=local — see the factory below.
      provide: LocalStorageProvider,
      useFactory: (config: ConfigService) =>
        new LocalStorageProvider(
          resolveMediaStoragePath(config) + '-assets',
          resolveMediaStoragePath(config) + '-assets-public',
          (config.get<string>('MEDIA_BASE_URL') || '').replace(/\/+$/, ''),
          config.get<string>('GCS_MEDIA_PUBLIC_BUCKET') || DEFAULT_LOCAL_PUBLIC_BUCKET,
        ),
      inject: [ConfigService],
    },
    {
      // Defaults to 'local' — a fresh clone must never need real GCS
      // credentials just to run `npm run dev`. Only an explicit
      // MEDIA_STORAGE_PROVIDER=gcs activates the real provider. See
      // resolveStorageProvider() above for the fail-closed validation.
      provide: STORAGE_PROVIDER_PORT,
      useFactory: (config: ConfigService, local: LocalStorageProvider) =>
        resolveStorageProvider(
          config.get<string>('MEDIA_STORAGE_PROVIDER'),
          resolveProjectId(
            config.get<string>('GCP_PROJECT_ID'),
            config.get<string>('GOOGLE_CLOUD_PROJECT'),
          ),
          config.get<string>('GCS_SERVICE_ACCOUNT_EMAIL'),
          config.get<string>('GCS_MEDIA_BUCKET'),
          config.get<string>('GCS_MEDIA_PUBLIC_BUCKET'),
          local,
        ),
      inject: [ConfigService, LocalStorageProvider],
    },
  ],
  exports: [MediaService, MediaAssetsService],
})
export class MediaModule {}

import { Controller, ForbiddenException, Param, Put, Req } from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { LocalStorageProvider } from './local-storage.provider';

// Dev/test-only: the destination LocalStorageProvider's "signed URL" points
// to. This route's own NODE_ENV check below is the only enforcement — there
// is no separate app.module.ts config-schema rejection of
// MEDIA_STORAGE_PROVIDER=local (or of this controller) when
// NODE_ENV=production; this check must not be removed or weakened.
@Controller('admin/media-assets/local-dev-upload')
export class LocalMediaUploadController {
  constructor(
    private readonly localStorage: LocalStorageProvider,
    private readonly config: ConfigService,
  ) {}

  @Put(':encodedObjectKey')
  async upload(@Param('encodedObjectKey') encodedObjectKey: string, @Req() req: Request) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Local media upload is not available in production');
    }
    const objectKey = decodeURIComponent(encodedObjectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    await this.localStorage.writeLocal(objectKey, Buffer.concat(chunks));
    return { objectKey };
  }
}

import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { LocalStorageProvider, ObjectKeyOutsideRootError } from './local-storage.provider';
import { localMediaRoutesAvailable } from './local-media-availability';
import { mimeTypeForExtension } from '../media-assets.constants';

// Dev/test-only emulation of anonymous GET on the real public-delivery
// bucket — deliberately unauthenticated (a real public bucket grants
// roles/storage.objectViewer to allUsers), guarded against production the
// same way LocalMediaUploadController is. Only ever serves bytes that
// MediaAssetsService.publishAsset() has explicitly copied into the local
// public root — never the private root.
@Controller('media-assets/public')
export class LocalMediaPublicController {
  constructor(
    private readonly localStorage: LocalStorageProvider,
    private readonly config: ConfigService,
  ) {}

  @Get(':encodedObjectKey')
  async get(@Param('encodedObjectKey') encodedObjectKey: string, @Res() res: Response) {
    if (!localMediaRoutesAvailable(this.config)) {
      throw new NotFoundException();
    }
    let objectKey: string;
    try {
      objectKey = decodeURIComponent(encodedObjectKey);
    } catch {
      throw new NotFoundException();
    }
    let buf: Buffer | null;
    try {
      buf = await this.localStorage.readPublic(objectKey);
    } catch (error) {
      if (error instanceof ObjectKeyOutsideRootError) throw new NotFoundException();
      throw error;
    }
    if (!buf) {
      throw new NotFoundException('Object not found');
    }
    res.setHeader('Content-Type', mimeTypeForExtension(path.extname(objectKey)));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buf);
  }
}

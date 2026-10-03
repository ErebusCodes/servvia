import {
  BadRequestException,
  Controller,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Put,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { LocalStorageProvider, ObjectKeyOutsideRootError } from './local-storage.provider';
import { localMediaRoutesAvailable } from './local-media-availability';
import { mediaTypeForMimeType } from '../media-assets.constants';

/** Fallback body limit when MEDIA_MAX_FILE_SIZE_BYTES is unset (the schema default). */
const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Development/test-only stand-in for a GCS V4 signed upload URL: the
// destination LocalStorageProvider.generateSignedUploadUrl points at. Like a
// signed URL it carries no session; the server-generated object key is the
// capability. Outside an explicit development or test environment with the
// local provider active, it does not exist (404). Even in development the
// body is size-limited, its Content-Type must be an accepted media type (as
// the signed URL requires; it also guarantees no body parser consumed the
// stream first, which would silently store an empty object), and the key
// cannot leave the private media root. As with a real signed URL, a PUT to
// the same key replaces the object.
@Controller('admin/media-assets/local-dev-upload')
export class LocalMediaUploadController {
  constructor(
    private readonly localStorage: LocalStorageProvider,
    private readonly config: ConfigService,
  ) {}

  @Put(':encodedObjectKey')
  async upload(@Param('encodedObjectKey') encodedObjectKey: string, @Req() req: Request) {
    if (!localMediaRoutesAvailable(this.config)) {
      throw new NotFoundException();
    }
    let objectKey: string;
    try {
      objectKey = decodeURIComponent(encodedObjectKey);
    } catch {
      throw new BadRequestException('Malformed object key');
    }
    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!mediaTypeForMimeType(contentType)) {
      throw new UnsupportedMediaTypeException('Content-Type must be an accepted media type');
    }
    const maxBytes = Number(
      this.config.get<number>('MEDIA_MAX_FILE_SIZE_BYTES') ?? DEFAULT_MAX_UPLOAD_BYTES,
    );
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new PayloadTooLargeException(`Upload exceeds ${maxBytes} bytes`);
    }
    // Count while reading too: Content-Length can be absent (chunked) or wrong.
    const body = await readBounded(req, maxBytes);
    try {
      await this.localStorage.writeLocal(objectKey, body);
    } catch (error) {
      if (error instanceof ObjectKeyOutsideRootError) {
        throw new BadRequestException('Object key is outside the media root');
      }
      throw error;
    }
    return { objectKey };
  }
}

/**
 * Reads the request body up to `maxBytes`. Past the limit it stops reading
 * and pauses the stream (as raw-body does), so the 413 response is still
 * delivered and Node closes the connection afterwards; nothing is buffered
 * beyond the limit.
 */
function readBounded(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        cleanup();
        req.pause();
        reject(new PayloadTooLargeException(`Upload exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

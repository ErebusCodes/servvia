import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  DeliveryUrlParams,
  ObjectVerificationResult,
  SignedUploadUrlResult,
  StorageProviderPort,
} from './storage-provider.port';

// Dev/test-only provider — zero external dependency, so `npm run dev` and
// the test suite never need real GCP credentials. MEDIA_STORAGE_PROVIDER
// defaults to 'local' (see media.module.ts's resolveStorageProvider) — only
// an explicit MEDIA_STORAGE_PROVIDER=gcs activates GcsStorageProvider
// instead. There is no separate NODE_ENV=production guard against this
// provider in app.module.ts's config schema today (MEDIA_STORAGE_PROVIDER
// is not Joi-validated there at all) — operators must set
// MEDIA_STORAGE_PROVIDER=gcs explicitly for any real deployment; nothing in
// this codebase currently refuses to boot a production NODE_ENV with this
// provider still active. "Signed" uploads here are a real HTTP PUT to this
// same API process (LocalMediaUploadController), not a mock — exercising
// this provider proves MediaAssetsService's full state machine end-to-end,
// just against local disk instead of GCS.
//
// main.ts calls app.setGlobalPrefix('api'), so every controller route this
// provider points a client at is actually served under /api/... — the URLs
// built below must include that prefix explicitly, since Nest applies it
// at the HTTP layer, not automatically to strings built here.
const API_PREFIX = '/api';

@Injectable()
export class LocalStorageProvider implements StorageProviderPort {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly publicRoot: string;
  private readonly baseUrl: string;
  private readonly publicBucketName: string;

  constructor(root: string, publicRoot: string, baseUrl: string, publicBucketName: string) {
    this.root = root;
    this.publicRoot = publicRoot;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.publicBucketName = publicBucketName;
  }

  private resolvePath(objectKey: string): string {
    // objectKey is always server-generated (see MediaAssetsService) —
    // never client input — so this join is safe. Defense-in-depth: reject
    // anything that would escape root regardless.
    const resolved = path.resolve(this.root, objectKey);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new Error(`Refusing to resolve object key outside local media root: ${objectKey}`);
    }
    return resolved;
  }

  private resolvePublicPath(objectKey: string): string {
    const resolved = path.resolve(this.publicRoot, objectKey);
    if (!resolved.startsWith(path.resolve(this.publicRoot))) {
      throw new Error(
        `Refusing to resolve object key outside local public media root: ${objectKey}`,
      );
    }
    return resolved;
  }

  generateSignedUploadUrl(params: {
    bucket: string;
    objectKey: string;
    contentType: string;
    maxSizeBytes: number;
    ttlSeconds: number;
    checksum: string;
  }): Promise<SignedUploadUrlResult> {
    const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
    return Promise.resolve({
      uploadUrl: `${this.baseUrl}${API_PREFIX}/admin/media-assets/local-dev-upload/${encodeURIComponent(params.objectKey)}`,
      bucket: params.bucket,
      objectKey: params.objectKey,
      expiresAt,
      requiredHeaders: { 'Content-Type': params.contentType },
    });
  }

  /** Called only by LocalMediaUploadController — not part of the StorageProviderPort interface. */
  async writeLocal(objectKey: string, body: Buffer): Promise<void> {
    const dest = this.resolvePath(objectKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
  }

  async verifyObject(params: {
    bucket: string;
    objectKey: string;
  }): Promise<ObjectVerificationResult> {
    // Local dev has no real per-bucket separation — two directories stand
    // in for the two real buckets. Which one to read from is decided by
    // the bucket name the caller passed, exactly like GcsStorageProvider
    // would look at a real distinct bucket.
    const filePath =
      params.bucket === this.publicBucketName
        ? this.resolvePublicPath(params.objectKey)
        : this.resolvePath(params.objectKey);
    if (!existsSync(filePath)) {
      return { exists: false };
    }
    const buf = await fs.readFile(filePath);
    return {
      exists: true,
      sizeBytes: buf.byteLength,
      // The local provider always has the real bytes on disk, so this is
      // computed directly rather than round-tripped through metadata —
      // exercises the exact-match branch of MediaAssetsService's
      // verification logic that the GCS provider also uses.
      declaredChecksum: createHash('sha256').update(buf).digest('hex'),
    };
  }

  generateDeliveryUrl(params: DeliveryUrlParams): Promise<string> {
    if (params.visibility === 'public') {
      // Real route, served by LocalMediaPublicController — deliberately
      // unauthenticated, emulating anonymous GET on a real public bucket.
      return Promise.resolve(
        `${this.baseUrl}${API_PREFIX}/media-assets/public/${encodeURIComponent(params.objectKey)}`,
      );
    }
    // Private local objects are never fetched by a browser — nothing
    // serves this route, matching "the browser never receives access to
    // the private original" for the local provider too.
    return Promise.resolve(
      `${this.baseUrl}${API_PREFIX}/media-assets/private/${encodeURIComponent(params.objectKey)}`,
    );
  }

  /**
   * Copies the private original's bytes into the public root under the
   * same object key — the local-dev stand-in for a real GCS-to-GCS copy.
   * Bucket names are accepted for interface parity but not otherwise used:
   * local dev has exactly one private root and one public root.
   */
  async publishObject(params: {
    sourceBucket: string;
    destinationBucket: string;
    objectKey: string;
    contentType: string;
    checksum: string;
  }): Promise<void> {
    const source = this.resolvePath(params.objectKey);
    const destination = this.resolvePublicPath(params.objectKey);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }

  /** Used only by LocalMediaPublicController — not part of StorageProviderPort. */
  async readPublic(objectKey: string): Promise<Buffer | null> {
    const filePath = this.resolvePublicPath(objectKey);
    if (!existsSync(filePath)) {
      return null;
    }
    return fs.readFile(filePath);
  }

  async deleteObject(params: { bucket: string; objectKey: string }): Promise<void> {
    try {
      await fs.rm(this.resolvePath(params.objectKey), { force: true });
    } catch (error) {
      this.logger.warn(
        `Failed to delete local object ${params.objectKey}: ${(error as Error).message}`,
      );
    }
  }
}

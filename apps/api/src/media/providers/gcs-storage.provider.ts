import { Injectable, Logger } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import {
  DeliveryUrlParams,
  ObjectVerificationResult,
  SignedUploadUrlResult,
  StorageProviderPort,
} from './storage-provider.port';

// Real Google Cloud Storage implementation. Uses Application Default
// Credentials only — never a service-account JSON key file. No credential
// material is ever read from or written to a file this repository tracks.
//
// VERIFIED AGAINST REAL GCS on 2026-08-17 (see
// _bmad-output/implementation-artifacts/2026-08-17-gcs-media-canary-results.md):
// upload, verify, signed-GET delivery, anonymous-access denial, and delete
// all confirmed against verdura-media-originals-d3794338b2 in
// australia-southeast1.
//
// V4 signed URLs require signing with a private key — plain ADC user
// credentials (`gcloud auth login`) or workload-identity metadata-server
// credentials have no private key and cannot sign locally
// ("Cannot sign data without `client_email`", reproduced during the canary
// run). The fix, discovered by that failure and applied here, is the
// standard keyless pattern: impersonate a service account via the IAM
// Credentials API (`signBlob`), which needs no key file, only the caller
// (human or workload identity) holding `roles/iam.serviceAccountTokenCreator`
// on the target service account — granted to both `khn.srwr707@gmail.com`
// (local dev) and to `verdura-media-api` on itself (future production
// workload identity) when this bucket was provisioned.
@Injectable()
export class GcsStorageProvider implements StorageProviderPort {
  private readonly logger = new Logger(GcsStorageProvider.name);
  private readonly storage: Promise<Storage>;

  constructor(
    projectId: string,
    /**
     * The service account this provider always signs as, regardless of
     * which broader identity the process itself is running under — keeps
     * every environment (a developer's own ADC locally, a future
     * workload-identity-bound Cloud Run service) acting with the same
     * least-privileged, bucket-scoped identity. Required: signing cannot
     * work without it (see class doc comment).
     */
    impersonateServiceAccountEmail: string,
  ) {
    this.storage = GcsStorageProvider.buildStorageClient(projectId, impersonateServiceAccountEmail);
  }

  private static async buildStorageClient(
    projectId: string,
    targetPrincipal: string,
  ): Promise<Storage> {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const sourceClient = await auth.getClient();
    const impersonated = new Impersonated({
      sourceClient,
      targetPrincipal,
      lifetime: 3600,
      delegates: [],
      targetScopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    return new Storage({ projectId, authClient: impersonated });
  }

  async generateSignedUploadUrl(params: {
    bucket: string;
    objectKey: string;
    contentType: string;
    maxSizeBytes: number;
    ttlSeconds: number;
    checksum: string;
  }): Promise<SignedUploadUrlResult> {
    const storage = await this.storage;
    const file = storage.bucket(params.bucket).file(params.objectKey);
    const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
    const checksumHeaderName = 'x-goog-meta-sha256';

    // V4 signed URL, PUT-only, single object, content-type AND the
    // declared checksum both pinned into the signature via
    // extensionHeaders — the client's PUT must include both headers
    // exactly or the signature fails closed, so a client can neither swap
    // the file type nor upload a different file than it declared. Size is
    // enforced server-side at verifyObject() time (V4 signing has no
    // native max-size clause) — an oversized upload is rejected and
    // deleted during validation, never treated as approved.
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType: params.contentType,
      extensionHeaders: { [checksumHeaderName]: params.checksum },
    });

    return {
      uploadUrl,
      bucket: params.bucket,
      objectKey: params.objectKey,
      expiresAt,
      requiredHeaders: {
        'Content-Type': params.contentType,
        [checksumHeaderName]: params.checksum,
      },
    };
  }

  async verifyObject(params: {
    bucket: string;
    objectKey: string;
  }): Promise<ObjectVerificationResult> {
    const storage = await this.storage;
    const file = storage.bucket(params.bucket).file(params.objectKey);
    const [exists] = await file.exists();
    if (!exists) {
      return { exists: false };
    }
    const [metadata] = await file.getMetadata();
    return {
      exists: true,
      sizeBytes: metadata.size !== undefined ? Number(metadata.size) : undefined,
      contentType: metadata.contentType ?? undefined,
      declaredChecksum: metadata.metadata?.['sha256'] as string | undefined,
    };
  }

  async generateDeliveryUrl(params: DeliveryUrlParams): Promise<string> {
    if (params.visibility === 'public') {
      // Only reached for an object already confirmed to live under the
      // approved public-delivery layout — see MediaAssetsService's
      // object-key generation. Never called for a private original.
      return `https://storage.googleapis.com/${params.bucket}/${params.objectKey}`;
    }
    const storage = await this.storage;
    const file = storage.bucket(params.bucket).file(params.objectKey);
    const ttl = params.ttlSeconds ?? 3600;
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttl * 1000,
    });
    return url;
  }

  /**
   * Server-side GCS-to-GCS copy (never re-uploads bytes through this
   * process) from the private originals bucket to the public-delivery
   * bucket, preserving the object key exactly. Sets a long-lived immutable
   * cache header on the destination only — the private original keeps
   * whatever (uncached) metadata it already had, since it is never served
   * directly to a browser.
   */
  async publishObject(params: {
    sourceBucket: string;
    destinationBucket: string;
    objectKey: string;
    contentType: string;
    checksum: string;
  }): Promise<void> {
    const storage = await this.storage;
    const source = storage.bucket(params.sourceBucket).file(params.objectKey);
    const destination = storage.bucket(params.destinationBucket).file(params.objectKey);
    await source.copy(destination);
    await destination.setMetadata({
      contentType: params.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: { sha256: params.checksum },
    });
  }

  async deleteObject(params: { bucket: string; objectKey: string }): Promise<void> {
    try {
      const storage = await this.storage;
      await storage.bucket(params.bucket).file(params.objectKey).delete({ ignoreNotFound: true });
    } catch (error) {
      // Deletion failures (rejected upload cleanup, archival) are logged,
      // not thrown — a failed best-effort cleanup must never block the
      // status transition that triggered it (e.g. marking an asset
      // `rejected` still succeeds even if the bucket delete errors).
      this.logger.warn(
        `Failed to delete gs://${params.bucket}/${params.objectKey}: ${(error as Error).message}`,
      );
    }
  }
}

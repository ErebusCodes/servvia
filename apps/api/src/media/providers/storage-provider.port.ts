// The provider abstraction MediaAssetsService depends on. Application code
// (the service, the controller, every future caller) talks to this
// interface only — it never imports `@google-cloud/storage` directly, so
// swapping the provider (or adding a second cloud provider later) never
// requires touching business logic. See GcsStorageProvider (production /
// any environment with GCS credentials) and LocalStorageProvider (dev/test,
// no external dependency) for the two current implementations.

export interface SignedUploadUrlResult {
  /** The URL the client PUTs the file body to directly — never proxied through the API. */
  uploadUrl: string;
  bucket: string;
  objectKey: string;
  expiresAt: Date;
  /** Headers the client's PUT must include for the signature to validate (e.g. Content-Type). */
  requiredHeaders: Record<string, string>;
}

export interface ObjectVerificationResult {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
  /**
   * The sha256 recorded as object metadata at upload time (see
   * `generateSignedUploadUrl`'s `checksum` param) — round-tripped exactly,
   * so MediaAssetsService can compare it byte-for-byte against the
   * checksum declared at request-upload time. Absent if the client
   * uploaded without the required metadata header, which fails
   * verification.
   */
  declaredChecksum?: string;
}

export interface DeliveryUrlParams {
  bucket: string;
  objectKey: string;
  visibility: 'private' | 'public';
  /** Required when visibility is 'private'; ignored for 'public'. */
  ttlSeconds?: number;
}

export const STORAGE_PROVIDER_PORT = Symbol('STORAGE_PROVIDER_PORT');

export interface StorageProviderPort {
  /**
   * Issues a short-lived, scope-restricted upload authorization for exactly
   * one object key. The caller (MediaAssetsService) generates the key —
   * this method never accepts a client-supplied key, so a client can never
   * choose an arbitrary bucket path.
   */
  generateSignedUploadUrl(params: {
    bucket: string;
    objectKey: string;
    contentType: string;
    maxSizeBytes: number;
    ttlSeconds: number;
    /**
     * The client-declared sha256, embedded as required object metadata so
     * it round-trips through the upload and can be exactly verified
     * afterward — GCS's own reported hash is MD5/CRC32C, a different
     * algorithm, so it cannot be compared to a sha256 directly.
     */
    checksum: string;
  }): Promise<SignedUploadUrlResult>;

  /** Server-side verification that the object exists and matches expectations — never trusts a client "I uploaded it" claim alone. */
  verifyObject(params: { bucket: string; objectKey: string }): Promise<ObjectVerificationResult>;

  /** Derives a delivery URL on demand. Never stored as a canonical value — see MediaAsset's schema comment. */
  generateDeliveryUrl(params: DeliveryUrlParams): Promise<string>;

  /**
   * The one explicit, authorised private→public promotion — server-side
   * copy only, never a client-directed write. The object key is preserved
   * unchanged between buckets (it already embeds the MediaAsset's own
   * immutable id — see buildObjectKey), so this never needs to invent a
   * second identity for the same asset. Must never be reachable for a
   * bucket the caller didn't already own via MediaAssetsService's own
   * organization/venue scoping — this method itself does no authorization,
   * that happens one layer up.
   */
  publishObject(params: {
    sourceBucket: string;
    destinationBucket: string;
    objectKey: string;
    contentType: string;
    checksum: string;
  }): Promise<void>;

  /** Used on rejection (failed validation) and archival (superseded/retired). */
  deleteObject(params: { bucket: string; objectKey: string }): Promise<void>;
}

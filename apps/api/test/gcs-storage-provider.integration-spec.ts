import { createHash } from 'crypto';
import { GcsStorageProvider } from '../src/media/providers/gcs-storage.provider';

// Real-GCS regression coverage for the defect found and fixed on
// 2026-08-17 (see this file's sibling .ts doc comment and
// _bmad-output/implementation-artifacts/2026-08-17-gcs-media-canary-results.md):
// plain ADC cannot sign V4 URLs; GcsStorageProvider must impersonate a
// service account via the IAM Credentials API instead. Skipped by default —
// requires real GCP credentials and a real bucket, which most contributors
// and CI will not have. Opt in explicitly:
//
//   GCS_INTEGRATION_TEST_BUCKET=verdura-media-originals-d3794338b2 \
//   GCS_INTEGRATION_TEST_PUBLIC_BUCKET=verdura-media-public-d3794338b2 \
//   GCS_INTEGRATION_TEST_PROJECT=project-10bd9c5c-d379-4338-8b2 \
//   GCS_INTEGRATION_TEST_SERVICE_ACCOUNT=verdura-media-api@project-10bd9c5c-d379-4338-8b2.iam.gserviceaccount.com \
//   npm run test:integration --workspace=apps/api
//
// Requires the runner's own ADC (`gcloud auth application-default login`)
// to hold roles/iam.serviceAccountTokenCreator on the target service
// account — see the bucket-provisioning record for how that was granted.
//
// Every object this file creates lives under the
// `venues/.../integration-test*` prefix and is deleted from BOTH buckets in
// afterEach — never touches the 46 real migrated menu-item assets.
const BUCKET = process.env.GCS_INTEGRATION_TEST_BUCKET;
const PUBLIC_BUCKET = process.env.GCS_INTEGRATION_TEST_PUBLIC_BUCKET;
const PROJECT = process.env.GCS_INTEGRATION_TEST_PROJECT;
const SERVICE_ACCOUNT = process.env.GCS_INTEGRATION_TEST_SERVICE_ACCOUNT;

const canRun = Boolean(BUCKET && PUBLIC_BUCKET && PROJECT && SERVICE_ACCOUNT);
const describeIfConfigured = canRun ? describe : describe.skip;

describeIfConfigured('GcsStorageProvider (real GCS integration)', () => {
  let provider: GcsStorageProvider;
  const objectKey = `venues/10000000-0000-4000-8000-000000000001/menu-items/integration-test/original/probe.txt`;

  beforeAll(() => {
    provider = new GcsStorageProvider(PROJECT as string, SERVICE_ACCOUNT as string);
  });

  afterEach(async () => {
    // Best-effort cleanup even if an assertion above failed mid-test — both
    // buckets, since publish tests below leave a copy in each.
    await provider.deleteObject({ bucket: BUCKET as string, objectKey });
    await provider.deleteObject({ bucket: PUBLIC_BUCKET as string, objectKey });
  });

  it('signs an upload URL, accepts a real PUT, and verifies the exact checksum and size', async () => {
    const body = Buffer.from(`integration probe ${Date.now()}`);
    const checksum = createHash('sha256').update(body).digest('hex');

    const signed = await provider.generateSignedUploadUrl({
      bucket: BUCKET as string,
      objectKey,
      contentType: 'text/plain',
      maxSizeBytes: 1024,
      ttlSeconds: 300,
      checksum,
    });

    const putRes = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.requiredHeaders,
      body,
    });
    expect(putRes.ok).toBe(true);

    const verification = await provider.verifyObject({ bucket: BUCKET as string, objectKey });
    expect(verification.exists).toBe(true);
    expect(verification.sizeBytes).toBe(body.byteLength);
    expect(verification.declaredChecksum).toBe(checksum);
  });

  it('verifyObject reports exists:false for a key that was never uploaded', async () => {
    const result = await provider.verifyObject({
      bucket: BUCKET as string,
      objectKey: `${objectKey}-never-uploaded`,
    });
    expect(result.exists).toBe(false);
  });

  it('a private object is retrievable via a signed GET but returns 403 to an anonymous request', async () => {
    const body = Buffer.from('private content');
    const checksum = createHash('sha256').update(body).digest('hex');
    const signed = await provider.generateSignedUploadUrl({
      bucket: BUCKET as string,
      objectKey,
      contentType: 'text/plain',
      maxSizeBytes: 1024,
      ttlSeconds: 300,
      checksum,
    });
    await fetch(signed.uploadUrl, { method: 'PUT', headers: signed.requiredHeaders, body });

    const deliveryUrl = await provider.generateDeliveryUrl({
      bucket: BUCKET as string,
      objectKey,
      visibility: 'private',
      ttlSeconds: 300,
    });
    const signedGetRes = await fetch(deliveryUrl);
    expect(signedGetRes.status).toBe(200);
    expect(await signedGetRes.text()).toBe(body.toString());

    // Proves public-access-prevention is actually enforced on the bucket,
    // not just assumed from its provisioning config.
    const anonymousRes = await fetch(`https://storage.googleapis.com/${BUCKET}/${objectKey}`);
    expect(anonymousRes.status).toBe(403);
  });

  it('deleteObject removes the object, and is safe to call again on an already-deleted object', async () => {
    const body = Buffer.from('to be deleted');
    const checksum = createHash('sha256').update(body).digest('hex');
    const signed = await provider.generateSignedUploadUrl({
      bucket: BUCKET as string,
      objectKey,
      contentType: 'text/plain',
      maxSizeBytes: 1024,
      ttlSeconds: 300,
      checksum,
    });
    await fetch(signed.uploadUrl, { method: 'PUT', headers: signed.requiredHeaders, body });

    await provider.deleteObject({ bucket: BUCKET as string, objectKey });
    const afterDelete = await provider.verifyObject({ bucket: BUCKET as string, objectKey });
    expect(afterDelete.exists).toBe(false);

    // Must not throw on a second delete of the same (already-gone) key.
    await expect(
      provider.deleteObject({ bucket: BUCKET as string, objectKey }),
    ).resolves.not.toThrow();
  });

  describe('publishObject (private → public promotion)', () => {
    it('copies the private original into the public bucket, anonymously readable there and nowhere else', async () => {
      const body = Buffer.from(`publish probe ${Date.now()}`);
      const checksum = createHash('sha256').update(body).digest('hex');

      const signed = await provider.generateSignedUploadUrl({
        bucket: BUCKET as string,
        objectKey,
        contentType: 'text/plain',
        maxSizeBytes: 1024,
        ttlSeconds: 300,
        checksum,
      });
      await fetch(signed.uploadUrl, { method: 'PUT', headers: signed.requiredHeaders, body });

      await provider.publishObject({
        sourceBucket: BUCKET as string,
        destinationBucket: PUBLIC_BUCKET as string,
        objectKey,
        contentType: 'text/plain',
        checksum,
      });

      const publicVerification = await provider.verifyObject({
        bucket: PUBLIC_BUCKET as string,
        objectKey,
      });
      expect(publicVerification.exists).toBe(true);
      expect(publicVerification.sizeBytes).toBe(body.byteLength);
      expect(publicVerification.declaredChecksum).toBe(checksum);

      // Anonymous GET on the public copy succeeds...
      const publicRes = await fetch(`https://storage.googleapis.com/${PUBLIC_BUCKET}/${objectKey}`);
      expect(publicRes.status).toBe(200);
      expect(await publicRes.text()).toBe(body.toString());

      // ...but the private original remains anonymously inaccessible —
      // publishing never made it (or the private bucket) public.
      const privateAnonymousRes = await fetch(
        `https://storage.googleapis.com/${BUCKET}/${objectKey}`,
      );
      expect(privateAnonymousRes.status).toBe(403);

      // Idempotent retry: publishing the same object key again must not
      // throw and must leave the public copy in the same verified state.
      await provider.publishObject({
        sourceBucket: BUCKET as string,
        destinationBucket: PUBLIC_BUCKET as string,
        objectKey,
        contentType: 'text/plain',
        checksum,
      });
      const secondVerification = await provider.verifyObject({
        bucket: PUBLIC_BUCKET as string,
        objectKey,
      });
      expect(secondVerification.exists).toBe(true);
      expect(secondVerification.declaredChecksum).toBe(checksum);
    });
  });
});

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { LocalStorageProvider } from './local-storage.provider';

// The one part of the GCS media architecture genuinely exercised
// end-to-end against real bytes in this session (no GCP credentials were
// available — see GcsStorageProvider's own doc comment). This proves
// MediaAssetsService's verification logic is correct when the provider
// tells the truth, using real disk I/O instead of a mock.
const PUBLIC_BUCKET = 'local-dev-media-public';

describe('LocalStorageProvider', () => {
  let root: string;
  let publicRoot: string;
  let provider: LocalStorageProvider;

  beforeEach(() => {
    root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'verdura-local-storage-test-'));
    publicRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'verdura-local-storage-public-test-'));
    provider = new LocalStorageProvider(root, publicRoot, 'http://localhost:3000', PUBLIC_BUCKET);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(publicRoot, { recursive: true, force: true });
  });

  it('generateSignedUploadUrl points at the local-dev-upload endpoint with the object key URL-encoded', async () => {
    const result = await provider.generateSignedUploadUrl({
      bucket: 'unused-for-local',
      objectKey: 'venues/v1/menu-items/m1/original/tiramisu.jpg',
      contentType: 'image/jpeg',
      maxSizeBytes: 1024,
      ttlSeconds: 900,
      checksum: 'a'.repeat(64),
    });
    expect(result.uploadUrl).toBe(
      'http://localhost:3000/api/admin/media-assets/local-dev-upload/venues%2Fv1%2Fmenu-items%2Fm1%2Foriginal%2Ftiramisu.jpg',
    );
  });

  it('verifyObject reports exists:false before any bytes are written', async () => {
    const result = await provider.verifyObject({
      bucket: 'x',
      objectKey: 'venues/v1/x/original/f.jpg',
    });
    expect(result.exists).toBe(false);
  });

  it('round-trips real bytes: write → verify reports the exact sha256 and size', async () => {
    const body = Buffer.from('fake-jpeg-bytes-for-test');
    const objectKey = 'venues/v1/menu-items/m1/original/tiramisu.jpg';
    const expectedChecksum = createHash('sha256').update(body).digest('hex');

    await provider.writeLocal(objectKey, body);
    const result = await provider.verifyObject({ bucket: 'x', objectKey });

    expect(result.exists).toBe(true);
    expect(result.sizeBytes).toBe(body.byteLength);
    expect(result.declaredChecksum).toBe(expectedChecksum);
  });

  it('deleteObject removes the file; a subsequent verifyObject reports exists:false', async () => {
    const objectKey = 'venues/v1/menu-items/m1/original/tiramisu.jpg';
    await provider.writeLocal(objectKey, Buffer.from('bytes'));
    await provider.deleteObject({ bucket: 'x', objectKey });
    const result = await provider.verifyObject({ bucket: 'x', objectKey });
    expect(result.exists).toBe(false);
  });

  it('deleteObject on a nonexistent object does not throw (best-effort cleanup)', async () => {
    await expect(
      provider.deleteObject({
        bucket: 'x',
        objectKey: 'venues/v1/menu-items/never-written/original/f.jpg',
      }),
    ).resolves.not.toThrow();
  });

  it('refuses to resolve an object key that attempts to escape the storage root', async () => {
    await expect(
      provider.verifyObject({ bucket: 'x', objectKey: '../../../etc/passwd' }),
    ).rejects.toThrow(/outside local media root/);
  });

  describe('publishObject / readPublic', () => {
    const objectKey = 'venues/v1/menu-items/m1/original/tiramisu.jpg';

    it('copies bytes from the private root into the public root, leaving the private original intact', async () => {
      const body = Buffer.from('fake-jpeg-bytes-for-test');
      await provider.writeLocal(objectKey, body);

      await provider.publishObject({
        sourceBucket: 'local-dev-media',
        destinationBucket: PUBLIC_BUCKET,
        objectKey,
        contentType: 'image/jpeg',
        checksum: createHash('sha256').update(body).digest('hex'),
      });

      const published = await provider.readPublic(objectKey);
      expect(published?.equals(body)).toBe(true);

      // Private verifyObject (bucket name != publicBucketName) still sees
      // the untouched private original.
      const privateResult = await provider.verifyObject({ bucket: 'local-dev-media', objectKey });
      expect(privateResult.exists).toBe(true);
    });

    it('verifyObject against the public bucket name reports exists:false before publishObject runs', async () => {
      const result = await provider.verifyObject({ bucket: PUBLIC_BUCKET, objectKey });
      expect(result.exists).toBe(false);
    });

    it('verifyObject against the public bucket name reports the published object after publishObject runs', async () => {
      const body = Buffer.from('fake-jpeg-bytes-for-test');
      await provider.writeLocal(objectKey, body);
      await provider.publishObject({
        sourceBucket: 'local-dev-media',
        destinationBucket: PUBLIC_BUCKET,
        objectKey,
        contentType: 'image/jpeg',
        checksum: createHash('sha256').update(body).digest('hex'),
      });

      const result = await provider.verifyObject({ bucket: PUBLIC_BUCKET, objectKey });
      expect(result.exists).toBe(true);
      expect(result.declaredChecksum).toBe(createHash('sha256').update(body).digest('hex'));
    });

    it('readPublic returns null for an object that was never published', async () => {
      const result = await provider.readPublic('venues/v1/menu-items/never/original/f.jpg');
      expect(result).toBeNull();
    });

    it('generateDeliveryUrl for public visibility points at the real local public-serving route', async () => {
      const url = await provider.generateDeliveryUrl({
        bucket: PUBLIC_BUCKET,
        objectKey,
        visibility: 'public',
      });
      expect(url).toBe(
        'http://localhost:3000/api/media-assets/public/venues%2Fv1%2Fmenu-items%2Fm1%2Foriginal%2Ftiramisu.jpg',
      );
    });
  });
});

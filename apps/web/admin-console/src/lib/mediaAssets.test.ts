import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = {
  get: vi.fn(),
  post: vi.fn(),
};

vi.mock('./api', () => ({ api: apiMock }));

const {
  validateMenuImageFile,
  uploadAndPublishMenuImage,
  associateMenuItem,
  archiveAsset,
  ClientValidationError,
  UploadCancelledError,
} = await import('./mediaAssets');

/** Resolves once `resolve()` is called externally — lets a test control
 *  exactly when a mocked request "completes", independent of call order
 *  (same helper pattern as menu.store.test.ts). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  const bytes = sizeBytes > 0 ? new Uint8Array(sizeBytes) : new Uint8Array(0);
  return new File([bytes], name, { type });
}

// jsdom's Image never actually decodes anything — stub it so
// validateMenuImageFile's decodability check is deterministic per test.
let nextImageOutcome: 'load' | 'error' = 'load';
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 10;
  naturalHeight = 10;
  set src(_value: string) {
    queueMicrotask(() => {
      if (nextImageOutcome === 'load') this.onload?.();
      else this.onerror?.();
    });
  }
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  nextImageOutcome = 'load';
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('fetch', vi.fn());
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateMenuImageFile (client-side usability check)', () => {
  it('rejects an unsupported MIME type', async () => {
    await expect(validateMenuImageFile(makeFile('a.gif', 'image/gif', 100))).rejects.toBeInstanceOf(
      ClientValidationError,
    );
  });

  it('rejects an empty file', async () => {
    await expect(validateMenuImageFile(makeFile('a.jpg', 'image/jpeg', 0))).rejects.toBeInstanceOf(
      ClientValidationError,
    );
  });

  it('rejects a file over 5MB', async () => {
    await expect(
      validateMenuImageFile(makeFile('a.jpg', 'image/jpeg', 6 * 1024 * 1024)),
    ).rejects.toBeInstanceOf(ClientValidationError);
  });

  it('rejects a file that cannot be decoded as an image (e.g. HTML disguised with an image MIME type)', async () => {
    nextImageOutcome = 'error';
    await expect(validateMenuImageFile(makeFile('a.jpg', 'image/jpeg', 100))).rejects.toBeInstanceOf(
      ClientValidationError,
    );
  });

  it('accepts a well-formed, decodable JPEG under the size limit', async () => {
    await expect(validateMenuImageFile(makeFile('a.jpg', 'image/jpeg', 1024))).resolves.toBeUndefined();
  });
});

describe('uploadAndPublishMenuImage (request-upload → PUT → finalize → publish → delivery-url)', () => {
  const file = makeFile('tiramisu.jpg', 'image/jpeg', 1024);

  it('runs every step in the exact required order and never touches the legacy /api/admin/media endpoint', async () => {
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/api/admin/media-assets/request-upload') {
        return Promise.resolve({
          data: {
            mediaAssetId: 'asset-1',
            reused: false,
            uploadUrl: 'https://storage.example/signed-put',
            requiredHeaders: { 'Content-Type': 'image/jpeg' },
          },
        });
      }
      if (url === '/api/admin/media-assets/asset-1/finalize') {
        return Promise.resolve({ data: { id: 'asset-1', status: 'approved', visibility: 'private' } });
      }
      if (url === '/api/admin/media-assets/asset-1/publish') {
        return Promise.resolve({ data: { id: 'asset-1', status: 'approved', visibility: 'public' } });
      }
      throw new Error(`unexpected POST ${url}`);
    });
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/api/admin/media-assets/asset-1/delivery-url') {
        return Promise.resolve({ data: { url: 'https://public.example/tiramisu.jpg', asset: {} } });
      }
      throw new Error(`unexpected GET ${url}`);
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const stages: string[] = [];
    const result = await uploadAndPublishMenuImage(file, { venueId: 'venue-1' }, (s) => stages.push(s));

    expect(result).toEqual({ mediaAssetId: 'asset-1', publicUrl: 'https://public.example/tiramisu.jpg' });
    expect(stages).toEqual([
      'validating',
      'requesting_upload',
      'uploading',
      'finalizing',
      'ready_for_publication',
      'publishing',
      'published',
    ]);

    // Sequencing: request-upload happens before the PUT; finalize happens
    // after the PUT; publish happens after finalize.
    const postUrls = apiMock.post.mock.calls.map((c) => c[0]);
    expect(postUrls).toEqual([
      '/api/admin/media-assets/request-upload',
      '/api/admin/media-assets/asset-1/finalize',
      '/api/admin/media-assets/asset-1/publish',
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'https://storage.example/signed-put',
      expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } }),
    );

    // No legacy local-disk upload endpoint anywhere in this call graph.
    expect(postUrls.some((u) => u.startsWith('/api/admin/media/'))).toBe(false);
  });

  it('skips the PUT and finalize round-trip entirely when the server reuses an already-approved asset (checksum dedup)', async () => {
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/api/admin/media-assets/request-upload') {
        return Promise.resolve({ data: { mediaAssetId: 'asset-existing', reused: true } });
      }
      if (url === '/api/admin/media-assets/asset-existing/publish') {
        return Promise.resolve({ data: { id: 'asset-existing', status: 'approved', visibility: 'public' } });
      }
      throw new Error(`unexpected POST ${url}`);
    });
    apiMock.get.mockResolvedValue({ data: { url: 'https://public.example/reused.jpg', asset: {} } });

    const stages: string[] = [];
    await uploadAndPublishMenuImage(file, { venueId: 'venue-1' }, (s) => stages.push(s));

    expect(fetch).not.toHaveBeenCalled();
    const postUrls = apiMock.post.mock.calls.map((c) => c[0]);
    expect(postUrls).not.toContain('/api/admin/media-assets/asset-existing/finalize');
    expect(stages).not.toContain('uploading');
    expect(stages).not.toContain('finalizing');
  });

  it('throws and never calls finalize when the signed PUT fails (e.g. expired URL)', async () => {
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/api/admin/media-assets/request-upload') {
        return Promise.resolve({
          data: {
            mediaAssetId: 'asset-1',
            reused: false,
            uploadUrl: 'https://storage.example/signed-put',
            requiredHeaders: { 'Content-Type': 'image/jpeg' },
          },
        });
      }
      throw new Error(`unexpected POST ${url}`);
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 403 });

    await expect(
      uploadAndPublishMenuImage(file, { venueId: 'venue-1' }, () => {}),
    ).rejects.toThrow('upload_failed_403');

    const postUrls = apiMock.post.mock.calls.map((c) => c[0]);
    expect(postUrls).toEqual(['/api/admin/media-assets/request-upload']);
  });

  it('throws and never calls publish when server-side finalize verification rejects the object', async () => {
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/api/admin/media-assets/request-upload') {
        return Promise.resolve({
          data: {
            mediaAssetId: 'asset-1',
            reused: false,
            uploadUrl: 'https://storage.example/signed-put',
            requiredHeaders: { 'Content-Type': 'image/jpeg' },
          },
        });
      }
      if (url === '/api/admin/media-assets/asset-1/finalize') {
        return Promise.resolve({ data: { id: 'asset-1', status: 'rejected', visibility: 'private' } });
      }
      throw new Error(`unexpected POST ${url}`);
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await expect(
      uploadAndPublishMenuImage(file, { venueId: 'venue-1' }, () => {}),
    ).rejects.toThrow('verification_failed');

    const postUrls = apiMock.post.mock.calls.map((c) => c[0]);
    expect(postUrls).not.toContain('/api/admin/media-assets/asset-1/publish');
  });

  it('throws and never calls delivery-url when the server rejects publication (post-copy verification failed)', async () => {
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/api/admin/media-assets/request-upload') {
        return Promise.resolve({
          data: {
            mediaAssetId: 'asset-1',
            reused: false,
            uploadUrl: 'https://storage.example/signed-put',
            requiredHeaders: { 'Content-Type': 'image/jpeg' },
          },
        });
      }
      if (url === '/api/admin/media-assets/asset-1/finalize') {
        return Promise.resolve({ data: { id: 'asset-1', status: 'approved', visibility: 'private' } });
      }
      if (url === '/api/admin/media-assets/asset-1/publish') {
        // Still private — MediaAssetsService.publishAsset only flips
        // visibility after its own post-copy verification passes; a
        // failed verification returns/throws without flipping it.
        return Promise.resolve({ data: { id: 'asset-1', status: 'approved', visibility: 'private' } });
      }
      throw new Error(`unexpected POST ${url}`);
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await expect(
      uploadAndPublishMenuImage(file, { venueId: 'venue-1' }, () => {}),
    ).rejects.toThrow('publish_failed');

    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('is cancellable mid-flight: aborting after request-upload responds stops before finalize/publish run', async () => {
    const controller = new AbortController();
    const requestUploadResp = deferred<{ data: unknown }>();
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/api/admin/media-assets/request-upload') return requestUploadResp.promise;
      throw new Error(`unexpected POST ${url} after cancellation`);
    });

    const runPromise = uploadAndPublishMenuImage(
      file,
      { venueId: 'venue-1', signal: controller.signal },
      () => {},
    );

    controller.abort();
    requestUploadResp.resolve({
      data: {
        mediaAssetId: 'asset-1',
        reused: false,
        uploadUrl: 'https://storage.example/signed-put',
        requiredHeaders: { 'Content-Type': 'image/jpeg' },
      },
    });

    await expect(runPromise).rejects.toBeInstanceOf(UploadCancelledError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('associateMenuItem / archiveAsset', () => {
  it('associateMenuItem posts to the venue/asset-scoped association endpoint with the menuItemId in the body', async () => {
    apiMock.post.mockResolvedValue({
      data: { menuItem: { id: 'item-1', imageUrl: 'https://public.example/x.jpg' }, mediaAsset: {} },
    });
    const result = await associateMenuItem('asset-1', 'item-1');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/admin/media-assets/asset-1/associate-menu-item',
      { menuItemId: 'item-1' },
      expect.anything(),
    );
    expect(result.menuItem.imageUrl).toBe('https://public.example/x.jpg');
  });

  it('archiveAsset posts to the archive endpoint', async () => {
    apiMock.post.mockResolvedValue({ data: { id: 'asset-1', status: 'archived' } });
    await archiveAsset('asset-1');
    expect(apiMock.post).toHaveBeenCalledWith('/api/admin/media-assets/asset-1/archive');
  });
});

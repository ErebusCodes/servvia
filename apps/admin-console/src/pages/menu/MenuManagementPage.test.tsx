import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock('../../lib/api', () => ({ api: apiMock }));

vi.mock('../../store/reservation.store', () => ({
  resolveVenueId: vi.fn().mockResolvedValue('venue-1'),
}));

vi.mock('../../lib/mediaAssets', async () => {
  const actual = await vi.importActual<typeof import('../../lib/mediaAssets')>('../../lib/mediaAssets');
  return {
    ...actual,
    uploadAndPublishMenuImage: vi.fn(),
    associateMenuItem: vi.fn(),
    archiveAsset: vi.fn().mockResolvedValue({}),
  };
});

const { useMenuStore } = await import('../../store/menu.store');
const { uploadAndPublishMenuImage, associateMenuItem, archiveAsset, UploadCancelledError } = await import(
  '../../lib/mediaAssets'
);
const { MenuManagementPage } = await import('./MenuManagementPage');
type UploadStage = Parameters<Parameters<typeof uploadAndPublishMenuImage>[2]>[0];

function seedStore() {
  useMenuStore.setState({
    categories: [
      {
        id: 'cat-1',
        name: 'Mains',
        description: null,
        imageUrl: null,
        sortOrder: 0,
        isActive: true,
        subs: [],
      },
    ],
    items: [],
    setCategories: vi.fn().mockResolvedValue(undefined),
    setItems: vi.fn().mockResolvedValue(undefined),
    fetchMenu: vi.fn().mockResolvedValue(undefined),
    loading: false,
    loaded: true,
    error: null,
  } as never);
}

function makeFile(name = 'tiramisu.jpg'): File {
  return new File([new Uint8Array(1024)], name, { type: 'image/jpeg' });
}

/** Resolves once `resolve()` is called externally — lets a test control
 *  exactly when a mocked upload "completes", independent of call order
 *  (same helper pattern as mediaAssets.test.ts). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function seedExistingItem() {
  useMenuStore.setState({
    items: [
      {
        id: 'item-1',
        categoryId: 'cat-1',
        subCategory: null,
        title: 'Tiramisu',
        description: 'Classic.',
        imageUrl: 'https://public.example/old-tiramisu.jpg',
        price: '12.00',
        nutritionalDetails: {},
        isSpicy: false,
        isAvailable: true,
        sortOrder: 0,
      },
    ],
  } as never);
}

beforeEach(() => {
  seedStore();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  vi.mocked(uploadAndPublishMenuImage).mockReset();
  vi.mocked(associateMenuItem).mockReset();
  vi.mocked(archiveAsset).mockReset().mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe('MenuManagementPage — new-image upload flow', () => {
  it('never calls the legacy /api/admin/media endpoint through any store call, keeps the old image until publish resolves, and only then updates the field', async () => {
    let capturedOnStage: ((stage: UploadStage) => void) | undefined;
    let resolveUpload!: (v: { mediaAssetId: string; publicUrl: string }) => void;
    vi.mocked(uploadAndPublishMenuImage).mockImplementation(
      (_file, _opts, onStage) =>
        new Promise((resolve) => {
          capturedOnStage = onStage;
          resolveUpload = resolve;
        }),
    );

    render(<MenuManagementPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add item/i }));

    const fileInput = screen.getByLabelText(/choose item image/i) as HTMLInputElement;
    const urlInput = screen.getByLabelText(/item image url/i) as HTMLInputElement;
    expect(urlInput.value).toBe('');

    fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    // Mid-flight: report a couple of stages and confirm the truthful status
    // announcement updates, the field is NOT populated yet, and Save is
    // disabled (never lets the drawer report success before publication).
    await waitFor(() => expect(uploadAndPublishMenuImage).toHaveBeenCalledTimes(1));
    capturedOnStage?.('uploading');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/uploading/i));
    expect(urlInput.value).toBe('');
    expect(screen.getByRole('button', { name: /waiting for image/i })).toBeDisabled();

    // Now the upload+publish pipeline actually completes.
    resolveUpload({ mediaAssetId: 'asset-1', publicUrl: 'https://public.example/tiramisu.jpg' });
    await waitFor(() => expect(urlInput.value).toBe('https://public.example/tiramisu.jpg'));

    // New item (no editId yet) — the verified association endpoint is not
    // reachable against a MenuItem that doesn't exist yet; the delivery URL
    // is carried directly into the create payload instead.
    expect(associateMenuItem).not.toHaveBeenCalled();

    // Nothing anywhere in this flow ever touched the legacy per-folder
    // local-disk upload endpoint.
    const allUrls = [...apiMock.post.mock.calls, ...apiMock.get.mock.calls].map((c) => c[0]);
    expect(allUrls.some((u: string) => u.startsWith('/api/admin/media/'))).toBe(false);
  });

  it('associates through the verified endpoint (not a raw PATCH) when replacing an existing item image', async () => {
    useMenuStore.setState({
      items: [
        {
          id: 'item-1',
          categoryId: 'cat-1',
          subCategory: null,
          title: 'Tiramisu',
          description: 'Classic.',
          imageUrl: '/menu-images/old-tiramisu.jpg',
          price: '12.00',
          nutritionalDetails: {},
          isSpicy: false,
          isAvailable: true,
          sortOrder: 0,
        },
      ],
    } as never);

    vi.mocked(uploadAndPublishMenuImage).mockResolvedValue({
      mediaAssetId: 'asset-2',
      publicUrl: 'https://public.example/new-tiramisu.jpg',
    });
    vi.mocked(associateMenuItem).mockResolvedValue({
      menuItem: { id: 'item-1', imageUrl: 'https://public.example/new-tiramisu.jpg' },
      mediaAsset: { id: 'asset-2', status: 'approved', visibility: 'public', objectKey: '', mimeType: '', sizeBytes: 0, checksum: '' },
    });

    render(<MenuManagementPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: /edit item/i }))[0]);
    const fileInput = await screen.findByLabelText(/choose item image/i);
    fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    await waitFor(() => expect(associateMenuItem).toHaveBeenCalledWith('asset-2', 'item-1', expect.anything()));

    const urlInput = screen.getByLabelText(/item image url/i) as HTMLInputElement;
    await waitFor(() => expect(urlInput.value).toBe('https://public.example/new-tiramisu.jpg'));
  });

  it('preserves the existing image, shows a truthful (non-leaking) error, and re-enables Save when the pipeline fails after selection', async () => {
    seedExistingItem();
    vi.mocked(uploadAndPublishMenuImage).mockRejectedValue(
      new Error('publish_failed: signed-url query string leaked in a real bug would appear here'),
    );

    render(<MenuManagementPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: /edit item/i }))[0]);
    const fileInput = await screen.findByLabelText(/choose item image/i);
    const urlInput = screen.getByLabelText(/item image url/i) as HTMLInputElement;
    expect(urlInput.value).toBe('https://public.example/old-tiramisu.jpg');

    fireEvent.change(fileInput, { target: { files: [makeFile()] } });
    await waitFor(() => expect(uploadAndPublishMenuImage).toHaveBeenCalledTimes(1));

    // The old image must never be replaced by a failure, and the generic
    // provider/network error message shown to the user must never contain
    // the underlying error's raw text (which could carry a signed URL,
    // object key, or other internal detail).
    await waitFor(() => expect(urlInput.value).toBe('https://public.example/old-tiramisu.jpg'));
    expect(associateMenuItem).not.toHaveBeenCalled();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/signed-url|query string|publish_failed/i);
    expect(alert.textContent).toMatch(/upload failed/i);

    // Save must be re-enabled after the failure, not stuck disabled.
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('archives the now-orphaned published asset (best-effort) when association fails after publish, and still preserves the old image', async () => {
    seedExistingItem();
    vi.mocked(uploadAndPublishMenuImage).mockResolvedValue({
      mediaAssetId: 'asset-3',
      publicUrl: 'https://public.example/new-tiramisu.jpg',
    });
    vi.mocked(associateMenuItem).mockRejectedValue(new Error('network error'));

    render(<MenuManagementPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: /edit item/i }))[0]);
    const fileInput = await screen.findByLabelText(/choose item image/i);
    const urlInput = screen.getByLabelText(/item image url/i) as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    await waitFor(() => expect(archiveAsset).toHaveBeenCalledWith('asset-3'));
    // The old image is preserved — the publish succeeded, but since it was
    // never associated with this MenuItem, the field must not change.
    expect(urlInput.value).toBe('https://public.example/old-tiramisu.jpg');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('a slower, earlier selection resolving after a newer one cannot overwrite the newer selection\'s result (stale-response protection)', async () => {
    seedExistingItem();
    const first = deferred<{ mediaAssetId: string; publicUrl: string }>();
    const second = deferred<{ mediaAssetId: string; publicUrl: string }>();
    vi.mocked(uploadAndPublishMenuImage)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.mocked(associateMenuItem).mockImplementation((mediaAssetId) =>
      Promise.resolve({
        menuItem: { id: 'item-1', imageUrl: `https://public.example/${mediaAssetId}.jpg` },
        mediaAsset: { id: mediaAssetId, status: 'approved', visibility: 'public', objectKey: '', mimeType: '', sizeBytes: 0, checksum: '' },
      }),
    );

    render(<MenuManagementPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: /edit item/i }))[0]);
    const fileInput = await screen.findByLabelText(/choose item image/i);
    const urlInput = screen.getByLabelText(/item image url/i) as HTMLInputElement;

    // Select file A, then — before it resolves — select file B. B's
    // request supersedes A's (a real AbortController.abort() fires on A).
    fireEvent.change(fileInput, { target: { files: [makeFile('a.jpg')] } });
    await waitFor(() => expect(uploadAndPublishMenuImage).toHaveBeenCalledTimes(1));
    fireEvent.change(fileInput, { target: { files: [makeFile('b.jpg')] } });
    await waitFor(() => expect(uploadAndPublishMenuImage).toHaveBeenCalledTimes(2));

    // B resolves first (simulating A being the slower request).
    second.resolve({ mediaAssetId: 'asset-b', publicUrl: 'https://public.example/b.jpg' });
    await waitFor(() => expect(urlInput.value).toBe('https://public.example/asset-b.jpg'));

    // A's stale response finally arrives — it must be silently ignored,
    // never overwriting B's already-applied result.
    first.resolve({ mediaAssetId: 'asset-a', publicUrl: 'https://public.example/a.jpg' });
    await new Promise((r) => setTimeout(r, 0));
    expect(urlInput.value).toBe('https://public.example/asset-b.jpg');
    expect(associateMenuItem).not.toHaveBeenCalledWith('asset-a', expect.anything(), expect.anything());
  });

  it('cancelling an in-flight upload restores the previous image, exits the busy state, and re-enables Save', async () => {
    seedExistingItem();
    let capturedSignal: AbortSignal | undefined;
    // Mirrors what the real uploadAndPublishMenuImage does: report an
    // in-progress stage (so the drawer's own Cancel-upload button — not the
    // drawer's unrelated close/"Cancel" button — actually renders), then
    // reject with UploadCancelledError once its AbortSignal actually
    // fires, rather than hanging forever.
    vi.mocked(uploadAndPublishMenuImage).mockImplementation(
      (_file, opts, onStage) =>
        new Promise((_resolve, reject) => {
          capturedSignal = opts.signal;
          onStage('uploading');
          opts.signal?.addEventListener('abort', () => reject(new UploadCancelledError()));
        }),
    );

    render(<MenuManagementPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: /edit item/i }))[0]);
    const fileInput = await screen.findByLabelText(/choose item image/i);
    const urlInput = screen.getByLabelText(/item image url/i) as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [makeFile()] } });
    await waitFor(() => expect(uploadAndPublishMenuImage).toHaveBeenCalledTimes(1));

    // Two buttons are named exactly "Cancel": the upload-cancel button next
    // to the image picker (rendered first, in the body) and the drawer's
    // unrelated close button (rendered last, in the footer) — pick the
    // upload one by DOM order rather than assume there is only one match.
    const cancelButtons = await screen.findAllByRole('button', { name: /^cancel$/i });
    expect(cancelButtons).toHaveLength(2);
    fireEvent.click(cancelButtons[0]);

    // A real AbortController.abort() must actually have fired on the
    // signal handed to uploadAndPublishMenuImage — cancellation must be
    // reachable, not merely a UI state flip with no real effect.
    expect(capturedSignal?.aborted).toBe(true);

    // The old image is untouched, the busy UI is gone, and Save works
    // again — even though the mocked promise never actually resolved.
    expect(urlInput.value).toBe('https://public.example/old-tiramisu.jpg');
    await waitFor(() => expect(screen.getByRole('button', { name: /replace image/i })).toBeInTheDocument());
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('exposes an accessible, keyboard-reachable file picker and status region', async () => {
    render(<MenuManagementPage />);
    fireEvent.click(await screen.findByRole('button', { name: /add item/i }));

    const fileInput = screen.getByLabelText(/choose item image/i);
    expect(fileInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(screen.getByRole('status')).toBeInTheDocument();

    const pickButton = screen.getByRole('button', { name: /upload image/i });
    expect(pickButton.tagName).toBe('BUTTON'); // natively focusable/keyboard-operable
  });
});

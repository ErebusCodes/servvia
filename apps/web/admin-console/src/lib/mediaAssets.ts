// Provider-neutral client for the MediaAsset upload/publish pipeline
// (apps/api/src/media/media-assets.*). Never imports GCS or local-provider
// specifics — every response here is already provider-neutral JSON, so this
// file (and anything that calls it) has no idea whether MEDIA_STORAGE_PROVIDER
// is 'gcs' or 'local'. See _bmad-output/implementation-artifacts for the
// story that introduced this ("Wire Admin Console Media Uploads to the
// MediaAsset Pipeline").
import { api } from './api';

export type MediaAssetPurpose =
  | 'menu_item'
  | 'category'
  | 'promotion'
  | 'venue_gallery'
  | 'branding'
  | 'video'
  | 'document';

export type MediaAssetStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'validating'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'archived';

export interface MediaAssetResponse {
  id: string;
  status: MediaAssetStatus;
  visibility: 'private' | 'public';
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export interface RequestUploadResponse {
  mediaAssetId: string;
  reused: boolean;
  uploadUrl?: string;
  requiredHeaders?: Record<string, string>;
  expiresAt?: string;
}

/** UI-facing lifecycle — a superset of the backend's MediaAssetStatus enum
 * values ('validating' is shared) plus the client-side-only stages
 * (requesting_upload/uploading/finalizing/ready_for_publication/publishing/
 * published/cancelled) that don't correspond to a persisted row, so the UI
 * never has to invent a fake backend status for "the PUT is in flight." */
export type UploadStage =
  | 'idle'
  | 'validating'
  | 'requesting_upload'
  | 'uploading'
  | 'finalizing'
  | 'ready_for_publication'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

export class UploadCancelledError extends Error {
  constructor() {
    super('upload_cancelled');
    this.name = 'UploadCancelledError';
  }
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // Some File/Blob polyfills (observed under jsdom on Node 20, the exact
  // version this repo's CI pins) return an ArrayBuffer-like object from a
  // different realm than the global `ArrayBuffer`, which fails
  // SubtleCrypto's strict instanceof check even though the bytes are
  // perfectly valid. Re-wrapping through Uint8Array normalizes that without
  // changing behavior for a real ArrayBuffer.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buf));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decodability check: browsers refuse to decode HTML/scripts/garbage
 * disguised with an image MIME type — this catches that class of spoof
 * client-side (server-side MIME/size/checksum validation is authoritative;
 * this is a usability check only). */
export function isImageDecodable(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

async function requestUpload(
  params: {
    venueId: string;
    purpose: MediaAssetPurpose;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
    altText?: string;
  },
  signal?: AbortSignal,
): Promise<RequestUploadResponse> {
  const { data } = await api.post<RequestUploadResponse>('/api/admin/media-assets/request-upload', params, {
    signal,
  });
  return data;
}

async function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers, body: file, signal });
  if (!res.ok) {
    throw new Error(`upload_failed_${res.status}`);
  }
}

async function finalizeUpload(mediaAssetId: string, signal?: AbortSignal): Promise<MediaAssetResponse> {
  const { data } = await api.post<MediaAssetResponse>(
    `/api/admin/media-assets/${mediaAssetId}/finalize`,
    undefined,
    { signal },
  );
  return data;
}

async function publishAsset(mediaAssetId: string, signal?: AbortSignal): Promise<MediaAssetResponse> {
  const { data } = await api.post<MediaAssetResponse>(
    `/api/admin/media-assets/${mediaAssetId}/publish`,
    undefined,
    { signal },
  );
  return data;
}

export async function getDeliveryUrl(
  mediaAssetId: string,
  signal?: AbortSignal,
): Promise<{ url: string; asset: MediaAssetResponse }> {
  const { data } = await api.get<{ url: string; asset: MediaAssetResponse }>(
    `/api/admin/media-assets/${mediaAssetId}/delivery-url`,
    { signal },
  );
  return data;
}

export interface AssociateMenuItemResult {
  menuItem: { id: string; imageUrl: string | null };
  mediaAsset: MediaAssetResponse;
}

/** The verified, audited path from an already-published MediaAsset onto an
 * EXISTING MenuItem — never touches an item that doesn't already exist.
 * See MediaAssetsService.associateWithMenuItem for the server-side
 * enforcement this wraps. */
export async function associateMenuItem(
  mediaAssetId: string,
  menuItemId: string,
  signal?: AbortSignal,
): Promise<AssociateMenuItemResult> {
  const { data } = await api.post<AssociateMenuItemResult>(
    `/api/admin/media-assets/${mediaAssetId}/associate-menu-item`,
    { menuItemId },
    { signal },
  );
  return data;
}

export async function archiveAsset(mediaAssetId: string): Promise<MediaAssetResponse> {
  const { data } = await api.post<MediaAssetResponse>(`/api/admin/media-assets/${mediaAssetId}/archive`);
  return data;
}

export interface MenuImageUploadResult {
  mediaAssetId: string;
  /** The verified public delivery URL — only ever populated once
   * publishAsset has actually returned visibility:'public'. */
  publicUrl: string;
}

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class ClientValidationError extends Error {}

/** Usability-only client validation — the server independently repeats
 * every one of these checks (MIME allowlist, size, non-empty, checksum) in
 * MediaAssetsService.requestUpload / finalizeUpload; nothing here is ever
 * trusted as authoritative. */
export async function validateMenuImageFile(file: File): Promise<void> {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
    throw new ClientValidationError('Unsupported file type. Please choose a JPG, PNG, or WebP image.');
  }
  if (file.size === 0) {
    throw new ClientValidationError('That file is empty. Please choose a valid image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ClientValidationError('Image is too large. Please choose a file under 5MB.');
  }
  const decodable = await isImageDecodable(file);
  if (!decodable) {
    throw new ClientValidationError('This file could not be read as an image. Please choose a different file.');
  }
}

/**
 * Runs the full request-upload → PUT → finalize → publish → delivery-url
 * sequence for one menu-item image, reporting truthful UI states along the
 * way via onStage. Never resolves 'published' unless the object has been
 * server-verified twice (finalize's checksum/size check, then publish's
 * post-copy verification) — the caller must not treat any earlier stage as
 * success.
 */
export async function uploadAndPublishMenuImage(
  file: File,
  opts: { venueId: string; altText?: string; signal?: AbortSignal },
  onStage: (stage: UploadStage) => void,
): Promise<MenuImageUploadResult> {
  const throwIfAborted = () => {
    if (opts.signal?.aborted) throw new UploadCancelledError();
  };

  onStage('validating');
  await validateMenuImageFile(file);
  const checksum = await sha256Hex(file);
  throwIfAborted();

  onStage('requesting_upload');
  const req = await requestUpload(
    {
      venueId: opts.venueId,
      purpose: 'menu_item',
      originalFilename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      checksum,
      altText: opts.altText,
    },
    opts.signal,
  );
  throwIfAborted();

  const mediaAssetId = req.mediaAssetId;

  if (!req.reused) {
    if (!req.uploadUrl || !req.requiredHeaders) {
      throw new Error('server did not return an upload target');
    }
    onStage('uploading');
    try {
      await uploadToSignedUrl(req.uploadUrl, file, req.requiredHeaders, opts.signal);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') throw new UploadCancelledError();
      throw err;
    }
    throwIfAborted();

    onStage('finalizing');
    const finalized = await finalizeUpload(mediaAssetId, opts.signal);
    if (finalized.status !== 'approved') {
      throw new Error('verification_failed');
    }
  }
  throwIfAborted();

  onStage('ready_for_publication');
  onStage('publishing');
  const published = await publishAsset(mediaAssetId, opts.signal);
  if (published.visibility !== 'public') {
    throw new Error('publish_failed');
  }
  throwIfAborted();

  const { url } = await getDeliveryUrl(mediaAssetId, opts.signal);
  onStage('published');
  return { mediaAssetId, publicUrl: url };
}

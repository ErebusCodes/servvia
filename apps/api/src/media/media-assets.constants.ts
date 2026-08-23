import { MediaAssetPurpose, MediaAssetType } from '@prisma/client';

export const ALLOWED_MIME_TYPES: Record<MediaAssetType, Record<string, string>> = {
  image: {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/gif': '.gif',
  },
  video: {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  },
};

// Deliberately conservative; not sourced from any product requirement.
// Revisit before removing the review flag.
export const MAX_SIZE_BYTES: Record<MediaAssetType, number> = {
  image: 15 * 1024 * 1024, // 15 MiB
  video: 250 * 1024 * 1024, // 250 MiB
};

// Not enforced server-side today: doing so requires probing image
// dimensions/video duration server-side (e.g. `sharp` for images is
// already a dependency; video duration has no dependency in this
// repository yet — see the BMAD story's "deferred" section). Recorded
// here as the intended limits for when that probe is added, not as an
// active guarantee.
export const MAX_IMAGE_DIMENSION_PX = 8000;
export const MAX_VIDEO_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export function mediaTypeForMimeType(mimeType: string): MediaAssetType | null {
  if (mimeType in ALLOWED_MIME_TYPES.image) return 'image';
  if (mimeType in ALLOWED_MIME_TYPES.video) return 'video';
  return null;
}

export function extensionForMimeType(mediaType: MediaAssetType, mimeType: string): string | null {
  return ALLOWED_MIME_TYPES[mediaType][mimeType] ?? null;
}

const EXTENSION_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.values(ALLOWED_MIME_TYPES).flatMap((map) =>
    Object.entries(map).map(([mimeType, ext]) => [ext, mimeType]),
  ),
);

/** Inverse of extensionForMimeType — used only to set a Content-Type header
 * when serving bytes back out (the local public-delivery emulation route),
 * never to decide what's accepted on the way in. */
export function mimeTypeForExtension(ext: string): string {
  return EXTENSION_TO_MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

// Fallback bucket names used only when MEDIA_STORAGE_PROVIDER=local (or
// unset) and the operator hasn't set GCS_MEDIA_BUCKET/GCS_MEDIA_PUBLIC_BUCKET
// — shared by MediaAssetsService and MediaModule's LocalStorageProvider
// factory so both sides agree on the same default without duplicating the
// literal string.
export const DEFAULT_LOCAL_PRIVATE_BUCKET = 'local-dev-media';
export const DEFAULT_LOCAL_PUBLIC_BUCKET = 'local-dev-media-public';

const PURPOSE_FOLDER: Record<MediaAssetPurpose, string> = {
  menu_item: 'menu-items',
  category: 'categories',
  promotion: 'promotions',
  venue_gallery: 'venue-gallery',
  branding: 'branding',
  video: 'videos',
  document: 'documents',
};

// Filename normalization: lowercase, alphanumeric/hyphen only, extension
// derived from validated MIME type (never trusted from the client) — same
// defense-in-depth rationale as the existing MediaService's FOLDER_PATTERN.
export function normalizeFilename(originalFilename: string): string {
  const base = originalFilename.replace(/\.[^.]*$/, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'file';
}

/**
 * `venues/{venueId}/{purpose-folder}/{mediaId}/original/{filename}` per the
 * GCS media architecture decision — see
 * _bmad-output/implementation-artifacts/2026-08-17-gcs-media-architecture.md.
 * `mediaId` (the MediaAsset's own id) makes every key unique regardless of
 * filename collisions, and gives every object an immutable identity that
 * versioned variants (variants/thumbnail.webp etc., not implemented yet —
 * see deferred work) can be layered under later without changing this key.
 */
export function buildObjectKey(params: {
  venueId: string;
  purpose: MediaAssetPurpose;
  mediaId: string;
  originalFilename: string;
  extension: string;
}): string {
  const filename = `${normalizeFilename(params.originalFilename)}${params.extension}`;
  return `venues/${params.venueId}/${PURPOSE_FOLDER[params.purpose]}/${params.mediaId}/original/${filename}`;
}

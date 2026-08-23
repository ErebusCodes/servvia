// Menu item/category images are served either as absolute URLs (a future
// CDN/object-storage deployment) or as site-relative paths served from each
// frontend's own public/menu-images/ directory (the current, deployment-safe
// convention — see shared/menu/menuData.mjs and the canonical seed). Plain
// @IsUrl() rejects the latter, which would make it impossible to save an
// edit to any of the ~27 canonical items that already carry a relative
// imageUrl. Accept both shapes; reject anything else (e.g. bare filenames,
// which would resolve inconsistently per app).
export const IMAGE_URL_PATTERN = /^(https?:\/\/\S+|\/[^\s]*)$/;
export const IMAGE_URL_MESSAGE =
  'imageUrl must be an absolute http(s) URL or a site-relative path starting with /';

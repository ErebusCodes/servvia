// Shared "an individual menu image failed to load" handling for the
// Customer Website and Window Display. Both apps render the exact same
// /menu page (window-display aliases customer-website's src/pages/Menu.jsx
// — see apps/window-display/vite.config.ts's '@' alias), but a component
// with its own dedicated fallback UI (DishModal.jsx) needs the constant and
// logging behaviour without the auto-swap-the-<img> convenience — hence
// this is a plain helper, not a component.
//
// Neutral Verdura-branded placeholder, never an unrelated stock dish image
// — same file both apps' public/branding/ directories already serve.
export const MENU_IMAGE_FALLBACK_SRC = '/branding/verdura-fallback.svg';

/**
 * Attach to an <img>'s onError to swap it to the fallback exactly once. A
 * data-attribute guard means even a broken fallback asset itself can never
 * re-trigger onError in a loop. Logs a single warning naming only the item
 * (never the failed URL, which may embed ids/query params) so this can't
 * flood telemetry or leak anything sensitive.
 */
export function handleMenuImageError(event, itemLabel) {
  const img = event.currentTarget;
  if (!img || img.dataset.mediaFallbackApplied === 'true') return;
  img.dataset.mediaFallbackApplied = 'true';
  img.onerror = null;
  img.src = MENU_IMAGE_FALLBACK_SRC;
  console.warn(`[menu-image] "${itemLabel ?? 'menu item'}" image failed to load — showing placeholder.`);
}

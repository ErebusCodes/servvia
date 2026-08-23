// Thin cross-browser wrapper around the Fullscreen API, plus a localStorage
// flag so a kiosk device only has to grant fullscreen once. The API requires
// a user gesture to enter fullscreen — this module never tries to bypass
// that; callers must invoke requestFullscreen() from an event handler.

const PREFERENCE_KEY = 'verdura-kiosk-fullscreen-accepted';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
  msFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
  msFullscreenEnabled?: boolean;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDocument;
  return Boolean(document.fullscreenEnabled || doc.webkitFullscreenEnabled || doc.msFullscreenEnabled);
}

export function getFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as FullscreenDocument;
  return document.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement || null;
}

export function isFullscreenActive(): boolean {
  return getFullscreenElement() !== null;
}

const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'];
const FULLSCREEN_ERROR_EVENTS = ['fullscreenerror', 'webkitfullscreenerror', 'MSFullscreenError'];

export async function requestFullscreen(target?: HTMLElement): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const el = (target ?? document.documentElement) as FullscreenElement;
  const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el) ?? el.msRequestFullscreen?.bind(el);
  if (!request) return false;

  // A resolved requestFullscreen() promise is not reliable proof that
  // fullscreen actually engaged — some Chromium builds (observed on
  // Windows Chrome/Edge) resolve it without the fullscreen state changing
  // and without ever dispatching fullscreenerror either. `fullscreenchange`
  // is the authoritative signal, so wait for whichever of change/error
  // fires first, with a direct element-state check as the final fallback
  // for the rare implementation that fires neither.
  return new Promise<boolean>(resolve => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      FULLSCREEN_CHANGE_EVENTS.forEach(event => document.removeEventListener(event, onChange));
      FULLSCREEN_ERROR_EVENTS.forEach(event => document.removeEventListener(event, onError));
      window.clearTimeout(timer);
      resolve(result);
    };
    const onChange = () => finish(getFullscreenElement() !== null);
    const onError = () => finish(false);
    FULLSCREEN_CHANGE_EVENTS.forEach(event => document.addEventListener(event, onChange));
    FULLSCREEN_ERROR_EVENTS.forEach(event => document.addEventListener(event, onError));
    const timer = window.setTimeout(() => finish(getFullscreenElement() !== null), 1500);

    Promise.resolve(request()).catch(() => {
      // Rejected (missing/expired user gesture, permissions policy, etc).
      // Double-check actual state rather than assuming — some
      // implementations still change the fullscreen state despite a
      // rejected promise.
      finish(getFullscreenElement() !== null);
    });
  });
}

export async function exitFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  const doc = document as FullscreenDocument;
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    } else if (doc.msExitFullscreen) {
      await doc.msExitFullscreen();
    }
  } catch {
    // Nothing to exit, or the browser refused — no-op either way.
  }
}

export function hasAcceptedFullscreen(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === 'true';
  } catch {
    // Storage unavailable (private browsing, locked-down kiosk profile, etc).
    return false;
  }
}

export function setFullscreenAccepted(): void {
  try {
    localStorage.setItem(PREFERENCE_KEY, 'true');
  } catch {
    // Degrade silently — worst case the prompt reappears next launch.
  }
}

import { useEffect, type ReactNode } from 'react';
import { hasAcceptedFullscreen, isFullscreenActive, requestFullscreen } from '../lib/fullscreen';
import './KioskFullscreenShell.css';

interface KioskFullscreenShellProps {
  children: ReactNode;
  className?: string;
  /** Pad for device notches / home-indicator bars. Skip on the passive signage canvas — see CSS. */
  safeArea?: boolean;
}

/**
 * Common edge-to-edge, non-scrolling container for the kiosk signage, table
 * selection, and ordering pages. If the device already granted fullscreen
 * once (see lib/fullscreen), it re-requests fullscreen on this page's first
 * tap/click — browsers require a user gesture, so this can't happen without
 * one, but it means returning kiosk sessions don't need the prompt again.
 */
export function KioskFullscreenShell({ children, className, safeArea = false }: KioskFullscreenShellProps) {
  useEffect(() => {
    if (!hasAcceptedFullscreen() || isFullscreenActive()) return undefined;

    const tryEnter = () => {
      void requestFullscreen();
    };
    // 'click' (not 'pointerdown'/'touchstart') is the gesture consistently
    // recognized as sufficient "user activation" for the Fullscreen API
    // across Windows Chrome/Edge, macOS Chrome, and mobile/tablet browsers.
    window.addEventListener('click', tryEnter, { once: true });
    return () => window.removeEventListener('click', tryEnter);
  }, []);

  const classes = ['kiosk-fullscreen-shell', safeArea && 'kiosk-fullscreen-shell--safe-area', className]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{children}</div>;
}

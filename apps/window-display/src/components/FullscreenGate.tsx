import { useState } from 'react';
import { useFullscreen } from '../hooks/useFullscreen';

interface FullscreenGateProps {
  /**
   * 'button' — a dismissible card with an explicit "Enter Full Screen" action,
   * for the interactive table-selection/ordering screens.
   * 'tap' — a borderless "tap anywhere" hint for the passive signage display,
   * which has no other UI a first-time viewer would know to press.
   */
  variant: 'button' | 'tap';
}

/**
 * Shown once per device: browsers require a user gesture to enter fullscreen
 * and don't remember that permission across page loads, so every kiosk page
 * needs its own way to capture that first gesture. Once granted, the choice
 * is persisted (see lib/fullscreen) and this never renders again — return to
 * fullscreen on later loads is handled silently by KioskFullscreenShell.
 */
export function FullscreenGate({ variant }: FullscreenGateProps) {
  const { isFullscreen, isSupported, enter, hasAccepted } = useFullscreen();
  const [dismissed, setDismissed] = useState(false);
  const show = isSupported && !isFullscreen && !hasAccepted && !dismissed;

  if (!show) return null;

  if (variant === 'tap') {
    return (
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 cursor-pointer"
        onClick={() => void enter()}
      >
        <div className="text-center px-8">
          <span className="text-5xl block mb-4">⛶</span>
          <p className="text-white text-2xl font-bold">Tap anywhere to continue</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
        <span className="text-5xl">⛶</span>
        <h2 className="text-xl font-extrabold text-gray-800 mt-4 mb-2">Run in Full Screen</h2>
        <p className="text-gray-400 text-sm mb-6">
          For the best kiosk experience, let this display fill the whole screen. You'll only be asked once.
        </p>
        <button
          onClick={() => void enter()}
          className="w-full px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold rounded-xl shadow-md transition active:scale-95 cursor-pointer mb-3"
        >
          Enter Full Screen
        </button>
        <button onClick={() => setDismissed(true)} className="text-sm text-gray-400 underline cursor-pointer">
          Continue without full screen
        </button>
      </div>
    </div>
  );
}

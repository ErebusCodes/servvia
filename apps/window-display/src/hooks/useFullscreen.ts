import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getFullscreenElement,
  hasAcceptedFullscreen,
  isFullscreenSupported,
  requestFullscreen,
  setFullscreenAccepted,
} from '../lib/fullscreen';

const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'];

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => getFullscreenElement() !== null);
  const isSupported = useMemo(() => isFullscreenSupported(), []);

  useEffect(() => {
    const handleChange = () => setIsFullscreen(getFullscreenElement() !== null);
    FULLSCREEN_CHANGE_EVENTS.forEach((event) => document.addEventListener(event, handleChange));
    return () => {
      FULLSCREEN_CHANGE_EVENTS.forEach((event) => document.removeEventListener(event, handleChange));
    };
  }, []);

  const enter = useCallback(async (target?: HTMLElement) => {
    const ok = await requestFullscreen(target);
    if (ok) setFullscreenAccepted();
    return ok;
  }, []);

  return { isFullscreen, isSupported, enter, hasAccepted: hasAcceptedFullscreen() };
}

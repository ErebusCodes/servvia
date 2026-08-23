import { useEffect } from 'react';

const getMainSiteUrl = () => {
  const { origin, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // In local development, customer-website runs on 5173, window-display on 5174
    return origin.replace('5174', '5173');
  }
  if (hostname.startsWith('admin.')) {
    return `https://${hostname.substring(6)}`;
  }
  return '/';
};

export function AccessUnavailable() {
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-vd-bg-page font-body p-4 box-border">
      <div className="relative w-full max-w-[680px] min-h-[580px] bg-vd-bg-card rounded-[20px] overflow-hidden shadow-vd-card animate-vd-rise flex flex-col justify-between">
        
        {/* SVG Top Left Decoration */}
        <div className="absolute top-0 left-0 w-[200px] h-[200px] overflow-hidden rounded-tl-[20px] pointer-events-none" aria-hidden="true">
          <svg width="200" height="200" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="absolute top-0 left-0">
            <path d="M-20 180 C20 80, 120 -30, 200 10 C160 60, 80 120, -20 180Z" fill="#2D6B99" opacity="0.85" />
            <path d="M-30 140 C10 50, 100 -40, 170 0 C130 55, 50 110, -30 140Z" fill="#1A85AA" opacity="0.9" />
            <path d="M-10 110 C30 30, 110 -20, 160 20 C110 60, 40 90, -10 110Z" fill="#1DB8B8" opacity="0.95" />
          </svg>
        </div>

        {/* Content Container */}
        <div className="flex flex-col items-center pt-10 px-8 pb-8 flex-1 w-full justify-center">
          <div className="w-full h-10" aria-hidden="true" />

          {/* Logo Heading */}
          <div className="flex items-center gap-2.5 mb-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1DB8B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 20h10" />
              <path d="M10 20c5.5-2.5.8-6.4 3-10" />
              <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
              <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
            </svg>
            <span className="font-bold text-[22px] text-vd-text-primary tracking-[-0.3px]">Verdura</span>
          </div>
          <p className="text-[13px] text-vd-text-secondary tracking-wide text-center m-0">Restaurant Operations Platform</p>

          <div className="flex flex-col items-center mt-12 mb-8 text-center max-w-[380px]">
            {/* Warning Shield/Lock Icon */}
            <div className="w-16 h-16 rounded-full bg-[#1DB8B8]/10 flex items-center justify-center mb-6 text-vd-accent animate-pulse">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>

            <h1 className="font-semibold text-[26px] text-vd-text-primary mt-0 mb-3 leading-[1.3]">
              Access unavailable
            </h1>
            <p className="text-[15px] text-vd-text-secondary leading-relaxed m-0">
              You do not have an active Verdura Admin session.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="w-full max-w-[300px] flex flex-col gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="w-full h-[46px] rounded-lg bg-gradient-to-r from-[#00C8C8] to-[#1DB8C0] border-none font-semibold text-[15px] text-white flex items-center justify-center gap-2 hover:brightness-[1.08] active:brightness-[0.95] transition-all duration-150 tracking-[0.01em] cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>Retry Session</span>
            </button>

            <a
              href={getMainSiteUrl()}
              className="w-full h-[46px] rounded-lg bg-vd-bg-input border border-vd-border font-semibold text-[15px] text-vd-text-primary flex items-center justify-center gap-2 hover:border-[#1DB8B8]/50 hover:bg-[#3A3E5C]/80 active:scale-[0.98] transition-all duration-150 tracking-[0.01em] no-underline box-border"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span>Return to main site</span>
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pb-6 pt-2 select-none">
          <p className="text-[11px] text-vd-text-muted m-0">
            <span>Terms of use</span>
            <span className="mx-2">|</span>
            <span>Privacy policy</span>
          </p>
        </div>
      </div>
    </main>
  );
}

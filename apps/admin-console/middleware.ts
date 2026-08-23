import { next } from '@vercel/edge';

const STATIC_EXTENSIONS = /\.(js|css|ico|svg|png|webp|woff2?|ttf|map|json|webmanifest|txt)$/i;
const PUBLIC_PATHS = /^\/login(\/.*)?$/;

function hasCookie(cookieHeader: string | null, name: string): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => {
    const trimmed = part.trim();
    if (!trimmed) return false;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      return trimmed === name;
    }
    return trimmed.slice(0, eqIndex).trim() === name;
  });
}

export default function middleware(request: Request): Response {
  const { pathname } = new URL(request.url);

  // Always pass through: login page, static assets, Vercel internals
  if (PUBLIC_PATHS.test(pathname) || STATIC_EXTENSIONS.test(pathname)) {
    return next();
  }

  // Check for refresh token cookie presence
  if (!hasCookie(request.headers.get('cookie'), 'refresh_token')) {
    return Response.redirect(new URL('/login', request.url), 302);
  }

  return next();
}

export const config = {
  matcher: ['/((?!_vercel|_next).*)'],
};

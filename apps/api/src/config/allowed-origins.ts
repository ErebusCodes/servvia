/**
 * Browser origins allowed to call the API and to open the transitional
 * socket.io connection (Story 2.6). A request without an Origin header (a
 * native client, curl, a server) is not a browser cross-origin request and
 * is not refused here; it still needs a valid credential.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  'https://verdura.co.nz',
  'https://admin.verdura.co.nz',
  'https://kiosk.verdura.co.nz',
  // Today's actual production topology for this venue is a single
  // Windows box serving every frontend (Admin Console, Order Tablet,
  // Window Display) directly off bare localhost ports — there are no
  // real hostnames yet (Customer Website isn't even deployed). Gating
  // these behind NODE_ENV !== 'production' meant a real browser
  // opened at http://localhost:5177 in production had every fetch to
  // the API silently CORS-blocked at the preflight stage: no
  // Access-Control-Allow-Origin header, no proper HTTP status the
  // frontend's error handling could see, just a generic "could not
  // reach the server" — while any non-browser check (curl, a script,
  // Invoke-WebRequest) never enforces CORS at all and saw the
  // request succeed. Found 2026-08-30 chasing an Admin Console PIN
  // login that worked from the backend but not from the browser.
  // These are a fixed, enumerated, non-guessable set of ports (not
  // "any localhost origin"), so always allowing them is a narrow
  // addition, not a general CORS loosening.
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
];

export function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

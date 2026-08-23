---
baseline_commit: 112e482
---

# Story 2.7: CDN Edge Middleware

Status: done

> **Enterprise conformance addendum — 2026-08-15:** CDN gating is defence-in-depth only; APIs, WebSockets and command channels enforce authentication and venue authorization independently. Connector communication is outbound mTLS and never depends on browser cookies or edge middleware. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As the Verdura platform,
I want unauthenticated requests to `admin.verdura.co.nz` intercepted at the CDN edge before any bundle is served,
so that the admin dashboard JavaScript is never delivered to unauthenticated visitors.

## Acceptance Criteria

1. A Vercel Edge Middleware (`admin-frontend/middleware.ts`) intercepts every request to the admin CDN origin before any file is served.
2. If the request does NOT carry a `refresh_token` cookie, the middleware issues a 302 redirect to `/login`.
3. If the request carries a `refresh_token` cookie (any value — presence is sufficient; the API validates authenticity), the request passes through unchanged.
4. The following paths are always passed through without a cookie check: `/login`, `/login/*`, and any static asset extension (`.js`, `.css`, `.ico`, `.svg`, `.png`, `.woff`, `.woff2`, `.ttf`).
5. A `vercel.json` at `admin-frontend/` root configures the Vite build output (`dist/`) and marks the project as a single-page application (all non-asset routes → `index.html`).
6. Running `npm run build --workspace=admin-frontend` followed by `vercel --prebuilt` (or `vercel deploy`) successfully deploys the admin app with the middleware active.
7. Verification: `curl -I https://admin.verdura.co.nz/dashboard` (no cookie) returns `HTTP/2 302` with `Location: /login`. `curl -I https://admin.verdura.co.nz/login` returns `HTTP/2 200`.
8. All `npm run typecheck` and `npm run lint` pass in the `admin` workspace with the new files included.

## Tasks / Subtasks

- [x] Task 1 — Add Vercel deploy configuration (AC: 5, 6)
  - [x] Create `admin-frontend/vercel.json`:
    - `buildCommand`: `npm run build --workspace=admin-frontend`
    - `outputDirectory`: `admin-frontend/dist`
    - `framework`: `vite`
    - SPA rewrite: `{ "source": "/((?!api/).*)", "destination": "/index.html" }` for all non-asset routes
  - [x] Confirm `admin-frontend/package.json` has `build` script producing `dist/` output (already exists — verify only)

- [x] Task 2 — Implement Edge Middleware (AC: 1, 2, 3, 4, 8)
  - [x] Create `admin-frontend/middleware.ts` at the project root (NOT inside `src/`)
  - [x] Use the Web-standard `Request` / `Response` / `NextResponse` APIs from `@vercel/edge`
  - [x] Install `@vercel/edge` as a dev dependency: `npm install --save-dev @vercel/edge --workspace=admin-frontend`
  - [x] Implement `config` export with matcher that excludes `/_vercel/*` and `/_next/*` paths
  - [x] Implement pass-through for `/login` and `/login/` paths
  - [x] Implement pass-through for static asset extensions: `.js .css .ico .svg .png .webp .woff .woff2 .ttf .map`
  - [x] Implement cookie check: if `request.cookies.get('refresh_token')` is absent → `return NextResponse.redirect(new URL('/login', request.url), 302)`
  - [x] Otherwise call `return NextResponse.next()`

- [x] Task 3 — Typecheck and lint (AC: 8)
  - [x] Run `npm run typecheck --workspace=admin-frontend` — zero errors
  - [x] Run `npm run lint --workspace=admin-frontend` — zero errors

## Dev Notes

### CDN Provider Decision

Architecture (DL-024) specifies: "Cloudflare Worker / Vercel Edge Middleware / Lambda@Edge". **Vercel is chosen** for this story — it has first-class Vite support and zero-config edge middleware via `middleware.ts` at the project root. If the production CDN later proves to be Cloudflare Pages or Netlify, the middleware logic (`refresh_token` cookie check → redirect) transfers directly; only the wrapper API and deploy config differ.

### Middleware File Location

**Critical:** `middleware.ts` must be at `admin-frontend/middleware.ts` (project root), NOT `admin-frontend/src/middleware.ts`. Vercel discovers it at the project root alongside `package.json`.

### Cookie Name

The session cookie is named `refresh_token` — set by the API in `backend/src/auth/auth.service.ts`:
```typescript
res.cookie('refresh_token', token, { httpOnly: true, secure: true, sameSite: 'strict', ... });
```
The edge middleware checks only for **presence** of this cookie — not its value. Cryptographic verification of the JWT happens at the API layer (`JwtRefreshGuard`). The edge is a pre-bundle delivery gate, not the auth enforcement boundary.

### Middleware Implementation

```typescript
// admin-frontend/middleware.ts
import { NextResponse } from '@vercel/edge';
import type { NextRequest } from '@vercel/edge';

const STATIC_EXTENSIONS = /\.(js|css|ico|svg|png|webp|woff2?|ttf|map)$/i;
const PUBLIC_PATHS = /^\/login(\/.*)?$/;

export function middleware(request: NextRequest) {
  const { pathname } = new URL(request.url);

  // Always pass through: login page, static assets, Vercel internals
  if (PUBLIC_PATHS.test(pathname) || STATIC_EXTENSIONS.test(pathname)) {
    return NextResponse.next();
  }

  // Check for refresh token cookie presence
  if (!request.cookies.get('refresh_token')) {
    return NextResponse.redirect(new URL('/login', request.url), 302);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_vercel|_next).*)'],
};
```

### vercel.json

```json
{
  "buildCommand": "npm run build --workspace=admin-frontend",
  "outputDirectory": "admin/dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

Place this at `admin-frontend/vercel.json`. The rewrite sends all unmatched routes to `index.html` (SPA behaviour); actual static assets are served by Vercel directly from `dist/` before the rewrite fires.

### What the Middleware Does NOT Do

- Does **not** validate the JWT signature — no API secrets at the edge
- Does **not** check token expiry — the API enforces this on every authenticated call
- Does **not** redirect `/api/*` paths — those go directly to `api.verdura.co.nz`, not through the admin CDN
- Does **not** replace `ProtectedRoute` — client-side guard still required for in-app navigation

### Important: Story 2-6 Review Still Pending

Story 2-6 is in `review` status. The findings marked LOW (BrowserRouter placement, Bearer header on `/auth/refresh`) are deferred. This story (`2-7`) does not depend on those fixes being applied first.

### No Test Requirement This Story

The middleware is pure logic with no React/NestJS dependencies. Manual verification via `curl` (AC 7) is the acceptance gate. Unit tests for the middleware can be added in a future test-infrastructure story.

### Project Structure After This Story

```
admin/
├── middleware.ts       ← NEW (Vercel Edge Middleware, project root)
├── vercel.json         ← NEW (Vercel deploy config)
├── package.json
├── vite.config.ts
└── src/
    └── ...
```

### References

- Epic story list: [Source: docs/epics.md#E2] — E2-S7
- CDN + Edge architecture: [Source: docs/architecture.md#4.2 Admin Dashboard] — "CDN returns a login redirect for unauthenticated requests via Edge Function / middleware"
- Security architecture flow: [Source: docs/architecture.md#5] — Step 2: "CDN Edge Function checks for a valid session cookie; unauthenticated requests receive a 302 to /login"
- CDN decision: [Source: docs/decisions-log.md#DL-024] — Edge Function enforces auth before serving admin bundle
- Cookie name: [Source: backend/src/auth/auth.service.ts] — `res.cookie('refresh_token', ...)`
- Story 2-6 (admin workspace): [Source: _bmad-output/implementation-artifacts/2-6-admin-login-page.md]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

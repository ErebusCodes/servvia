---
baseline_commit: 32862fe
---

# Story 2.6: Admin Login Page

Status: review

> **Enterprise conformance addendum — 2026-08-15:** Login UX must restore server-authoritative venue grants and route users to truthful exception views. Access tokens must not persist in local storage. Sensitive reconcile, refund, void, emergency-mode and reprint actions require step-up/authorization and correlated audit. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As an Admin Dashboard user,
I want a login page with an email and password form and clear error feedback,
so that I can securely authenticate and reach the Admin Dashboard.

## Acceptance Criteria

1. Scaffold the `admin` workspace (React 18, TypeScript, Vite, Tailwind CSS v3, TanStack Query v5, Zustand v5, React Router v6) in the monorepo at `admin-frontend/`, registered in root `package.json` workspaces.
2. The login page (`/login`) renders an email field, a password field, and a submit button.
3. Client-side validation (via zod + react-hook-form) prevents submission if email is not a valid email address or password is empty; inline error messages appear per field.
4. On successful `POST /api/auth/login`, the access token and user profile are stored in an in-memory Zustand auth store and the user is redirected to `/dashboard`.
5. On HTTP 401, a generic error banner displays: "Invalid email or password." — no username enumeration.
6. On HTTP 429, the error banner displays: "Too many attempts, try again in 15 minutes."
7. On any other network/server error, the error banner displays: "Something went wrong. Please try again."
8. The submit button shows a loading state and is disabled while the request is in flight.
9. A `ProtectedRoute` component redirects unauthenticated users from `/dashboard` to `/login`.
10. On app startup, a silent `POST /api/auth/refresh` is attempted (the HttpOnly cookie is sent automatically); if it succeeds the access token is stored and the user bypasses the login page. If it fails (401) the user lands on `/login` as normal.
11. All `npm run typecheck`, `npm run lint`, and `npm run dev` commands pass without errors in the `admin` workspace.

## Tasks / Subtasks

- [x] Task 1 — Scaffold `admin` workspace (AC: 1, 11)
  - [x] Create `admin-frontend/package.json` with scripts: `dev`, `build`, `preview`, `lint`, `typecheck`
  - [x] Add dependencies: `react@^18`, `react-dom@^18`, `react-router-dom@^6`, `@tanstack/react-query@^5`, `zustand@^5`, `axios@^1`, `react-hook-form@^7`, `zod@^3`
  - [x] Add dev dependencies: `vite@^5`, `@vitejs/plugin-react@^4`, `typescript@^5`, `tailwindcss@^3`, `postcss`, `autoprefixer`, `@types/react@^18`, `@types/react-dom@^18`, `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`
  - [x] Create `admin-frontend/vite.config.ts` with `@vitejs/plugin-react` and `server.proxy` pointing `VITE_API_URL` (default `http://localhost:3000`)
  - [x] Create `admin-frontend/tsconfig.json` (strict mode, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`)
  - [x] Create `admin-frontend/tailwind.config.ts` scanning `src/**/*.{ts,tsx}`
  - [x] Create `admin-frontend/postcss.config.js`
  - [x] Create `admin-frontend/index.html` with root div and `src/main.tsx` script
  - [x] Create `admin-frontend/.env.example` with `VITE_API_URL=http://localhost:3000`
  - [x] Add `"admin"` to root `package.json` workspaces array
  - [x] Add `dev:admin` and `build:admin` to root `package.json` scripts

- [x] Task 2 — API client and auth store (AC: 4, 10)
  - [x] Create `admin-frontend/src/lib/api.ts`: axios instance with `baseURL: import.meta.env.VITE_API_URL`, `withCredentials: true` (for HttpOnly cookie on refresh), and a request interceptor that injects `Authorization: Bearer <accessToken>` from auth store when present
  - [x] Create `admin-frontend/src/store/auth.store.ts`: Zustand store with `accessToken: string | null`, `user: { id, email, name, role } | null`, `setAuth(token, user)`, `clearAuth()` actions

- [x] Task 3 — Auth bootstrap hook (AC: 10)
  - [x] Create `admin-frontend/src/hooks/useBootstrapAuth.ts`: on mount, call `POST /api/auth/refresh` via the axios instance; on 200, extract `accessToken` and call `setAuth`; on failure, call `clearAuth`. Return `{ isLoading: boolean }`.
  - [x] Mount this hook in `admin-frontend/src/App.tsx` and render a full-screen loading spinner while `isLoading` is true (prevents flash of login page for valid sessions)

- [x] Task 4 — ProtectedRoute component (AC: 9)
  - [x] Create `admin-frontend/src/components/auth/ProtectedRoute.tsx`: reads `accessToken` from auth store; if null redirects to `/login` (using `<Navigate replace />`); otherwise renders `<Outlet />`

- [x] Task 5 — Login page (AC: 2, 3, 4, 5, 6, 7, 8)
  - [x] Create `admin-frontend/src/pages/login/LoginPage.tsx`
  - [x] Form schema with zod: `{ email: z.string().email(), password: z.string().min(1) }`
  - [x] Wire `useForm` with `zodResolver`, displaying inline messages under each field on blur/submit
  - [x] Submit handler calls `POST /api/auth/login` with `{ email, password }` via TanStack Query `useMutation`
  - [x] On success: call `setAuth(accessToken, user)` then `navigate('/dashboard', { replace: true })`
  - [x] Map response errors: 401 → generic credentials message, 429 → rate limit message, other → generic server error
  - [x] Display error in a role="alert" banner above the form (dismissed when user edits any field)
  - [x] Disable submit button and show spinner while `isPending`
  - [x] No "forgot password" link (explicitly excluded from MVP per UX spec)

- [x] Task 6 — Dashboard placeholder and routing (AC: 4, 9)
  - [x] Create `admin-frontend/src/pages/dashboard/DashboardPage.tsx`: minimal placeholder with "Dashboard" heading and a Logout button that calls `POST /api/auth/logout`, calls `clearAuth()`, then navigates to `/login`
  - [x] Create `admin-frontend/src/App.tsx` with `<BrowserRouter>` + `<Routes>`:
    - `/login` → `<LoginPage />`
    - Protected routes via `<ProtectedRoute />`:
      - `/dashboard` → `<DashboardPage />`
      - `*` → `<Navigate to="/dashboard" />`
  - [x] If user is already authenticated and navigates to `/login`, redirect to `/dashboard`

- [x] Task 7 — App entry point and global styles (AC: 1, 11)
  - [x] Create `admin-frontend/src/main.tsx`: wrap `<App />` in `<QueryClientProvider client={new QueryClient()} />`
  - [x] Create `admin-frontend/src/index.css` with Tailwind directives (`@tailwind base; @tailwind components; @tailwind utilities;`)
  - [x] Import `index.css` in `main.tsx`

- [x] Task 8 — Typecheck, lint, dev server (AC: 11)
  - [x] Run `npm run typecheck --workspace=admin-frontend` — zero errors
  - [x] Run `npm run lint --workspace=admin-frontend` — zero errors
  - [x] Run `npm run dev --workspace=admin-frontend` — dev server starts, login page renders at `http://localhost:5173`

## Dev Notes

### Dependency on Story 1-6

Story 1-6 (`1-6-scaffold-verdura-admin`) is still in backlog. **This story absorbs the scaffold** — Task 1 delivers what 1-6 specified. After this story is done, mark `1-6-scaffold-verdura-admin` as `done` in sprint-status.yaml alongside `2-6-admin-login-page`.

### Admin Workspace Location

Create as `admin-frontend/` in the monorepo root (alongside `backend/` and `customer-frontend/`). The existing `customer-frontend/` is the **frozen** public website in JavaScript — do not modify it. The admin workspace is a new TypeScript app.

```
verdura/
├── backend/          ← NestJS API (existing, TypeScript)
├── customer-frontend/     ← FROZEN public site (JS, do NOT touch)
├── admin-frontend/        ← NEW admin dashboard (TypeScript) ← this story
├── package.json  ← monorepo root (add "admin" to workspaces)
```

### Token Storage Strategy

- **Access token**: In-memory only (Zustand). Cleared on page refresh — the silent refresh (AC 10) re-hydrates it from the HttpOnly cookie.
- **Refresh token**: HttpOnly, Secure, SameSite=Strict cookie managed entirely by the API. The browser sends it automatically on `POST /api/auth/refresh`. JavaScript has zero access to this value.
- **Do NOT** store the access token in `localStorage` or `sessionStorage` — XSS would trivially exfiltrate it.

### API Contract

```
POST /api/auth/login
Body: { email: string, password: string }
Response 200: { accessToken: string, user: { id, email, name, role } }
Response 401: UnauthorizedException — "Invalid credentials"
Response 429: TooManyRequests — rate limit exceeded

POST /api/auth/refresh
Body: (none) — refresh_token cookie sent automatically by browser
Response 200: { accessToken: string }
Response 401: refresh token invalid/expired

POST /api/auth/logout
Body: (none)
Response 204: refresh_token cookie cleared by server
```

Axios instance must be created with `withCredentials: true` so the browser sends the `refresh_token` HttpOnly cookie on cross-origin requests during local development (API on `:3000`, admin on `:5173`).

### Vite Dev Server Proxy

Add this to `vite.config.ts` to avoid CORS issues in development:

```typescript
server: {
  proxy: {
    '/api': {
      target: process.env.VITE_API_URL ?? 'http://localhost:3000',
      changeOrigin: true,
    },
  },
},
```

With the proxy in place, axios calls to `/api/auth/login` are forwarded to the API without triggering browser CORS preflight. Set `baseURL: ''` in the axios instance (or omit it) in dev so Vite handles routing.

Alternatively, use env-var-driven approach: `baseURL: import.meta.env.VITE_API_URL` and rely on the API's CORS config for dev. Either approach is fine — be consistent.

### Error Message Mapping

| HTTP Status | User-facing message |
|---|---|
| 401 | "Invalid email or password." |
| 429 | "Too many attempts, try again in 15 minutes." |
| Network error / 5xx | "Something went wrong. Please try again." |

Do **not** surface the raw API error message — the API returns `"Invalid credentials"` which could leak information about username existence. Always show the generic 401 message regardless of the exact API error body.

### Form Validation (zod schema)

```typescript
const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
```

Show field errors inline below each input. Clear the error banner when the user modifies any field (use `useEffect` watching `watch()` or field `onChange`).

### UX Spec Reference (docs/ux.md §5.4)

- **Fields:** Email, Password
- **Error states:** Invalid credentials (generic — no enumeration), 429 shown as "Too many attempts, try again in 15 minutes"
- **No "forgot password"** — admin resets via CLI (MVP exclusion, not an oversight)
- **After login**, redirect to `/dashboard` (home summary — placeholder for this story)

### TypeScript Strict Mode

The `admin-frontend/` workspace must use strict TypeScript from day one:

```json
// tsconfig.json (relevant flags)
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true
  }
}
```

### No Test Requirement This Story

This story does not require unit or integration tests for the frontend. The priority is a working, type-safe implementation. Testing infrastructure for the admin app will be set up in a later story.

### Project Structure Notes

```
admin/src/
├── components/
│   └── auth/
│       └── ProtectedRoute.tsx
├── hooks/
│   └── useBootstrapAuth.ts
├── lib/
│   └── api.ts              ← axios instance
├── pages/
│   ├── login/
│   │   └── LoginPage.tsx
│   └── dashboard/
│       └── DashboardPage.tsx
├── store/
│   └── auth.store.ts       ← Zustand auth store
├── App.tsx                 ← router + bootstrap
├── main.tsx                ← QueryClientProvider entry
└── index.css               ← Tailwind directives
```

### References

- Epic story list: [Source: docs/epics.md#E2] — E2-S6
- UX login spec: [Source: docs/ux.md#5.4 Admin Dashboard — Login]
- UX error states: [Source: docs/ux.md#6 — Error States] — Admin 401 → redirect to /login
- Architecture admin app: [Source: docs/architecture.md#4.2 Admin Dashboard]
- Architecture auth flow: [Source: docs/architecture.md#5 — Security Architecture]
- Architecture tech stack: [Source: docs/architecture.md — Tech Stack table]
- E1-S6 scaffold spec: [Source: docs/epics.md#E1] — React 18, TypeScript, Vite, Tailwind, TanStack Query, Zustand
- Login API endpoint: [Source: backend/src/auth/auth.controller.ts — POST /auth/login]
- Auth service: [Source: backend/src/auth/auth.service.ts]
- Login DTO: [Source: backend/src/auth/dto/login.dto.ts]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

None — clean run.

### Completion Notes List

- Scaffolded `admin-frontend/` as a new monorepo workspace (absorbs Story 1-6 deliverables). Added to root `package.json` workspaces + scripts.
- Auth store (`useAuthStore`) uses Zustand with in-memory access token only — no localStorage.
- API client (`api.ts`) uses axios with `withCredentials: true` so the HttpOnly refresh cookie is sent cross-origin in dev. Vite proxy forwards `/api/*` to `http://localhost:3000`.
- `useBootstrapAuth` hook calls `POST /api/auth/refresh` on mount; decodes the JWT payload (client-side, no verification) to restore `{ id, email, role }` — `name` is not in the JWT payload and defaults to `''` after silent refresh. Full login populates all fields.
- Login form uses react-hook-form + zod. Error banner is cleared on any field change via `register`'s `onChange`. Error messages: 401 → generic, 429 → rate limit, other → generic server fallback.
- `AuthenticatedLoginRedirect` wrapper in App.tsx redirects already-authenticated users away from `/login`.
- All `typecheck` and `lint` pass with zero errors. Dev server starts at `http://localhost:5173`.

### File List

- [admin/package.json](file:///home/cyrus/Documents/verdura/admin/package.json) (NEW)
- [admin/vite.config.ts](file:///home/cyrus/Documents/verdura/admin/vite.config.ts) (NEW)
- [admin/tsconfig.json](file:///home/cyrus/Documents/verdura/admin/tsconfig.json) (NEW)
- [admin/tailwind.config.ts](file:///home/cyrus/Documents/verdura/admin/tailwind.config.ts) (NEW)
- [admin/postcss.config.js](file:///home/cyrus/Documents/verdura/admin/postcss.config.js) (NEW)
- [admin/eslint.config.js](file:///home/cyrus/Documents/verdura/admin/eslint.config.js) (NEW)
- [admin/index.html](file:///home/cyrus/Documents/verdura/admin/index.html) (NEW)
- [admin/.env.example](file:///home/cyrus/Documents/verdura/admin/.env.example) (NEW)
- [admin/src/vite-env.d.ts](file:///home/cyrus/Documents/verdura/admin/src/vite-env.d.ts) (NEW)
- [admin/src/index.css](file:///home/cyrus/Documents/verdura/admin/src/index.css) (NEW)
- [admin/src/main.tsx](file:///home/cyrus/Documents/verdura/admin/src/main.tsx) (NEW)
- [admin/src/App.tsx](file:///home/cyrus/Documents/verdura/admin/src/App.tsx) (NEW)
- [admin/src/store/auth.store.ts](file:///home/cyrus/Documents/verdura/admin/src/store/auth.store.ts) (NEW)
- [admin/src/lib/api.ts](file:///home/cyrus/Documents/verdura/admin/src/lib/api.ts) (NEW)
- [admin/src/lib/jwt.ts](file:///home/cyrus/Documents/verdura/admin/src/lib/jwt.ts) (NEW)
- [admin/src/hooks/useBootstrapAuth.ts](file:///home/cyrus/Documents/verdura/admin/src/hooks/useBootstrapAuth.ts) (NEW)
- [admin/src/components/auth/ProtectedRoute.tsx](file:///home/cyrus/Documents/verdura/admin/src/components/auth/ProtectedRoute.tsx) (NEW)
- [admin/src/pages/login/LoginPage.tsx](file:///home/cyrus/Documents/verdura/admin/src/pages/login/LoginPage.tsx) (NEW)
- [admin/src/pages/dashboard/DashboardPage.tsx](file:///home/cyrus/Documents/verdura/admin/src/pages/dashboard/DashboardPage.tsx) (NEW)
- [package.json](file:///home/cyrus/Documents/verdura/package.json) (MODIFIED — added "admin" workspace + dev:admin/build:admin/lint:admin scripts)

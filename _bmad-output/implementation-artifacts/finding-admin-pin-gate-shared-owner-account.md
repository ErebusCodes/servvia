---
finding_id: SEC-FIND-2026-08-18-01
discovered_in: story 15-1 (tablet device identity, restricted mode, staff elevation, manager step-up)
discovered_date: 2026-08-18
related_story: 2-6 (Admin Login Page)
status: recorded, not fixed — tracked separately by explicit instruction
severity: High
---

# Finding: Admin Console `AdminPinGate` authenticates with one shared, config-fixed owner/admin account, not per-staff identity

## Summary

The entire embedded Admin Console application (`apps/admin-console`, default `VITE_APP_MODE`) is gated by a single numeric PIN (`AdminPinGate`) that resolves to **one fixed, configured `Staff` account** (`ADMIN_CONSOLE_EMAIL`) for every person who enters the correct PIN. There is no reachable per-staff email/password login UI in the Admin Console frontend — `ProtectedRoute` renders `AdminPinGate` unconditionally whenever no access token is present, for the whole app, not a specific route. Anyone who knows the PIN is issued a full, real, privileged access token for that one account, indistinguishable in every downstream system (JWT `sub`, `AuditLog.actorId`, RBAC checks) from that specific named owner/admin acting personally.

This finding was discovered during story 15-1's independent-review pass while auditing the Order Tablet's new device/staff/manager identity model against the rest of the app's authentication surfaces, to make sure the new model wasn't reusing or extending this weaker pattern. It is **not** part of story 15-1's approved scope (DL-081) and was **not fixed** — DL-081 explicitly excludes it and requires it be tracked as its own finding. This document is that tracking record.

## Evidence

- `apps/admin-console/src/components/auth/ProtectedRoute.tsx:5-13` — renders `<AdminPinGate />` for the entire app whenever `useAuthStore.accessToken` is empty; there is no alternate route to a per-staff login form reachable from the UI.
- `apps/admin-console/src/components/auth/AdminPinGate.tsx:21` — posts only a `pin` to `POST /api/auth/admin-pin`; no email or per-staff identifier is collected or sent.
- `apps/api/src/auth/auth.service.ts:75-108` (`validateAdminPin`) — compares the submitted PIN against one process-wide `ADMIN_CONSOLE_PIN` config value (timing-safe `safeCompare`), and on match, looks up and returns the **one** `Staff` row named by `ADMIN_CONSOLE_EMAIL` — the same row, every time, for every person who enters the PIN. The resulting JWT (`signAccessToken`) is a real, full-privilege staff access token for that account, valid against every RBAC-guarded endpoint in the system.
- Contrast with the real, unused-by-this-UI mechanism: `apps/api/src/auth/auth.service.ts:39-71` (`validateLogin`) already implements genuine per-staff email+password authentication (Argon2id, enumeration-resistant timing) and is exercised by `POST /api/auth/login` — used by integration tests, by Order Tablet staff elevation (indirectly, via the same `Staff.passwordHash`... no, elevation uses `pinHash`, but the login endpoint itself is real and working) — but the Admin Console frontend never renders a form for it.
- `apps/api/src/auth/utils/insecure-default-pin.util.ts`, wired into `validateAdminPin` this session (story 15-1, as a small independent hardening step, not a fix of this finding) — fails closed in production if `ADMIN_CONSOLE_PIN` is still the checked-in default `108`. This reduces the risk of an *externally guessable* PIN in production but does **not** address the underlying shared-identity problem: even a strong, non-default PIN known only to legitimate staff still authenticates all of them as the same account.

## Why this matters

- **Audit attribution is false for the entire Admin Console.** Every `AuditLog` row written by an action taken through the PIN-gated console (menu edits, staff management, venue settings, order overrides, reservation changes — everything `AdminPortalApp` routes to) is attributed to one fixed account, not to whichever staff member actually performed the action. If several staff share the PIN (the only way the console currently works for more than one person), there is no way to determine after the fact who did what.
- **No individual revocation.** A staff member who leaves, or whose access should be revoked, cannot be individually cut off — the PIN would have to be rotated for everyone, and there is no mechanism shown in the UI to do even that.
- **Privilege is all-or-nothing.** The account named by `ADMIN_CONSOLE_EMAIL` must be owner/admin-role (enforced in `validateAdminPin`) to log in at all, meaning every PIN-holder — regardless of their real job — gets full owner/admin authority in the console, not a role-appropriate subset.
- **This is the same category of problem story 15-1 was created to fix for the Order Tablet**, and DL-081's approved model (device identity → restricted mode → named staff elevation → manager step-up, each independently auditable) is a direct, working demonstration of what a fix here could look like. Story 15-1 deliberately did not extend that fix to the Admin Console, per explicit scope instruction — this finding exists so that decision is not lost.

## Relationship to story 2-6

Story 2-6 ("Admin Login Page") is the story that originally built `AdminPinGate` and `ProtectedRoute`; its own artifact (`_bmad-output/implementation-artifacts/2-6-admin-login-page.md`, status: `review`) does not flag the shared-account behavior as a known gap — it was accepted as the console's login mechanism without this framing. This finding does not reopen or reverse story 2-6's own scope; it records a security-relevant consequence of that story's design that was not previously written down anywhere in the tracked documentation, discovered independently during story 15-1.

## Recommended owner

Product/security owner (the same decision-owner role as DL-081) — this is an authentication-model decision of comparable weight to the one just made for the Order Tablet, not a small implementation task.

## Suggested direction (recommendation only, not a decision)

Replace or layer `AdminPinGate` with real per-staff authentication for the Admin Console — the backend mechanism (`validateLogin`/`POST /api/auth/login`, Argon2id-hashed `Staff.passwordHash`) already exists and is already used elsewhere in this codebase; the gap is purely that the Admin Console frontend never surfaces it. A minimal fix would replace `AdminPinGate` with a real email/password (or SSO) form calling the existing `/api/auth/login` endpoint; a PIN could still be retained as a *second factor* or fast-unlock convenience layered on top of a real per-staff session, mirroring the device→staff layering pattern DL-081 just established for the tablet — but that is a design choice for the decision owner, not settled here.

## Safe default if unanswered

Do not expand the PIN-gate pattern to any additional surface. Any new admin-facing feature should default to requiring the existing real per-staff login path rather than reusing `AdminPinGate`, until this finding is explicitly resolved.

## October 11 relevance

Indirect but real: if the Dunedin venue's on-site pilot involves more than one staff member operating the Admin Console, every administrative action taken during that pilot will carry false attribution in the audit trail, which could matter for any post-pilot incident review or reconciliation. It does not block the Idealpos/EFTPOS/KDS/KOT critical path directly and is not required to be resolved before 11 October, but should be flagged to the product/security owner alongside the other DL-08x decisions given its severity.

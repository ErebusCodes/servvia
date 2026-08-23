---
baseline_commit: 0aba9ec
---

# Story 2.8: Audit log on login, login_failed, logout, password_changed events

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Extend append-only audit beyond auth to every order version, POS offer/accept/submit/confirm/fail, payment event, KDS delivery/status, KOT attempt/reprint, mapping change, emergency release, refund and reconciliation action. All use one correlation chain and immutable external references. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a security administrator,
I want authentication events (success, failures, sign-outs, and password resets) logged in a structured database table,
So that I have a tamper-resistant operational history of user access for compliance and threat detection.

## Acceptance Criteria

1. **Audit Logging Service:**
   - Create an `AuditLogService` at `backend/src/audit/` that exposes a method:
     - `logAuthEvent(data: LogAuthEventDto): Promise<AuditLog>`
   - `LogAuthEventDto` must include: `organizationId: string`, `venueId?: string`, `actorId: string`, `actorEmail: string`, `actorRole: StaffRole`, `action: string`, `resource: string`, `resourceId?: string`, `ipAddress?: string`, `userAgent?: string`, `before?: any`, `after?: any`.

2. **Trigger Points:**
   - **Login Success:** Logging must trigger on successful login (`POST /api/auth/login`), creating an `AuditLog` entry:
     - `action: "login"`
     - `resource: "auth"`
   - **Login Failure:** Logging must trigger on failed password attempts for valid emails (`POST /api/auth/login`), creating an `AuditLog` entry:
     - `action: "login_failed"`
     - `resource: "auth"`
   - **Logout:** Logging must trigger on token revocation / sign-out (`POST /api/auth/logout`), creating an `AuditLog` entry:
     - `action: "logout"`
     - `resource: "auth"`
   - **Password Change:** Logging must trigger when a staff member resets or updates their password, creating an `AuditLog` entry:
     - `action: "password_changed"`
     - `resource: "staff"`

3. **Data Logging & Headers:**
   - Capture the IP address and User-Agent from incoming request headers (`x-real-ip`, `x-forwarded-for`, or socket connection IP) and store them in `ipAddress` and `userAgent`.

4. **Foreign Key Constraint Resolution (Edge Case):**
   - If a login fails because the email is **not found** in the database:
     - Since the `actorId` field is required and has a foreign key to `Staff`, a database record cannot be inserted directly.
     - The application must write a structured warning log using NestJS `Logger` (e.g. `[AuthService] Anonymous login failure: email: x@y.com`). No DB record should be written to avoid FK exceptions.

5. **Test Coverage:**
   - Add unit tests in `backend/src/audit/audit.service.spec.ts` mocking Prisma database writes.
   - Add unit tests in `backend/src/auth/auth.service.spec.ts` or controllers to verify that the logging methods are called with the correct parameters for all 4 auth lifecycle events.

6. **Build Quality:**
   - `npm run typecheck --workspace=backend` and `npm run lint --workspace=backend` must pass with zero errors.

## Tasks / Subtasks

- [ ] Task 1 — Create AuditLog Module & Service
  - [ ] Generate `AuditModule` and `AuditLogService` inside `backend/src/audit/`.
  - [ ] Export `AuditLogService` from `AuditModule` and import `AuditModule` into `AuthModule`.
  - [ ] Implement `logAuthEvent` injecting `PrismaService` to insert `AuditLog` records.

- [ ] Task 2 — Implement Triggering inside AuthService
  - [ ] Modify `AuthService.login()` or the auth controller to invoke `AuditLogService.logAuthEvent` on:
    - Login success
    - Login failure (differentiating between unknown emails and incorrect passwords)
  - [ ] Modify `AuthService.logout()` to log logout event.
  - [ ] Modify `StaffService` / password change handlers to trigger audit logs on password update events.

- [ ] Task 3 — Extract IP and User-Agent
  - [ ] Implement request decorators or interceptors to extract client IP (`req.ip` or forwarders) and User-Agent header and feed them to the audit log service.

- [ ] Task 4 — Write Unit & Integration Tests
  - [ ] Test `AuditLogService` database insertion.
  - [ ] Test successful/failed login audit log creation in `auth.service.spec.ts`.

- [ ] Task 5 — Verification and Build
  - [ ] Run `npm run typecheck` and `npm run lint` inside the `api` workspace.

## Dev Notes

### Schema Layout
The database schema (`backend/prisma/schema.prisma`) defines the relationship:
```prisma
model AuditLog {
  id             String    @id @default(uuid())
  organizationId String
  venueId        String?
  actorId        String
  actorEmail     String
  actorRole      StaffRole
  action         String
  resource       String
  resourceId     String?
  before         Json?
  after          Json?
  ipAddress      String?
  userAgent      String?
  timestamp      DateTime  @default(now())

  organization Organization  @relation(fields: [organizationId], references: [id])
  venue        Venue?        @relation(fields: [venueId], references: [id])
  actor        Staff         @relation("ActorLogs", fields: [actorId], references: [id])
}
```

### IP Address Extraction
Vercel Edge deployments automatically inject headers. The backend API must check `x-real-ip` and `x-forwarded-for` before falling back to `request.socket.remoteAddress`.

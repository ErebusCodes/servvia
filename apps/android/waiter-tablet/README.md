# Waiter Tablet

- **Status:** Target application, not yet created.
- **Target technology:** Kotlin / Android.
- **Target responsibility:** The single tablet ordering application. One app with two operating modes, **Staff Mode** and **Guest Mode** (change record CC-3).
- **Current implementation/source:** Transitional web predecessor and reference implementation: the "Order Tablet" page in `apps/web/admin-console` (`src/pages/order-tablet/`, built with `VITE_APP_MODE=tablet`). It already provides `Staff mode | Guest mode` in one table/order experience.
- **Stage 2 state:** Structural scaffold only. Product implementation has not started.
- **Next implementation trigger:** An approved Stage 3 task for this application.

## Operating modes

Both modes work in the same context: restaurant → service area → table → visit/session → menu → order → kitchen/service workflow. Differences between the modes are presentation, permissions and workflow, not separate applications.

| Mode | Operated by | Scope |
|---|---|---|
| **Staff Mode** | Waitstaff | Staff-operated ordering at the table (staff-operated mobile POS), as defined by the PRD. |
| **Guest Mode** | The customer at the table | Customer-operated table ordering, tied to the same table and visit (formerly the planned Customer Order Tablet, `apps/android/order-tablet/`, merged by CC-3). UX and detailed features are not yet defined. |

**Security boundary (PRD WT-4, WT-5):**
- Guest Mode never grants access to staff-authorised functionality. It is enforced by trusted application and backend controls, not by user-interface visibility alone.
- Entering Staff Mode requires successful staff authorisation. The native mechanism is an open owner decision (PRD O-20); the web predecessor's approved model (DL-081) is reference behaviour, not a requirement for this application.

Structure and ownership: [PRD/product-requirements.md, Part C](../../../PRD/product-requirements.md). Requirements: [PRD/product-requirements.md](../../../PRD/product-requirements.md).

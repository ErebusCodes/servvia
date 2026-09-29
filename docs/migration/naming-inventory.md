# Verdura → Servvia naming inventory

The product is **Servvia**. New docs, code, comments, UI text and project names use Servvia. Existing "Verdura" identifiers are **not** mass-renamed. Each one is classified below.

**Scan of 2026-09-28:** 596 tracked or unignored files mention "verdura", case-insensitive. Excluded from the count: `node_modules`, build output and `package-lock.json`.

| Area | Files |
|---|---|
| `_bmad-output` | 146 |
| `apps/api` | 135 |
| `apps/venue-connector` | 103 |
| `apps/idealpos-*` | 64 |
| `apps/admin-console` | 37 |
| `docs` | 42 |
| `apps/customer-website` | 18 |
| `scripts` | 12 |
| `windows-deploy` | 8 |
| `apps/window-display` | 6 |

The working tree also holds an **uncommitted** partial rename by the owner: README, DESIGN, PRODUCT, `.claude` skills, some UI strings and the BMAD docs. Commit it on its own, before or after migration commits, so each diff stays reviewable.

## Classes

| Class | Meaning | Rule |
|---|---|---|
| **A** | User-facing text | Safe to rename in any change that touches the file |
| **B** | Internal identifier with no external dependency | Controlled rename, with tests. Persisted client keys need read-old/write-new. |
| **C** | Production, infrastructure or external identifier | Do not rename without a migration plan and approval |
| **D** | Historical record | Leave intact |

## Inventory

| Identifier / location | Class | Notes |
|---|---|---|
| UI copy "Verdura" in `apps/admin-console`, `apps/customer-website`, `apps/window-display` (about 80 occurrences) | A | Brand text, page titles, footer, alt text |
| Staff-visible `POSSyncRecord.errorMessage` "Order was cancelled in Verdura…" (`legacy-external-pos-handoff.ts`) | A | Kept verbatim in the Phase B move. It goes away with the legacy boundary. |
| Log and comment text "Verdura" in `apps/api/src` (about 83) | A/B | Update opportunistically when a file is edited for another reason |
| Seed org "Verdura", venue "Verdura Auckland", `owner@verdura.co.nz` (`prisma/seed.ts`, `shared/local-dev.mjs`) | B | Dev fixture only. Integration tests may assert these names. |
| Browser storage keys: `verdura_menu_*_v*`, `verdura_kiosk_*_v*`, `verdura-order-tablet-pending-submission-v*`, `verdura_reservation_draft`, `verdura-venues`, `verdura-admin-nav-expanded`, `verdura_default_report_view`, `verdura-kiosk-fullscreen-accepted` | B | **Persisted on devices.** A bare rename silently drops state. For the Order Tablet pending-submission key, that would drop an unsent order. Read the old key, write the new key, delete the old. |
| CSS/animation names `verdura-spin`, `verdura-pulse`, component `VerduraLeaf` | B | Safe with a build and visual check |
| `VERDURA_DEV_STATE_PATH` (`scripts/dev-lock.mjs`) | B | Dev tooling. Accept both names for one release. |
| `VERDURA_TABLE_NUMBER` | B | Check its consumers before renaming |
| System actor emails `kiosk-system+<org>@verdura.internal` and similar (`orders.service.ts` and others) | C | **Stored in `Staff` rows.** A rename creates duplicate system actors. Needs a data migration. |
| `verdura.waiterpad.token.v*` | C | IdealPOS wire/token format. It retires with IdealPOS rather than being renamed. |
| CORS origins `verdura.co.nz`, `admin.`, `kiosk.` (`main.ts`); email sender `no-reply@verdura.co.nz`, `bookings.verdura…` | C | DNS, email domain and SPF/DKIM. Change only with the domain move. |
| Dev JWT defaults `verdura-local-dev-only-*-secret-*` | C | The production boot check refuses these values. Renaming them changes the refusal list, so change both together. |
| Database names `verdura_dev`, `verdura_production`, `verdura_reconciled_dev`; role `verdura` | C | Production database identity (DL-114). Needs approval. |
| Docker compose project `name: verdura`; volumes `verdura-postgres`, `verdura-media` | C | Renaming recreates containers and orphans volumes. The governed Redis compose file warns about this explicitly. |
| Windows services `VerduraAPI`, `VerduraPostgreSQL`, `VerduraConnector`, `VerduraIdealposBridge`, `VerduraOrderTablet`…; paths `C:\ProgramData\Verdura\…`, `verdura_MVP` checkouts; scheduled task `VerduraPostgresBackup` | C | Production host (Dunedin). Needs approval and a maintenance window. |
| GCS buckets `verdura-media-originals-*`, `verdura-media-public-*`; service account `verdura-media-api@…` | C | Cloud production resources. Public URLs are embedded in stored `MediaAsset` and `MenuItem.imageUrl` rows. |
| .NET assemblies `VerduraIdealposBridge`, `VerduraIdealposTracer.*`, `VerduraIdealposHarness` | C | Deployed binaries and service registrations. The IdealPOS ones retire rather than being renamed. The connector's reusable parts get a Servvia name in `services/venue-edge`. |
| Prisma migration names and contents | D | Never edited |
| `docs/decisions-log.md` title and entries, `docs/domain-model.md`, `docs/integrations/*`, `_bmad-output/**` | D | Historical record. New entries use Servvia. |

# Servvia PRD — Volume 03: Recipe and Production

> **Status:** Normative Servvia domain volume, version label **v5.1 (Servvia)**, last updated 2026-10-05.
> **Authority:** subordinate to [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict, and to [`00-overview-and-conventions.md`](00-overview-and-conventions.md), whose invariants (INV-n), labels and decision register apply here without restatement.
> **Committed scope:** only MENU-2 (structured nutrition and allergens per menu item, shown during browsing) and its enterprise mechanisms are `TARGET`. Recipe, yield, costing and production management, allergen alerting and allergen labels are owner-approved long-term capabilities (DEC-X-1 inclusion resolved, owner 2026-10-05; SPRD §13) labelled `TARGET CAPABILITY — FUTURE DELIVERY`: they are not committed current delivery scope, and their delivery phase and order are DEC-X-17. Multi-venue central-kitchen production and assisted recipe drafting are not KitchenOS-described and stay `FUTURE`. Nothing labelled `TARGET CAPABILITY — FUTURE DELIVERY` or `FUTURE` may be planned before DEC-X-17 (and, for `FUTURE`, a scope decision) places it.
> **Provenance:** Servvia baseline (SPRD MENU-1, MENU-2, MENU-4, MENU-5, MENU-6, AVL-1, ORD-1, KIT-1, PR-3, PR-6, PR-9; Part B; Part C) plus enterprise hardening. Owner-approved capabilities from KitchenOS (basis `K(Lnnn)`, volume 00 §00.3) are translated into Servvia-native requirements; KitchenOS architecture, numbers and compliance assertions are not adopted. Domain mechanisms were adapted from the Verdura v5.2 PRD volume 03 and consolidated §6/WF-2 as **non-authoritative source material**; the classification matrix is held outside the repository as handoff evidence (2026-10-05).
> **No food-regulatory claims.** Servvia records and displays venue-declared allergen and nutrition data. It does not certify, verify or label food for any jurisdiction (DEC-RCP-5, DEC-X-5).
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 03.1 Purpose, scope and state

**Purpose.** Recipe and production connects what a venue sells (menu items, Core orders) with what it consumes (materials, volume 04). Once committed, it gives every sold item an exact, reproducible ingredient consumption, a cost per portion with history, measured yield, and controlled preparation of intermediate products. Today its only committed part is the per-item allergen and nutrition declaration of MENU-2.

**Labelling rule for this volume.** Capabilities that SPRD §13 deferred and that the owner approved on 2026-10-05 as part of the long-term target product (DEC-X-1 inclusion resolved; KitchenOS L205–L207, L223, L245, L319, L469–L470) are labelled `TARGET CAPABILITY — FUTURE DELIVERY` at capability and requirement level: owner-approved destination, not committed current delivery scope, phase and order DEC-X-17. Capabilities mined from Verdura that KitchenOS does not describe stay `FUTURE` (candidate scope needing its own scope decision).

| Capability | State | Basis |
|---|---|---|
| Allergen and nutrition data per menu item, shown during browsing (MENU-2) | `TRANSITIONAL` in Nest: `MenuItem.nutritionalDetails` is an untyped JSON column; the Admin Console menu editor offers a fixed client-side list of eight allergens; server-side enforcement of the list is not evidenced. Core channel-menu read exposes `nutritionalDetails` (`contracts/openapi/menu-read.yaml`; implemented in Core, not in production). `TARGET`: structured, server-validated data (RCP-1 to RCP-7) | S (MENU-2) + repository observation |
| Menu item availability (MENU-6, AVL-1) | `TARGET`, owned by volume 02; referenced here only for stock-driven availability (volume 04) | S |
| Recipe master, versions, components and sub-recipes | `TARGET CAPABILITY — FUTURE DELIVERY` (DEC-X-1; phase DEC-X-17) | S+V(03 §3.1)+K(L206, L319) |
| Units and conversions for recipes | `TARGET CAPABILITY — FUTURE DELIVERY`; conversion data owned by volume 04 (INV-7) | S+V+K(L206) |
| Yield and loss factors | `TARGET CAPABILITY — FUTURE DELIVERY` | V(03 §3.4)+K(L205, L206) |
| Menu-item-to-recipe link and modifier deltas | `TARGET CAPABILITY — FUTURE DELIVERY` | V(03 §3.1, WF-R2)+K(L206) |
| Sales consumption explosion from Core order facts | `TARGET CAPABILITY — FUTURE DELIVERY`; trigger fact open (DEC-RCP-2) | V(03 WF-R3; consolidated WF-2), adapted+K(L203, L206) |
| Recipe costing, cost snapshots, margin | `TARGET CAPABILITY — FUTURE DELIVERY`; costing basis open (DEC-RCP-4) | V(03 §3.5)+K(L205, L223) |
| Computed allergen and nutrition rollup from recipes | `TARGET CAPABILITY — FUTURE DELIVERY` | V(03 §3.1, §3.6)+K(L207, L319, L470) |
| Allergen alerting (declared versus computed; order-line and customer allergen notes versus the declaration) | `TARGET CAPABILITY — FUTURE DELIVERY`; acknowledgement policy DEC-OPS-19 (P10); kitchen surface DEC-RCP-17 | K(L207)+E |
| Allergen label generation from the declaration in force | `TARGET CAPABILITY — FUTURE DELIVERY`; label format by jurisdiction pack (INV-22, P5); list governance DEC-RCP-5 (P10) | K(L245, L469)+E |
| Production orders, completion, posting, reversal | `TARGET CAPABILITY — FUTURE DELIVERY` | V(03 §3.2, WF-R4)+K(L206) |
| Multi-venue batch production (central kitchen) | `FUTURE` (not KitchenOS-described); scope open (DEC-RCP-14) | V(03 §3.3, WF-R5) |
| Production traceability (batch lineage) | `TARGET CAPABILITY — FUTURE DELIVERY`; depends on volume 04 batches | V(03 §3.3)+K(L206) |
| Recipe import and assisted drafting | `FUTURE` (not KitchenOS-described); AI use open (DEC-RCP-12) | V(03 WF-R1) |
| Nutrition label export per jurisdiction | `OWNER DECISION REQUIRED` (DEC-RCP-5, DEC-X-5) | V(03 §3.6) |
| Core package ownership for recipes and production | `ARCHITECTURE DECISION REQUIRED` (DEC-X-13: Go Core on PostgreSQL is decided; residual package name and boundary) | S (Part C §28) |

**Out of this volume:** menu CRUD, pricing, tax and availability propagation (volume 02, SPRD §7); stock, movements, batches and procurement (volume 04); accounting treatment of cost (volume 07); menu engineering and forecasting analytics (volume 08).

## 03.2 Actors and surfaces

| Actor (Servvia role) | Interest in this domain | Surface |
|---|---|---|
| Owner, admin | Configure allergen list governance, costing basis, approvals; see costs and margins | Admin Console |
| Manager | Maintain menu allergen and nutrition data (MENU-1 menu admin rights); review production, yield and coverage | Admin Console |
| Kitchen | Execute production; record actual consumption and output; view method steps | Admin Console today; a kitchen-side surface is DEC-RCP-17 |
| Cashier, waiter (Staff Mode) | Read allergen data to answer guests | Ordering surfaces (menu read) |
| Guest (Waiter Tablet Guest Mode, Kiosk, Customer Website, Window Display) | See allergens during browsing (MENU-2); nutrition and dietary data (WD-1) | Customer-facing menu reads |
| System actor (Core worker) | Explode consumption, recompute rollups, raise alerts | Core workers (D13 pattern) |
| Candidate domain roles (head chef, purchaser, finance) | Recipe authoring, costing review | Role model is DEC-X-2; not facts |

- **Windows POS:** no recipe, allergen or production behaviour is defined for it. Any POS display of allergen data is `DEFERRED — PENDING USER POS ANALYSIS REPORT` (SPRD §12).
- **KDS:** showing recipe method steps or allergen flags on kitchen tickets is not a KIT-4 field today. Allergen alerts reaching the kitchen (RCP-44) are `TARGET CAPABILITY — FUTURE DELIVERY`; which kitchen surface shows them, and method steps on the KDS, remain DEC-RCP-17.

## 03.3 Domain model and ownership

```text
MenuItem[02] (1) ── (1) AllergenDeclaration ── (N) AllergenRef ──> AllergenList (controlled)
MenuItem[02] (1) ── (1) NutritionDeclaration (per declared serving)

Recipe (1) ── (N) RecipeVersion ── (N) RecipeLine ──> Material[04] | Recipe (sub-recipe)
RecipeVersion (1) ── (N) MethodStep ; (1) ── (0..1) ComputedAllergenSet ; (0..1) ComputedNutrition
MenuItem[02] (1) ── (N) RecipeLink (effective-dated) ──> Recipe (type DISH)
ModifierOption[02] (1) ── (N) ModifierDelta ──> RecipeLine adjustments
LossFactor (versioned, material or category scope)
CostSnapshot ──> RecipeVersion × costing basis × as-of instant

ConsumptionExplosion ──> Core order fact (source) × RecipeVersion → material quantities → ConsumptionMovement[04]
ProductionOrder ──> RecipeVersion × output quantity × venue × target date
ProductionOrder → (optional) StockReservation[04] → IssueToProduction[04] + ProductionOutput[04] → Batch[04]
YieldRecord ──> ProductionOrder (expected vs actual)
ProductionRun (1) ── (N) ProductionOrder → Transfers[04] (multi-venue, DEC-RCP-14)
```

**Design rules.**
- **Recipes never hold stock.** A prepared intermediate is an ordinary material (volume 04, type "prepared") with batches; all stock, expiry, count and recall mechanisms apply to it unchanged.
- **Recipes never price.** Price, tax and totals stay with Core pricing (PR-3, ORD-2). Costing reads prices only to derive margin.
- **Consumption is derived from canonical order facts**, never from client reports, and never alters an order.

| Entity | Scope (INV-2) | Canonical owner (target) | Current state |
|---|---|---|---|
| AllergenList | Platform or organization (DEC-RCP-5) | Core `internal/menu/` | Client-side list in Admin Console only |
| AllergenDeclaration, NutritionDeclaration | Organization (item); venue override per MENU-4 is DEC-RCP-11 | Core `internal/menu/` (Nest `apps/api/` transitional) | `TRANSITIONAL` (JSON column) |
| Recipe, RecipeVersion, RecipeLine, MethodStep, ModifierDelta, RecipeLink | Organization; venue variants DEC-RCP-11 | Not yet created (DEC-X-13) | None |
| LossFactor | Organization | Not yet created (DEC-X-13) | None |
| CostSnapshot | Organization, optionally venue | Not yet created (DEC-X-13) | None |
| ConsumptionExplosion record | Venue | Not yet created (DEC-X-13); posts into volume 04 owner | None |
| ProductionOrder, ProductionRun, YieldRecord | Venue (run: organization) | Not yet created (DEC-X-13) | None |

## 03.4 Business objects and lifecycles

### 03.4.1 AllergenDeclaration and NutritionDeclaration (TARGET)

| Field | Rule |
|---|---|
| Allergen set | Zero or more identifiers from the controlled AllergenList; a set, not free text (RCP-1) |
| Declaration status | `not_declared` or `declared`; `declared` with an empty set means "declared free of listed allergens", which differs from `not_declared` (RCP-7) |
| Nutrition values | Calories (kcal), protein, carbohydrates, fat (grams): decimals with explicit unit (INV-7); each value individually optional; absent is not zero (RCP-2) |
| Basis | Per serving as sold (one unit of the menu item) |
| Source | `manual` today; `computed` or `manual_override` once recipes exist (RCP-24, RCP-25) |
| Audit | Every change attributed, with before and after (INV-15) |

**Invariants:** allergen identifiers outside the active list are refused (INV-16 stable error); retiring an allergen identifier from the list is refused while any declaration references it (INV-11).

### 03.4.2 Recipe and RecipeVersion (TARGET CAPABILITY — FUTURE DELIVERY)

| Field | Rule |
|---|---|
| Number, name, category | Human number from a series (INV-9); name unique per organization |
| Type | `dish` (linked to menu items), `prep` (produces a prepared material), `component` (reusable fragment, no stock output) |
| Output | `dish`: portion count and portion description; `prep`: output material and quantity with unit |
| Lines | Ingredient (material or sub-recipe), quantity and unit (INV-7), optional loss-factor override, `approximate` flag |
| Method steps | Ordered text, optional duration and temperature as data, optional media (media ownership O-8) |
| Version state | `draft → pending_approval (if configured) → active → retired`; `draft → discarded` |
| Effective from | Instant from which an `active` version governs; may be future-dated |
| Completeness | Share of lines with confirmed quantity and unit; informational, never blocks use |

**Lifecycle invariants.**
- At most one version of a recipe is in force at any instant; activating a version with an effective time ends the previous one at that same instant (no gap, no overlap).
- An `active` or `retired` version is immutable; change means a new version (INV-11).
- Activation is refused (stable error) if the resulting graph has a cycle (RCP-12), exceeds the configured depth (RCP-13), or contains a line whose unit cannot be converted to the material's base unit (RCP-14).
- A recipe referenced by an in-force parent version or by a menu-item link cannot be retired without first re-pointing or retiring the referrer (RCP-41).

### 03.4.3 RecipeLink and ModifierDelta (TARGET CAPABILITY — FUTURE DELIVERY)

- **RecipeLink:** menu item → `dish` recipe, effective-dated, at most one in force per item and scope at any instant. Ending a link returns the item to "unmapped" coverage status (RCP-23).
- **ModifierDelta:** keyed by modifier option identifier (PR-6, MENU-5), never by name. Operations: add line, remove line, scale line by a factor, substitute ingredient. Deltas apply after base explosion and before loss factors.

### 03.4.4 LossFactor and YieldRecord (TARGET CAPABILITY — FUTURE DELIVERY)

- **LossFactor:** trim (raw to usable) and cooking (usable to cooked) fractions at material or category scope, versioned with effective dates. A line override takes precedence over material, which takes precedence over category.
- **YieldRecord:** per production order and, where captured, per line: expected quantity, actual quantity, variance quantity, variance value at the costing basis. Created automatically at posting; never edited.
- **Factor suggestions:** a persistent variance proposes a factor change. A suggestion is accepted or dismissed with a reason; it never changes a factor silently.

### 03.4.5 CostSnapshot (TARGET CAPABILITY — FUTURE DELIVERY)

Immutable record of a recipe version's cost per output unit at an instant: basis (DEC-RCP-4), material cost inputs used (with their source references), loss factors used, completeness (any line with unknown cost marks the snapshot `incomplete`; unknown cost is never zero), currency (INV-6). Recomputations create new snapshots; old snapshots are retained per DEC-RCP-15.

### 03.4.6 ConsumptionExplosion (TARGET CAPABILITY — FUTURE DELIVERY)

| Field | Rule |
|---|---|
| Source key | The Core order fact that triggered it (DEC-RCP-2): organization, venue, order, round, line identifiers and fact version |
| Business instant | The instant of the source fact; governs which recipe version, link, deltas and loss factors apply (RCP-20) |
| Result | Material quantities in base units, with lineage (item → link → version → lines → sub-recipes) |
| State | `pending → posted`; `pending → parked (reason) → pending` after the cause is fixed; `posted → reversed` (by a linked reversal) |
| Coverage | `exploded`, `unmapped` (no link in force), `partial` is not a valid outcome |

**Invariants:** one non-reversed explosion per source key (unique constraint, INV-12); all material lines of one explosion post together or not at all (Part B row K); a parked explosion posts nothing.

### 03.4.7 ProductionOrder (TARGET CAPABILITY — FUTURE DELIVERY)

| Field | Rule |
|---|---|
| Recipe version, planned output | Scaled from the version's output definition |
| Venue, stock site, target date | Venue-scoped (INV-2) |
| Demand source | `manual`, `par_level`, `event` (volume 02 catering, TARGET CAPABILITY — FUTURE DELIVERY), `forecast` (volume 08, TARGET CAPABILITY — FUTURE DELIVERY; a recommendation under INV-21) |
| State | `planned → reserved (optional, DEC-MAT-11) → in_progress → completed → posted`; `planned` or `reserved → cancelled` |
| Actuals | Actual inputs and actual output, prefilled from plan; `unverified` flag when completed without confirming actuals |
| Output batch | Batch and expiry from the shelf-life rule (DEC-RCP-10) |

**Invariants:** `posted` is immutable; correction is a linked reversal production document (INV-11). Cancelling releases any reservation. Transitions use version compare-and-set (INV-10).

### 03.4.8 ProductionRun (FUTURE, not KitchenOS-described; DEC-RCP-14)

Groups production orders for one preparation session across recipes; aggregates input demand; splits outputs to destination venues by two-step transfers (volume 04). Run, output batches, transfers and destinations stay linked for traceability.

## 03.5 Requirements

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| RCP-1 | A menu item's allergens are a set of identifiers from one controlled allergen list. The server refuses any identifier not on the active list with a stable error and stores nothing. | MUST | TARGET (mechanism); the list contents await the applicable compliance and business determination (DEC-RCP-5) before production use | S (MENU-2, PR-3) + E |
| RCP-2 | Nutrition values (calories, protein, carbohydrates, fat) are stored as typed decimals with explicit units per declared serving. An absent value is stored and shown as unknown, never as zero. | MUST | TARGET | S (MENU-2) + E (INV-7) |
| RCP-3 | Allergen and nutrition data are returned with the item by every menu read that serves an ordering or display surface (Waiter Tablet both modes, Kiosk, Customer Website, Window Display WD-1), and changes take effect on the next read without rebuild or cache flush (MENU-6 semantics). | MUST | TARGET | S (MENU-2, MENU-6, WD-1, WEB-2) |
| RCP-4 | Every change to an item's allergen or nutrition declaration emits an audit record with actor, before and after values and correlation ID (INV-15). | MUST | TARGET | S (NFR-AUD) + E |
| RCP-5 | The declaration in force for an item at any past instant within the audit retention period can be reconstructed. | SHOULD | TARGET | E; longer retention DEC-RCP-15 |
| RCP-6 | Surfaces present allergen data as venue-declared information. No surface labels it as certified, verified or compliant. Any disclaimer wording is set by DEC-RCP-5. | MUST | TARGET | S+E+D |
| RCP-7 | "Not declared" and "declared free of listed allergens" are distinct states in storage, API and every display. | MUST | TARGET | E |
| RCP-8 | A recipe has a type (`dish`, `prep`, `component`), an output definition, lines and optional method steps, and belongs to one organization. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.1)+K(L206, L319) |
| RCP-9 | Recipe versions follow the lifecycle of 03.4.2. An active or retired version is immutable; at most one version is in force at any instant; activation may be future-dated. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.1) + S (INV-10, INV-11)+K(L206, L319) |
| RCP-10 | Every derived fact (explosion, cost snapshot, production order, yield record) records the recipe version and loss-factor versions it used, so the same inputs reproduce the same result. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | E+K(L206, L319) |
| RCP-11 | A recipe line references a material or a sub-recipe with a decimal quantity and explicit unit, an optional loss-factor override and an optional `approximate` flag. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.1) + INV-7+K(L206, L319) |
| RCP-12 | Activation is refused if it would create a cycle in the sub-recipe graph, evaluated over all versions in force at the new version's effective time and after. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.1) + E+K(L206, L319) |
| RCP-13 | Sub-recipe nesting depth is bounded by a configured limit; activation beyond the limit is refused. The limit value is DEC-RCP-8. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-8 | E+D+K(L206, L319) |
| RCP-14 | Every line unit must convert to the material's base unit through explicit conversion data (volume 04); activation is refused otherwise. No implicit or name-based conversion. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-7)+K(L206, L319) |
| RCP-15 | Scaling a recipe (production planning, portion multiples) is linear in output quantity; non-linear scaling is not modelled. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | E+K(L206, L319) |
| RCP-16 | Loss factors are versioned with effective dates and resolved line override → material → category. A factor change never alters posted facts. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.4) + INV-11+K(L206, L319) |
| RCP-17 | A menu item links to at most one `dish` recipe in force per scope at any instant; links are effective-dated and audited. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 WF-R2)+K(L206, L319) |
| RCP-18 | Modifier deltas are keyed by modifier option identifiers (PR-6) and support add, remove, scale and substitute. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.1) + S (PR-6)+K(L206, L319) |
| RCP-19 | Sales consumption is computed by a Core consumer of durable order facts (D13 pattern) when the trigger fact of DEC-RCP-2 commits; the result is posted to volume 04 as a consumption movement. No client computes or posts consumption. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-2 | V(consolidated WF-2), adapted to S (PR-1, PR-2, INV-13)+K(L203, L206) |
| RCP-20 | Explosion resolves link, recipe version, modifier deltas and loss factors as in force at the source fact's business instant, not at processing time. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | E+K(L203, L206) |
| RCP-21 | Explosion is idempotent per source key: redelivery of the same fact returns the existing result and posts nothing new. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-12, INV-13)+K(L203, L206) |
| RCP-22 | When a source line is cancelled, voided or otherwise compensated in Core (semantics per DEC-RCP-2), the linked explosion is reversed by a linked reversal movement; nothing is edited. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-2 | S (PR-9, INV-11) + D+K(L203, L206) |
| RCP-23 | A sold item with no recipe link in force is recorded as `unmapped` with its quantity, and handled per DEC-RCP-3; it is never silently ignored. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-3 | V(03 WF-R3) + D+K(L203, L206) |
| RCP-24 | Once a menu item is linked, its computed allergen set is the union of its ingredients' allergen profiles through all sub-recipes and modifier deltas. Displayed allergens are the union of computed and manually declared allergens; a manual declaration can add but never remove a computed allergen. A declared set that lacks a computed allergen raises a review task. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.1) + E+K(L207, L319) |
| RCP-25 | Computed nutrition per serving is derived from material nutrition data through sub-recipes and loss factors, with a completeness indicator. Precedence between computed and manually declared values is DEC-RCP-13. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-13 | V(03 §3.6) + D+K(L206, L470) |
| RCP-26 | Recipe cost rolls up recursively through sub-recipes on the basis set by DEC-RCP-4 and is recorded as an immutable cost snapshot (03.4.5). A line with unknown cost marks the snapshot incomplete. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-4 | V(03 §3.5) + E+K(L205, L223) |
| RCP-27 | Margin per item and channel is derived from the Core-computed price and the current cost snapshot, on the tax basis set by DEC-RCP-4. Margin is management information; it never feeds pricing. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-4 | V(03 §3.5) + S (PR-3)+K(L205, L223) |
| RCP-28 | An activated material cost change recomputes affected cost snapshots through the dependency graph and raises an alert ranked by margin impact, with acknowledgment recorded. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(03 WF-R6)+K(L205, L223) |
| RCP-29 | A what-if cost simulation (price, portion, substitution) never writes canonical state. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §5.6)+K(L205, L223) |
| RCP-30 | Production orders follow 03.4.7; every transition is idempotent and serialised by version compare-and-set. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.2) + S (INV-10, INV-12)+K(L206) |
| RCP-31 | Where reservations are enabled (DEC-MAT-11), reserving a production order checks available-to-promise and returns a shortfall list instead of reserving a partial or negative quantity. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-11 | V(03 WF-R4, 04 §3.12)+K(L206) |
| RCP-32 | Posting a completed production order atomically records the issue of inputs and the output receipt in volume 04, creates the output batch with expiry from the shelf-life rule, releases any reservation and writes yield records. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 WF-R4) + S (Part B row K)+K(L206) |
| RCP-33 | Completing without confirming actuals posts the plan as actuals with an `unverified` flag that stays on the record and is reported. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.2)+K(L206) |
| RCP-34 | A posted production order is corrected only by a linked reversal production document carrying actor and reason. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (PR-9, INV-11)+K(L206) |
| RCP-35 | Production and preparation waste is declared through volume 04 waste movements with a reason and a reference to the recipe or production order. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §5.8) + V(04 §3.10)+K(L205) |
| RCP-36 | A production output batch records the input batches consumed where inputs are batch-managed, enabling backward and forward trace (volume 04 recall). Sales consumption is not batch-specific; forward trace to orders is a time-window exposure and is labelled as such. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §3.3) + E+K(L206) |
| RCP-37 | A production run groups orders, aggregates inputs, and splits outputs to destination venues by two-step transfers, keeping lineage. | MAY | FUTURE | V(03 §3.3, WF-R5) + D (DEC-RCP-14) |
| RCP-38 | Recipe version activation and production posting can require approval through the shared approval mechanism (00.7) with separation of duties; which actions and thresholds is DEC-RCP-7 within DEC-X-7. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-7 | V(03 §6) + S (INV-4) + D+K(L206) |
| RCP-39 | Recipe import (spreadsheet or document) produces drafts only; every line is confirmed by a human before activation. Any assisted drafting runs outside the transaction path (`data/`) and is DEC-RCP-12. | MUST | FUTURE | V(03 WF-R1) + S (Part C §29) + D |
| RCP-40 | Before activation, a where-used impact preview lists affected menu items, parent recipes, open production orders and the cost change. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §5.2)+K(L206) |
| RCP-41 | Recipes, lines' materials and loss factors referenced by in-force records are deactivated, never deleted (INV-11). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-11)+K(L206) |
| RCP-42 | Concurrent activations of versions of the same recipe are serialised; exactly one succeeds and the other receives a stable conflict error. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-10)+K(L206) |
| RCP-43 | Coverage is reported per venue and period as defined in 03.12. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(03 §8)+K(L205, L206) |
| RCP-44 | Core raises an allergen alert, as a persisted, attributed record shown on the relevant staff surface, when (a) an item's manually declared allergen set lacks an allergen computed from its recipe in force (RCP-24), shown to users holding the declaration-edit permission in the Admin Console until resolved by a new declaration or a recorded dismissal with reason; or (b) an order line carries a structured allergen note (identifiers from the controlled list) entered through an ordering surface, or the visit is explicitly linked by staff to a customer whose profile dietary note (volume 05 CRM-14) lists an allergen, and the declaration in force for the item, including its selected modifier options, contains that allergen or is `not_declared`. Case (b) is shown on the ordering staff surface before submission and, for order-line notes, on the kitchen surface selected by DEC-RCP-17; profile notes reach the kitchen only if staff copy them onto the order line (CRM-15). A `not_declared` item is alerted as "allergen information not declared", never as "no conflict"; free-text notes are displayed but never machine-matched; if the declaration or rollup cannot be evaluated (stale or unavailable), the alert says so rather than showing nothing. Alerts are advisory venue information: they never change the order, the declaration or any price, never state that an item is safe, and carry no compliance claim (RCP-6). Whether an alert must be acknowledged before submission or preparation, and by whom, is DEC-OPS-19 (P10); any acknowledgement is audited with actor and device (INV-5, INV-15). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-OPS-19, DEC-RCP-17 | S (MENU-2, PR-4)+K(L207)+E+D |
| RCP-45 | An authorised user can generate an allergen label for a menu item, or for a prepared-material batch produced under RCP-32, from the allergen declaration in force at generation time (for a batch: the allergen set of the recipe version used, computed under RCP-24 together with any manual declaration). Label layout, mandatory content and wording come only from an active jurisdiction label format in a jurisdiction pack (INV-22); with no active, validated pack for the venue, or for an item whose declaration is `not_declared`, generation is refused with a stable error and no label is produced. Each generated label records the item or batch, the declaration or recipe version used, the pack format version, the actor and the time, and is audited (INV-15); reprints are explicit and linked. A later declaration change never rewrites an issued label; items and batches whose issued labels predate the change are flagged for relabelling. Label printing uses venue printer routing through Venue Edge with truthful job states (EDGE-1, PRT-1, DEC-OPS-16). Allergen list governance stays DEC-RCP-5 (P10); a generated label is venue-declared information and carries no compliance claim (RCP-6). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-RCP-5 (P10); regulatory label formats P5 | S (MENU-2)+K(L245, L469)+E+D |

## 03.6 Workflows and failure paths

**WF-RCP-1 Maintain allergen and nutrition declaration (TARGET).**
1. Manager opens the item in the Admin Console, selects allergens from the controlled list, marks the declaration `declared`, and enters nutrition values with units.
2. Server validates identifiers and units (RCP-1, RCP-2), stores the declaration, writes audit and event in one transaction (INV-13).
3. Menu reads return the new declaration on next fetch (RCP-3).
- Failure: unknown allergen identifier or unit → stable validation error, nothing stored. Concurrent edit of the same item → version conflict; the second editor reloads (INV-10). Audit write failure → whole change fails (Part B row K).

**WF-RCP-2 Author and activate a recipe version (TARGET CAPABILITY — FUTURE DELIVERY).**
1. Create draft (form, clone, or import RCP-39). Unmatched ingredients may be created as materials (volume 04) or marked `approximate`.
2. Server computes a preview: cost (incomplete if any cost unknown), computed allergens, completeness, where-used (RCP-40).
3. Submit for activation. Server checks cycle, depth and conversions (RCP-12 to RCP-14); if approval is configured, it routes per DEC-RCP-7.
4. On activation the version is in force from its effective time; dependent cost snapshots and allergen rollups recompute (system actor); allergen differences raise review tasks (RCP-24).
- Failure: validation failure → refused with the failing line identified. Approval rejected → draft returns with reason. Concurrent activation → one wins (RCP-42). Recompute worker failure → retried, then dead-lettered and visible (INV-13); stale rollups are marked stale, never presented as current.

**WF-RCP-3 Sales consumption explosion (TARGET CAPABILITY — FUTURE DELIVERY).**
1. The trigger fact (DEC-RCP-2) commits in Core with its domain event.
2. The consumer receives the event (at least once), checks the source key (RCP-21), resolves link and versions at the business instant (RCP-20), explodes recursively, applies modifier deltas and loss factors, converts to base units.
3. It posts one consumption movement per explosion to volume 04 in the same transaction as the explosion record.
- Failure: no link → `unmapped` (RCP-23). Missing conversion, inactive material, or recipe graph unreadable → explosion `parked` with reason, task raised, nothing posted; after correction an authorised user or retry job re-queues it, and it explodes using the business-instant versions. Volume 04 unavailable (same database, different package) → transaction fails, event redelivered. Duplicate event → no-op. Backlog → explosions process in source order per venue only where ordering matters for negative-stock evaluation (DEC-MAT-2); otherwise order-independent.

**WF-RCP-4 Correction of consumption (TARGET CAPABILITY — FUTURE DELIVERY).**
1. A Core compensating fact (line cancelled or voided per DEC-RCP-2) commits.
2. The consumer posts a linked reversal of the original explosion's movement; the explosion becomes `reversed`.
3. A recipe found to be wrong after sales is fixed by a new version; past explosions are not re-posted automatically. An explicit, approved reprocessing for a bounded period posts reversal and re-post pairs with a shared correlation ID (RCP-10, INV-11).
- Failure: compensating fact for an explosion that is still parked → the parked explosion is closed without posting. Reprocessing interrupted → each pair is atomic; restart continues by source key without duplicates.

**WF-RCP-5 Production order (TARGET CAPABILITY — FUTURE DELIVERY).**
1. Create (manual, par-level proposal, event demand). Optionally reserve (RCP-31); a shortfall list may hand off a requisition draft (volume 04).
2. Start at station; complete with actual inputs and output (or plan-as-actual with `unverified`, RCP-33).
3. Post (approval if configured): atomic issue, output receipt, batch, yield records (RCP-32).
- Failure: stock moved between reservation and pick → re-reserve or proceed with reason. Input consumption beyond the configured tolerance (DEC-RCP-9) → approval required (DEC-RCP-7). Posting failure → nothing posted, order stays `completed`, retry is idempotent. Wrong posting → reversal (RCP-34).

**WF-RCP-6 Yield review (TARGET CAPABILITY — FUTURE DELIVERY).** Periodic variance per recipe and station → factor suggestions → accept (new factor version or new recipe version) or dismiss with reason (03.4.4).

**WF-RCP-7 Cost change ripple (TARGET CAPABILITY — FUTURE DELIVERY).** Volume 04 cost change event → incremental recompute → alerts ranked by margin impact → acknowledgment (RCP-28). Recompute failure is retried and visible; affected snapshots are marked stale until recomputed.

## 03.7 Security, authorization and audit

- Deny by default; scope from the verified credential (INV-2, INV-4). All recipe and production endpoints are staff-only; device identities and Guest Mode never write (INV-3, WT-4).
- **Authorization matrix (mechanism; role assignment beyond current Servvia roles is DEC-X-2):**

| Action | owner / admin | manager | kitchen | cashier | viewer | Guest / device |
|---|---|---|---|---|---|---|
| Edit allergen and nutrition declaration | Allow | Allow | Deny | Deny | Deny | Deny |
| Read allergen and nutrition data | Allow | Allow | Allow | Allow | Allow | Allow (menu read) |
| Author recipe drafts | Allow | Allow | Configurable (DEC-X-2) | Deny | Deny | Deny |
| Activate recipe version | Allow | Configurable (DEC-RCP-7) | Configurable | Deny | Deny | Deny |
| Execute production | Allow | Allow | Allow | Deny | Deny | Deny |
| Post or reverse production | Allow | Configurable (DEC-RCP-7) | Deny by default | Deny | Deny | Deny |
| View costs and margins | Allow | Configurable (DEC-RCP-16) | Configurable (DEC-RCP-16) | Deny | Configurable | Deny |
| Reprocess consumption | Allow | Deny | Deny | Deny | Deny | Deny |

- **Separation of duties** (mechanism, thresholds DEC-X-7): production executor differs from poster above threshold; recipe author differs from activator where approval is configured.
- **Audit (INV-15):** declaration changes, version activation and retirement, link changes, loss-factor changes, approvals, production posting and reversal, explosion parking and reprocessing, configuration changes.

## 03.8 Data governance

| Data | Class (INV-18) | Owner | Retention | Correction |
|---|---|---|---|---|
| Allergen and nutrition declarations | Public once published; history Internal | Organization | Audit at least 90 days (NFR-AUD); longer DEC-RCP-15 | New declaration, audited |
| Recipes, method steps | Confidential (trade knowledge) | Organization | DEC-RCP-15 | New version |
| Cost snapshots, margins | Financial / Confidential | Organization | DEC-RCP-15 | New snapshot; never edited |
| Explosion records, production and yield records | Internal (operational), value fields Financial | Venue | DEC-RCP-15 | Linked reversal |

- Media for method steps follow media ownership (O-8) and MENU-3 validation.
- Exports of recipes and costs are permission-checked and audited (INV-18).
- Data supplied to assisted drafting (DEC-RCP-12) must not include personal data; whether recipes may leave Servvia for an external AI provider is part of that decision.

## 03.9 Reliability, scalability and observability

- **Throughput dependency:** explosion volume equals sold line volume; capacity targets inherit DEC-X-8. Explosion is asynchronous and never on the order submission path (ORD-1 latency unaffected).
- **Recovery:** explosion and recompute are event-driven consumers (D13 pattern): at least once, idempotent, dead-lettered with alerting (NFR-REL).
- **Signals:** explosion backlog depth and oldest age; parked explosions by reason and age; unmapped quantity share; stale cost snapshots; recompute failures; production orders completed but not posted beyond an owner-set age (OWNER TARGET REQUIRED, DEC-RCP-18).
- **Freshness:** allergen and nutrition changes are visible on the next menu read (RCP-3); a general propagation target is SPRD §19 OWNER TARGET REQUIRED.

## 03.10 UX and accessibility

- Admin Console screens meet WCAG 2.1 AA (NFR-A11Y). Customer Website allergen display meets WEB-4; Kiosk display meets KSK-3; Android surfaces are SPRD §23 OWNER TARGET REQUIRED.
- Allergen display does not rely on colour or icon alone; each allergen has a text label (screen readers, low vision).
- "Not declared" is visibly distinct from "no listed allergens" (RCP-7).
- Recipe screens show: completeness, incomplete-cost and stale-rollup states, parked explosions with reason and recovery action, `unverified` production badges, and confirmation for activation, posting and reversal (SPRD §22).

## 03.11 Acceptance criteria

| ID | Scenario | Expected result | Covers |
|---|---|---|---|
| AC-RCP-1 | Manager saves allergens from the list and nutrition values with units | Stored; audit with before and after; next menu read on every surface returns them | RCP-1 to RCP-4 |
| AC-RCP-2 | Request with an allergen identifier not on the list | Stable validation error; nothing stored; no audit of a change | RCP-1 |
| AC-RCP-3 | Item with declaration `not_declared` and item `declared` with empty set | API and every display distinguish them | RCP-7 |
| AC-RCP-4 | Calories omitted | Stored and shown as unknown, never 0 | RCP-2 |
| AC-RCP-5 | Kitchen, cashier, viewer, device and Guest Mode credentials attempt a declaration edit | Each refused server-side; audit of denied attempt where security-relevant | 03.7 |
| AC-RCP-6 | Two managers edit the same item concurrently | One succeeds; the other gets a version conflict and nothing is overwritten | INV-10 |
| AC-RCP-7 | Credential of organization A reads or edits organization B's declarations or recipes | Refused; no data disclosed | INV-2 |
| AC-RCP-8 | Activate a version creating A → B → A | Refused with cycle error naming the path; nothing in force changes | RCP-12 |
| AC-RCP-9 | Activate a version with a line in a unit lacking conversion | Refused, line identified | RCP-14 |
| AC-RCP-10 | Concurrent activation of two versions of one recipe | Exactly one in force; other gets conflict | RCP-42 |
| AC-RCP-11 | Sale before and after a future-dated version's effective time, processed late | Each explosion uses the version in force at its business instant | RCP-20 |
| AC-RCP-12 | Same order fact delivered three times | One explosion, one movement | RCP-21 |
| AC-RCP-13 | Line cancelled in Core after explosion | Linked reversal; explosion `reversed`; net consumption zero | RCP-22 |
| AC-RCP-14 | Explosion needs a missing conversion | Parked with reason; nothing posted; task raised; after fix, re-queue posts once | WF-RCP-3 |
| AC-RCP-15 | Sold item without link | Recorded `unmapped` with quantity; coverage reflects it | RCP-23 |
| AC-RCP-16 | Ingredient adds an allergen not in the manual declaration | Displayed set includes it; review task raised; manual removal of a computed allergen refused | RCP-24 |
| AC-RCP-17 | Material cost unknown for one line | Cost snapshot `incomplete`; never zero cost | RCP-26 |
| AC-RCP-18 | What-if simulation executed | No canonical record or event changes | RCP-29 |
| AC-RCP-19 | Production posting with a failure in output batch creation | Nothing posted; order stays `completed`; retry posts once | RCP-32 |
| AC-RCP-20 | Production completed without editing actuals | Posted with `unverified`; visible in reports | RCP-33 |
| AC-RCP-21 | Reverse a posted production | Linked reversal movements; original unchanged; audit with reason | RCP-34 |
| AC-RCP-22 | Explosion worker stopped for a period, then restarted | Backlog drains without loss or duplication; backlog metrics and alerts observed | 03.9 |
| AC-RCP-23 | In Staff Mode, staff link a customer whose profile note lists an allergen contained in an item being added, and add a second item whose declaration is `not_declared`; then the kitchen surface is checked | Before submission an alert names the matched allergen and a separate "allergen information not declared" alert appears for the second item; the KDS shows the allergen only after staff copy it onto the line; no order, declaration or price changed; any acknowledgement required by DEC-OPS-19 is audited | RCP-44, CRM-15 |
| AC-RCP-24 | Generate an allergen label with no active validated jurisdiction pack; then with one; then change the item's declaration | First request refused with a stable error and nothing produced; second label records declaration version, pack format version, actor and time; after the change the issued label is unchanged and the item is flagged for relabelling | RCP-45 |

## 03.12 KPIs and metric definitions

| Metric | Definition | Target |
|---|---|---|
| Allergen declaration coverage | Active, orderable menu items with declaration status `declared` ÷ all active, orderable menu items, per venue, at a point in time | OWNER TARGET REQUIRED (DEC-RCP-18) |
| Recipe coverage (sales-weighted) | Sold quantity of items with a link in force at sale ÷ total sold quantity, per venue and period (business date per DEC-X-3) | OWNER TARGET REQUIRED (DEC-RCP-18) |
| Theoretical-versus-actual variance | (Theoretical consumption − actual consumption from counts, volume 04) ÷ theoretical consumption, per material, valued at the costing basis, per count interval | OWNER TARGET REQUIRED (DEC-RCP-18) |
| Parked explosion rate and age | Explosions entering `parked` ÷ explosions created per period; oldest parked age | OWNER TARGET REQUIRED (DEC-RCP-18) |
| Yield variance | (Actual output − expected output) ÷ expected output per production order, aggregated per recipe and period | OWNER TARGET REQUIRED (DEC-RCP-18) |
| Unverified actuals rate | Posted production orders with `unverified` ÷ posted production orders per period | OWNER TARGET REQUIRED (DEC-RCP-18) |
| Cost snapshot completeness | Recipes in force whose latest snapshot is complete ÷ recipes in force | OWNER TARGET REQUIRED (DEC-RCP-18) |

Verdura evidence figures, recorded as proposed only: median recipe capture under 5 minutes; assisted-import acceptance above 70 % before expanding assisted extraction. **Proposed (Verdura evidence) — OWNER TARGET REQUIRED (DEC-RCP-18).**

## 03.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-RCP-1 | Sequencing of recipe scope relative to materials (volume 04, O-9). **Inclusion of both is resolved by DEC-X-1 (owner 2026-10-05)**; this sequencing is part of delivery phasing DEC-X-17 and is decided there | Explosion and production post into stock; costing needs material costs | Verdura gated recipes behind live, trusted inventory; alternatives: recipe-and-costing first without stock posting, or both together | Planning of RCP-8 onwards | 3 (under DEC-X-17) |
| DEC-RCP-2 | Consumption trigger fact and compensation semantics | Determines when stock decreases and how cancellations, voids, refunds and remakes reverse it | Round accepted (ORD-1); kitchen ticket completed (D4); check settled (D6); visit closed (D10). Refund without food return may or may not reverse consumption | RCP-19 to RCP-22 | 2 |
| DEC-RCP-3 | Handling of unmapped sold items | Variance accuracy versus entry burden | Record only; coarse one-to-one mapping for resale items (volume 04); block linking gaps from going live | RCP-23 | 3 |
| DEC-RCP-4 | Costing basis and margin tax basis | Cost, margin and their history depend on it; must align with valuation (DEC-MAT-3) and accounting (volume 07) | Last price, moving average, standard cost, FIFO layers; margin on tax-exclusive or tax-inclusive price | RCP-26, RCP-27 | 3 |
| DEC-RCP-5 | Allergen list governance and presentation | MENU-2 requires a fixed list; contents, scope and wording carry legal exposure | Platform-wide list (current client list of eight); per-organization list; per-jurisdiction list; "may contain" support; disclaimer text; label export (with DEC-X-5) | RCP-1, RCP-6 | 3 — **COMPLIANCE/CONFIGURATION DECISION, required before relevant production use** (not a PRD-acceptance blocker; no list is fixed by the PRD) |
| DEC-RCP-6 | Dietary tags (for example vegetarian, vegan, gluten-free) beyond MENU-1 spicy flag | Claims of suitability carry the same exposure as allergens | Not offered; venue-declared tags with the RCP-6 rule; computed from recipes | Any dietary tag requirement | 3 |
| DEC-RCP-7 | Which recipe and production actions require approval, and thresholds (within DEC-X-7) | Activation ripples into cost and consumption; posting changes stock value | Activation by owner/admin only; two-person activation; posting approval above value or tolerance | RCP-38 | 3 |
| DEC-RCP-8 | Maximum sub-recipe nesting depth | Bounds recursion and recompute cost | Any configured integer; no value proposed by Servvia or Verdura | RCP-13 | 2 |
| DEC-RCP-9 | Production input over-consumption tolerance | Distinguishes normal variance from loss needing approval | Percentage or quantity per recipe or category; no value proposed | WF-RCP-5 approvals | 3 |
| DEC-RCP-10 | Shelf-life rules for prepared outputs and who maintains them | Output batch expiry drives FEFO and expiry handling (volume 04) | Per material; per category; per recipe | RCP-32 | 3 |
| DEC-RCP-11 | Organization-shared recipes and declarations with venue variants | MENU-4 allows shared items with venue overrides | Organization recipe only; venue variant versions; venue override of declaration | Multi-venue recipe use | 2 |
| DEC-RCP-12 | Assisted recipe drafting (spreadsheet, document, AI) | Entry burden versus data handling; AI must stay outside the transaction path | No assistance; spreadsheet import only; AI drafting in `data/` with human confirmation | RCP-39 | 3 |
| DEC-RCP-13 | Precedence of computed versus declared nutrition; nutrition data sources and licensing | MENU-2 values may conflict with computed values | Declared wins; computed wins with declared as override; display both | RCP-25 | 3 |
| DEC-RCP-14 | Multi-venue batch production (central kitchen) scope. Not KitchenOS-described, so not included by DEC-X-1 (RCP-37 stays `FUTURE`); if included, its sequencing joins DEC-X-17 | Requires transfers and multi-venue planning | Out of scope; FUTURE after materials; committed with materials | RCP-37 | 3 |
| DEC-RCP-15 | Retention of recipe versions, cost snapshots, explosion, production and declaration history | Reproducibility versus storage; may depend on DEC-X-5 | Retain for life of organization; fixed periods | Retention jobs | 3 |
| DEC-RCP-16 | Visibility of costs and margins to kitchen and manager roles | Cost data is Confidential; Verdura deliberately exposes it to chefs | Owner/admin only; grantable per role (DEC-X-2) | 03.7 matrix | 3 |
| DEC-RCP-17 | Kitchen-side surface for production and method steps; allergen flags on kitchen tickets | No kitchen production surface exists; KIT-4 fields are fixed | Admin Console only; KDS (Android) feature; none | Kitchen workflows WF-RCP-5; kitchen display of allergen alerts (RCP-44) | 2 |
| DEC-RCP-18 | Targets for the 03.12 metrics and the production posting-age alert | No approved targets exist | Verdura evidence figures (proposed only) | Alert thresholds; release acceptance of TARGET CAPABILITY — FUTURE DELIVERY and FUTURE capabilities | 3 |

Package placement for recipes and production is DEC-X-13; scope inclusion is DEC-X-1 (resolved 2026-10-05); delivery phasing DEC-X-17; role model DEC-X-2; approval thresholds DEC-X-7; allergen acknowledgement DEC-OPS-19; jurisdiction packs INV-22.

## 03.14 Future and deferred capabilities

| Capability | State | Precondition |
|---|---|---|
| Recipe master, versioning, links, deltas, explosion, costing, production (RCP-8 to RCP-36, RCP-38, RCP-40 to RCP-43) | TARGET CAPABILITY — FUTURE DELIVERY (owner 2026-10-05, DEC-X-1) | DEC-X-17 (with DEC-RCP-1), DEC-X-13 residual package decision |
| Allergen alerting and allergen labels (RCP-44, RCP-45) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-OPS-19 and DEC-RCP-5 (P10); an active validated jurisdiction pack for labels (INV-22, P5) |
| Multi-venue central-kitchen production runs (RCP-37) | FUTURE (not KitchenOS-described) | DEC-RCP-14 |
| Recipe import and assisted drafting (RCP-39) | FUTURE (not KitchenOS-described) | DEC-RCP-12 |
| Forecast-driven production proposals | FUTURE | Volume 08 forecasting (now TARGET CAPABILITY — FUTURE DELIVERY); par levels in use; any proposal is a recommendation under INV-21 |
| Menu-engineering suggestions (popularity × margin) | FUTURE, owned by volume 08 | Cost snapshots and sales history |
| Supplier specification ingestion (pack sizes, nutrition) | FUTURE | Supplier integration (DEC-MAT-15) |
| Waste-aware preparation planning | FUTURE | Waste analysis and forecasting |
| Nutrition label export per jurisdiction | OWNER DECISION REQUIRED (KitchenOS L470 describes nutrition display, which MENU-2 already covers) | DEC-RCP-5, DEC-X-5 |
| Windows POS display of recipe or allergen data | DEFERRED — PENDING USER POS ANALYSIS REPORT | SPRD §12 |

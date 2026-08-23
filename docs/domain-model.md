# Verdura — Domain Model

> **Normative domain decision — 2026-08-15:** The model must implement the [Target Operating Model](./target-operating-model.md). A Verdura order exists before in-person payment, is handed to Idealpos and then released through independent KDS/KOT channels. Online orders are released only after verified payment by default. Canonical records must preserve Verdura, Idealpos and payment-provider references plus independent POS, payment, KDS and per-printer state; no single `synced` or `paid` boolean is sufficient.

> **Target-model alignment — 2026-08-15:** Much of this document is aspirational. The implemented Prisma schema currently covers organizations, venues, staff, venue access, reservations, payments, menu, orders, printers, POS sync records and audit logs. It does not yet implement the PRD v5.2 brand/region hierarchy, canonical external orders, POS handoff/command delivery state machine, capability matrix, reconciliation cases, idempotency records, append-only audit hash chain, permission grants/FGA, approval engine, or the later MM/Recipe/Finance/CRM/Workforce domains.

**Recommendation:** split every entity below into `Implemented`, `Pilot required`, or `Deferred`; keep internal ULIDs separate from human number-series identifiers; add tenant-aware constraints; and make external provider facts immutable, versioned and correlated rather than embedding provider-specific assumptions in core entities.

**Phase 3 Output**
**Date:** 2026-06-18

> All entities are expressed as TypeScript interfaces. These are **logical** entities only — which physical database mapping is decided in Phase 4. No database-specific types, decorators, or ORM annotations appear here.
>
> Naming conventions: `id` fields are UUIDs (string). Timestamps are `Date`. Monetary values are integers in cents (NZD). Foreign key references use the pattern `entityId: string` alongside an optional nested type for when the entity is loaded/joined.

---

## Supporting Types and Enums

```typescript
// ─── Monetary ────────────────────────────────────────────────────────────────
/** Integer cents (NZD). Never a float. e.g. $18.50 → 1850 */
type Cents = number;

// ─── Allergens ───────────────────────────────────────────────────────────────
type Allergen =
  | 'gluten'
  | 'dairy'
  | 'eggs'
  | 'fish'
  | 'shellfish'
  | 'tree_nuts'
  | 'peanuts'
  | 'sesame'
  | 'soy'
  | 'sulphites';

// ─── Roles ───────────────────────────────────────────────────────────────────
type StaffRole = 'owner' | 'admin' | 'manager' | 'cashier' | 'kitchen' | 'viewer';

// ─── Order status lifecycle ───────────────────────────────────────────────────
type OrderStatus =
  | 'pending'       // Submitted, not yet acknowledged
  | 'confirmed'     // Acknowledged by kitchen/staff
  | 'preparing'     // Kitchen is actively preparing
  | 'ready'         // Ready for collection/service
  | 'completed'     // Delivered and closed
  | 'cancelled';    // Voided before preparation

// ─── POS sync status ─────────────────────────────────────────────────────────
type POSSyncStatus =
  | 'queued'
  | 'connector_accepted'
  | 'pos_submitted'
  | 'pos_confirmed'
  | 'failed'
  | 'uncertain'
  | 'manual'
  | 'not_applicable';

// ─── Reservation status lifecycle ────────────────────────────────────────────
type ReservationStatus =
  | 'pending'     // Awaiting confirmation (e.g. bank transfer payment)
  | 'confirmed'   // Booking accepted
  | 'seated'      // Party has arrived and been seated
  | 'completed'   // Reservation fulfilled
  | 'cancelled'   // Cancelled by guest or staff
  | 'no_show';    // Guest did not arrive

// ─── Payment method ──────────────────────────────────────────────────────────
type PaymentMethod = 'idealpos_eftpos' | 'idealpos_cash' | 'online_card' | 'bank_transfer' | 'pay_at_restaurant';

// ─── Payment status ──────────────────────────────────────────────────────────
type PaymentStatus =
  | 'not_required_yet'
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'cancelled'
  | 'refund_pending'
  | 'partially_refunded'
  | 'refunded'
  | 'waived';

type OrderSource =
  | 'verdura_staff_tablet'
  | 'verdura_customer_tablet'
  | 'verdura_kiosk'
  | 'verdura_online'
  | 'idealpos_pos';

// ─── Printer types and protocols ─────────────────────────────────────────────
type PrinterType = 'kitchen' | 'pos' | 'bar' | 'dessert' | 'label' | 'custom';
type PrinterConnectionType = 'tcp' | 'usb' | 'network' | 'windows_shared';
type PrinterProtocol = 'escpos' | 'pcl' | 'raw_text' | 'pdf';

// ─── Print job status ────────────────────────────────────────────────────────
type PrintJobStatus = 'queued' | 'printing' | 'printed' | 'failed' | 'cancelled';

// ─── Adapter type for IdealPOS integration ───────────────────────────────────
// Actual adapter in use is determined at runtime by venue config (Phase 5)
// 'local_agent' covers the proposed API-less Windows Connector + Idealpos POS
// Bridge combination (docs/integrations/idealpos.md §13–§18) when/if that path
// is proven viable — see the tracer bullet story 9-2. Not yet implemented.
type POSAdapterType = 'api' | 'sql' | 'odbc' | 'csv' | 'local_agent' | 'none';

// ─── Nutritional details ─────────────────────────────────────────────────────
interface NutritionalDetails {
  calories:      number | null;   // kcal per serving
  protein:       number | null;   // grams
  carbohydrates: number | null;   // grams
  fat:           number | null;   // grams
  fibre:         number | null;   // grams
  sodium:        number | null;   // milligrams
  allergens:     Allergen[];      // empty array = no allergens declared
  isVegan:       boolean;
  isVegetarian:  boolean;
  isGlutenFree:  boolean;
  isHalal:       boolean;
  notes:         string | null;   // free-text nutritional disclaimer
}

// ─── Address ─────────────────────────────────────────────────────────────────
interface Address {
  line1:      string;
  line2:      string | null;
  city:       string;
  region:     string | null;
  postcode:   string;
  country:    string;           // ISO 3166-1 alpha-2, e.g. 'NZ'
}

// ─── Operating hours ─────────────────────────────────────────────────────────
interface DayHours {
  open:   string;   // HH:MM in venue timezone, e.g. '11:00'
  close:  string;   // HH:MM, e.g. '22:00'
  closed: boolean;
}

interface OperatingHours {
  monday:    DayHours;
  tuesday:   DayHours;
  wednesday: DayHours;
  thursday:  DayHours;
  friday:    DayHours;
  saturday:  DayHours;
  sunday:    DayHours;
}
```

---

## Core Entities

### Organization

```typescript
/**
 * Top-level tenant. In single-restaurant mode this is Verdura itself.
 * In SaaS mode, each restaurant group or franchisee is an Organization.
 */
interface Organization {
  id:          string;
  name:        string;           // e.g. "Verdura Restaurant Group"
  slug:        string;           // URL-safe unique identifier, e.g. "verdura"
  logoUrl:     string | null;    // Object storage URL
  billingEmail: string;
  plan:        'single' | 'multi' | 'enterprise';
  isActive:    boolean;
  createdAt:   Date;
  updatedAt:   Date;
}
```

---

### Venue

```typescript
/**
 * A single physical restaurant location.
 * A single Organization has one or more Venues.
 */
interface Venue {
  id:               string;
  organizationId:   string;       // → Organization.id
  name:             string;       // e.g. "Verdura Auckland CBD"
  slug:             string;       // URL-safe, unique within org
  address:          Address;
  phone:            string | null;
  email:            string | null;
  timezone:         string;       // IANA, e.g. 'Pacific/Auckland'
  currency:         string;       // ISO 4217, e.g. 'NZD'
  operatingHours:   OperatingHours;
  seatingCapacity:  number;       // Total covers
  coversPerSlot:    number;       // Max simultaneous reservations per time slot
  reservationSlotMinutes: number; // Slot granularity, e.g. 30
  posAdapterType:   POSAdapterType;
  posConfig:        Record<string, string>; // Adapter-specific config (encrypted at rest)
  isActive:         boolean;
  createdAt:        Date;
  updatedAt:        Date;

  // Loaded relations
  organization?:    Organization;
  tables?:          Table[];
  printers?:        Printer[];
  staff?:           Staff[];
}
```

---

### Table

```typescript
/**
 * A physical table at a Venue. Used for kiosk table selection and reservation seating.
 */
interface Table {
  id:          string;
  venueId:     string;          // → Venue.id
  tableNumber: string;          // Human-readable label, e.g. "T1", "Bar 3"
  name:        string | null;   // Optional friendly name, e.g. "Window Table"
  capacity:    number;          // Max covers
  isActive:    boolean;         // Inactive = hidden from kiosk selection
  sortOrder:   number;
  floorPlanId: string | null;   // → FloorPlan.id (optional)
  xPosition:   number | null;   // Pixel X on floor plan canvas (null if no floor plan)
  yPosition:   number | null;   // Pixel Y on floor plan canvas
  createdAt:   Date;
  updatedAt:   Date;

  // Loaded relations
  venue?:      Venue;
  floorPlan?:  FloorPlan | null;
}
```

---

### FloorPlan

```typescript
/**
 * Visual representation of a venue's layout.
 * Tables are positioned on the floor plan canvas.
 * Deferred from MVP (FR-7.9 WONT).
 */
interface FloorPlan {
  id:          string;
  venueId:     string;        // → Venue.id
  name:        string;        // e.g. "Main Dining Room", "Outdoor"
  imageUrl:    string | null; // Background image from object storage
  canvasWidth: number;        // Pixel width of design canvas
  canvasHeight: number;
  isActive:    boolean;
  createdAt:   Date;
  updatedAt:   Date;

  // Loaded relations
  venue?:      Venue;
  tables?:     Table[];
}
```

---

### Reservation

```typescript
/**
 * A table booking made by a customer.
 * Scoped to a Venue.
 */
interface Reservation {
  id:                     string;
  venueId:                string;         // → Venue.id
  bookingRef:             string;         // Human-readable, e.g. "VR-8234"
  status:                 ReservationStatus;

  // Guest details
  guestName:              string;
  guestEmail:             string;
  guestPhone:             string | null;
  partySize:              number;
  occasion:               string | null;  // e.g. "Anniversary", "Birthday"
  dietaryPreferences:     string[];       // Free-text array, e.g. ["Gluten-Free", "No Pork"]
  specialRequests:        string | null;

  // Timing
  reservationDate:        string;         // ISO date string YYYY-MM-DD (in venue timezone)
  reservationTime:        string;         // HH:MM (in venue timezone)
  tableId:                string | null;  // → Table.id (assigned after confirmation)

  // Pre-selected menu (optional — customer may pre-order from Step 3)
  menuSelections:         ReservationMenuSelection[];
  menuTotal:              Cents;

  // Payment
  paymentMethod:          PaymentMethod;
  paymentStatus:          PaymentStatus;
  stripePaymentIntentId:  string | null;  // Populated if payment method = 'card'

  // External integrations
  calendarEventId:        string | null;  // Google Calendar event ID
  calendarSyncStatus:     'synced' | 'pending' | 'failed' | 'not_applicable';

  // Audit
  confirmedAt:            Date | null;
  cancelledAt:            Date | null;
  cancelledBy:            string | null;  // → Staff.id or 'guest'
  createdAt:              Date;
  updatedAt:              Date;

  // Loaded relations
  venue?:                 Venue;
  table?:                 Table | null;
}

interface ReservationMenuSelection {
  menuItemId:    string;    // → MenuItem.id
  menuItemName:  string;    // Snapshot at time of selection (item may change later)
  quantity:      number;
  unitPriceCents: Cents;    // Snapshot of price at time of selection
}
```

---

### Category

```typescript
/**
 * Top-level menu grouping (e.g. "The Feast", "Sides", "Drinks").
 * Scoped to an Organization — shared across venues unless overridden.
 */
interface Category {
  id:             string;
  organizationId: string;       // → Organization.id
  name:           string;
  description:    string | null;
  imageUrl:       string | null; // Object storage URL
  sortOrder:      number;
  isActive:       boolean;
  createdAt:      Date;
  updatedAt:      Date;
  createdById:    string;       // → Staff.id

  // Loaded relations
  organization?:  Organization;
  menuItems?:     MenuItem[];
}
```

---

### MenuItem

```typescript
/**
 * A single item on the menu.
 * Scoped to an Organization; venue-level overrides (price, availability)
 * are stored in MenuItemVenueOverride.
 */
interface MenuItem {
  id:                 string;
  organizationId:     string;         // → Organization.id
  categoryId:         string;         // → Category.id
  subCategory:        string | null;  // e.g. "Fresh from the Oven", "Mains"

  // Required display fields
  title:              string;
  description:        string;
  imageUrl:           string | null;  // Object storage URL — never a raw binary

  // Pricing (stored in cents — never a float)
  priceCents:         Cents;

  // Nutritional and dietary info
  nutritionalDetails: NutritionalDetails;

  // Classification
  isSpicy:            boolean;
  isAvailable:        boolean;        // Global availability flag
  sortOrder:          number;

  // Modifiers (e.g. "Choice of side", "Add extra cheese")
  modifierGroups:     ModifierGroup[];

  // Audit
  createdAt:          Date;
  updatedAt:          Date;
  createdById:        string;         // → Staff.id
  deletedAt:          Date | null;    // Soft delete — preserve order history

  // Loaded relations
  category?:          Category;
  organization?:      Organization;
  venueOverrides?:    MenuItemVenueOverride[];
}

/**
 * Venue-specific overrides for a MenuItem.
 * Allows a single restaurant chain to vary prices or availability by location.
 */
interface MenuItemVenueOverride {
  id:           string;
  menuItemId:   string;   // → MenuItem.id
  venueId:      string;   // → Venue.id
  priceCents:   Cents | null;       // null = use MenuItem.priceCents
  isAvailable:  boolean | null;     // null = use MenuItem.isAvailable
  updatedAt:    Date;
}
```

---

### Modifier

```typescript
/**
 * A group of options attached to a MenuItem (e.g. "Choice of side").
 * Stored as an embedded array on MenuItem — not a separate top-level entity.
 */
interface ModifierGroup {
  id:            string;   // UUID within the MenuItem document
  name:          string;   // e.g. "Choice of side"
  required:      boolean;
  minSelections: number;   // Minimum the guest must pick (0 = optional)
  maxSelections: number;   // Maximum allowed selections (1 = single-choice)
  options:       ModifierOption[];
}

interface ModifierOption {
  id:             string;   // UUID within the ModifierGroup
  name:           string;   // e.g. "Flavoured Rice", "Fries", "Green Salad"
  priceDeltaCents: Cents;   // 0 = included, positive = surcharge, negative = discount
  isAvailable:    boolean;
  sortOrder:      number;
}
```

---

### Order

```typescript
/**
 * An order submitted via the Self-Ordering Kiosk.
 * Distinct from Reservation — an Order is a real-time food request,
 * not a future booking.
 */
interface Order {
  id:              string;
  venueId:         string;          // → Venue.id
  tableId:         string | null;   // → Table.id (set from kiosk table selection)
  tableNumber:     string | null;   // Snapshot of table label at time of order
  status:          OrderStatus;
  posSyncStatus:   POSSyncStatus;
  orderVersion:    number;          // Immutable commercial/routing version sent to every destination
  idempotencyKey:  string;          // Unique within organization + venue + operation
  correlationId:   string;          // Shared by POS, payment, KDS, KOT and audit events

  items:           OrderItem[];
  subtotalCents:   Cents;           // Sum of all OrderItem.lineTotalCents
  taxCents:        Cents;           // If applicable (e.g. GST)
  totalCents:      Cents;           // subtotalCents + taxCents

  notes:           string | null;   // General order-level notes
  source:          OrderSource;
  paymentStatus:   PaymentStatus;
  paymentMethod:   PaymentMethod;
  paymentProvider: 'idealpos' | 'stripe' | 'verifone' | 'manual' | null;
  paymentProviderTransactionId: string | null;
  idealposTransactionId: string | null;
  idealposTenderCode: string | null;

  // Timing
  submittedAt:     Date;
  confirmedAt:     Date | null;
  preparingAt:     Date | null;
  readyAt:         Date | null;
  completedAt:     Date | null;
  cancelledAt:     Date | null;

  createdAt:       Date;
  updatedAt:       Date;

  // Loaded relations
  venue?:          Venue;
  table?:          Table | null;
  printJobs?:      PrinterJob[];
  posSyncRecord?:  POSSyncRecord | null;
}
```

---

### OrderItem

```typescript
/**
 * A single line item within an Order.
 * Stores snapshots of menu data at the time of ordering so that
 * historical orders are unaffected by future menu changes.
 */
interface OrderItem {
  id:                 string;
  orderId:            string;   // → Order.id
  menuItemId:         string;   // → MenuItem.id (reference only — not a join dependency)

  // Snapshots (immutable after order submission)
  menuItemTitle:      string;
  menuItemCategory:   string;
  unitPriceCents:     Cents;
  quantity:           number;
  lineTotalCents:     Cents;    // unitPriceCents × quantity + modifier surcharges

  // Selected modifier options
  selectedModifiers:  SelectedModifier[];

  notes:              string | null;  // Item-level special instruction from customer

  // Loaded relations
  order?:             Order;
}

interface SelectedModifier {
  modifierGroupId:   string;
  modifierGroupName: string;  // Snapshot
  optionId:          string;
  optionName:        string;  // Snapshot
  priceDeltaCents:   Cents;   // Snapshot
}
```

---

### Payment

```typescript
/**
 * A provider-neutral payment record associated with either an Order or a
 * Reservation. In-person payment facts originate in Idealpos; optional online
 * payment facts originate at the selected provider and are reconciled to the
 * Idealpos PREPAID / ONLINE transaction.
 */
interface Payment {
  id:                     string;
  reservationId:          string | null;  // → Reservation.id
  orderId:                string | null;  // → Order.id; exactly one parent is required
  venueId:                string;         // → Venue.id (for scoping)
  method:                 PaymentMethod;
  status:                 PaymentStatus;
  amountCents:            Cents;
  currency:               string;         // ISO 4217, e.g. 'NZD'

  provider:               'idealpos' | 'stripe' | 'verifone' | 'manual';
  providerTransactionId:  string | null;
  idealposTransactionId:  string | null;
  tenderCode:             string | null;

  // Legacy Stripe compatibility; migrate into provider metadata
  stripePaymentIntentId:  string | null;
  stripeChargeId:         string | null;
  stripeReceiptUrl:       string | null;

  // Manual payment confirmation (bank transfer / pay at restaurant)
  confirmedById:          string | null;  // → Staff.id who manually confirmed
  confirmedAt:            Date | null;
  referenceNote:          string | null;  // e.g. bank transfer reference

  refundedAt:             Date | null;
  refundedById:           string | null;  // → Staff.id
  refundAmountCents:      Cents | null;
  refundReason:           string | null;

  createdAt:              Date;
  updatedAt:              Date;

  // Loaded relations
  reservation?:           Reservation;
}
```

---

### Printer

```typescript
/**
 * A physical printer registered to a Venue.
 * Connection details are used by the Printer Service (Phase 6).
 */
interface Printer {
  id:             string;
  venueId:        string;           // → Venue.id
  name:           string;           // e.g. "Kitchen Printer", "POS Receipt"
  type:           PrinterType;
  connectionType: PrinterConnectionType;
  protocol:       PrinterProtocol;

  // Network/TCP printers
  host:           string | null;    // IP or hostname
  port:           number | null;    // e.g. 9100 for ESC/POS over TCP

  // Windows shared printers
  sharePath:      string | null;    // e.g. "\\\\SERVER\\KitchenPrinter"

  paperWidthMm:   number;           // e.g. 80 (80mm thermal roll)
  charPerLine:    number;           // Characters per line at default font, e.g. 42
  isActive:       boolean;
  isOnline:       boolean | null;   // Last known online status (updated by Printer Service)
  lastSeenAt:     Date | null;

  createdAt:      Date;
  updatedAt:      Date;

  // Loaded relations
  venue?:         Venue;
  printJobs?:     PrinterJob[];
}
```

---

### PrinterJob

```typescript
/**
 * A single print job dispatched to a Printer.
 * Each Order submission creates one PrinterJob per target Printer.
 */
interface PrinterJob {
  id:            string;
  printerId:     string;          // → Printer.id
  orderId:       string | null;   // → Order.id (null for test prints)
  venueId:       string;          // → Venue.id

  status:        PrintJobStatus;
  payload:       string;          // Serialised print content (ESC/POS bytes as base64, or raw text)
  payloadFormat: PrinterProtocol;

  attemptCount:  number;          // How many times dispatch has been attempted
  maxAttempts:   number;          // Configurable (default: 3)

  queuedAt:      Date;
  lastAttemptAt: Date | null;
  printedAt:     Date | null;
  failedAt:      Date | null;
  errorMessage:  string | null;

  createdAt:     Date;
  updatedAt:     Date;

  // Loaded relations
  printer?:      Printer;
  order?:        Order | null;
}
```

---

### POSSyncRecord

```typescript
/**
 * Tracks the sync status of an Order into IdealPOS.
 * One logical handoff per immutable Order version. Attempts and acknowledgements
 * are appended; the record is not overwritten into a generic "synced" state.
 * BLOCKED ON: Q1 — exact fields populated by the adapter will differ by adapter type.
 */
interface POSSyncRecord {
  id:              string;
  orderId:         string;          // → Order.id (1:1)
  venueId:         string;          // → Venue.id
  adapterType:     POSAdapterType;  // Which adapter was used
  status:          POSSyncStatus;
  orderVersion:    number;
  idempotencyKey:  string;
  connectorInstallationId: string | null;

  // What was sent to IdealPOS (adapter-specific payload — stored for debugging)
  requestPayload:  Record<string, unknown> | null;  // VERIFY AGAINST VENDOR DOCS
  responsePayload: Record<string, unknown> | null;  // VERIFY AGAINST VENDOR DOCS

  // IdealPOS-side reference (if the adapter returns one)
  posOrderId:      string | null;   // IdealPOS internal order ID — VERIFY AGAINST VENDOR DOCS
  posTableId:      string | null;   // IdealPOS table reference — VERIFY AGAINST VENDOR DOCS

  attemptCount:    number;
  connectorAcceptedAt: Date | null;
  posSubmittedAt:  Date | null;
  posConfirmedAt:  Date | null;
  lastAttemptAt:   Date | null;
  syncedAt:        Date | null;
  failedAt:        Date | null;
  errorMessage:    string | null;

  createdAt:       Date;
  updatedAt:       Date;

  // Loaded relations
  order?:          Order;
}
```

---

### Staff

```typescript
/**
 * A platform user (restaurant employee or administrator).
 * Scoped to an Organization; venue-level access is controlled by VenueAccess.
 */
interface Staff {
  id:              string;
  organizationId:  string;       // → Organization.id
  email:           string;       // Unique within the platform
  name:            string;
  passwordHash:    string;       // bcrypt or Argon2id — never exposed via API
  role:            StaffRole;
  isActive:        boolean;

  // MFA
  totpSecret:      string | null;   // Encrypted at rest
  isTotpEnabled:   boolean;

  lastLoginAt:     Date | null;
  lastLoginIp:     string | null;
  createdAt:       Date;
  updatedAt:       Date;
  deletedAt:       Date | null;    // Soft delete

  // Loaded relations
  organization?:   Organization;
  venueAccess?:    VenueAccess[];
}

/**
 * Grants a Staff member access to a specific Venue.
 * A Staff member with role 'owner' or 'admin' has access to all venues
 * in their Organization without explicit VenueAccess records.
 */
interface VenueAccess {
  id:         string;
  staffId:    string;   // → Staff.id
  venueId:    string;   // → Venue.id
  grantedAt:  Date;
  grantedBy:  string;   // → Staff.id of the admin who granted access
}
```

---

### Role & Permission

```typescript
/**
 * Roles are predefined (StaffRole enum). Permissions describe what each
 * role can do. This is a capability reference — not stored as DB rows,
 * but evaluated at runtime by the RBAC guard.
 */
interface Permission {
  action:   PermissionAction;
  resource: PermissionResource;
}

type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'manage';

type PermissionResource =
  | 'organization'
  | 'venue'
  | 'venue_settings'
  | 'staff'
  | 'role'
  | 'menu_item'
  | 'category'
  | 'reservation'
  | 'order'
  | 'payment'
  | 'table'
  | 'floor_plan'
  | 'printer'
  | 'print_job'
  | 'pos_sync'
  | 'report'
  | 'audit_log'
  | 'kiosk_config';

/**
 * Role → Permission matrix (evaluated server-side, not stored in DB).
 * Enforced by NestJS RBAC guard in Phase 4 implementation.
 */
const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: [{ action: 'manage', resource: 'organization' }], // owns everything
  admin: [
    { action: 'manage', resource: 'venue' },
    { action: 'manage', resource: 'staff' },
    { action: 'manage', resource: 'menu_item' },
    { action: 'manage', resource: 'reservation' },
    { action: 'manage', resource: 'order' },
    { action: 'manage', resource: 'printer' },
    { action: 'read',   resource: 'report' },
    { action: 'read',   resource: 'audit_log' },
  ],
  manager: [
    { action: 'read',   resource: 'venue' },
    { action: 'manage', resource: 'reservation' },
    { action: 'manage', resource: 'order' },
    { action: 'manage', resource: 'menu_item' },
    { action: 'manage', resource: 'table' },
    { action: 'read',   resource: 'report' },
    { action: 'read',   resource: 'printer' },
    { action: 'manage', resource: 'print_job' },
  ],
  cashier: [
    { action: 'read',   resource: 'order' },
    { action: 'update', resource: 'order' },
    { action: 'read',   resource: 'reservation' },
    { action: 'update', resource: 'reservation' },
    { action: 'read',   resource: 'print_job' },
  ],
  kitchen: [
    { action: 'read',   resource: 'order' },
    { action: 'update', resource: 'order' }, // status updates only
  ],
  viewer: [
    { action: 'read',   resource: 'reservation' },
    { action: 'read',   resource: 'order' },
    { action: 'read',   resource: 'menu_item' },
  ],
};
```

---

### AuditLog

```typescript
/**
 * An append-only record of every admin action on the platform.
 * Stored in PostgreSQL (flexible schema stored in JSONB columns).
 * Never updated or deleted — audit log integrity depends on immutability.
 */
interface AuditLog {
  id:             string;
  organizationId: string;                   // → Organization.id
  venueId:        string | null;            // → Venue.id (null for org-level actions)
  actorId:        string;                   // → Staff.id
  actorEmail:     string;                   // Snapshot — Staff email at time of action
  actorRole:      StaffRole;                // Snapshot

  // What happened
  action:         AuditAction;
  resource:       PermissionResource;
  resourceId:     string | null;            // ID of the affected entity

  // State snapshots (schema varies by resource — stored as flexible documents)
  before:         Record<string, unknown> | null;
  after:          Record<string, unknown> | null;

  // Request metadata
  ipAddress:      string | null;
  userAgent:      string | null;

  timestamp:      Date;                     // UTC — immutable after creation
}

type AuditAction =
  | 'created'
  | 'updated'
  | 'deleted'          // Soft delete
  | 'hard_deleted'     // Permanent removal (rare — restricted to owner role)
  | 'login'
  | 'logout'
  | 'login_failed'
  | 'password_changed'
  | 'role_changed'
  | 'permission_denied'
  | 'print_retried'
  | 'pos_sync_retried'
  | 'reservation_status_changed'
  | 'order_status_changed';
```

---

## Entity Relationship Summary

```
Organization
  └── Venue (1:many)
        ├── Table (1:many)
        │     └── FloorPlan (many:1, optional)
        ├── Reservation (1:many)
        │     ├── ReservationMenuSelection[] (embedded)
        │     └── Payment (1:1)
        ├── Order (1:many)
        │     ├── OrderItem[] (embedded)
        │     │     └── SelectedModifier[] (embedded)
        │     ├── PrinterJob[] (1:many, one per target Printer)
        │     └── POSSyncRecord (1:1)
        ├── Printer (1:many)
        └── Staff (via VenueAccess, many:many)

Organization
  └── Category (1:many)
        └── MenuItem (1:many)
              ├── ModifierGroup[] (embedded)
              │     └── ModifierOption[] (embedded)
              └── MenuItemVenueOverride (1:many, per Venue)

Organization
  └── Staff (1:many)
        └── VenueAccess (1:many)

AuditLog  →  scoped to Organization + optional Venue
           →  references Staff (actorId)
           →  references any resource by (resource, resourceId)
```

---

## Phase 4 Preview — Data Store Allocation

> Not decided here — documented for Phase 4. Listed to flag cross-store reference challenges.

| Entity | Likely Store | Reason |
|--------|-------------|--------|
| Organization | PostgreSQL | Relational, billing-critical |
| Venue | PostgreSQL | Relational, config-critical |
| Table | PostgreSQL | Relational, FK to Venue and FloorPlan |
| FloorPlan | PostgreSQL | Relational, FK to Venue |
| Staff + VenueAccess | PostgreSQL | Auth-critical, ACID required |
| Reservation + Payment | PostgreSQL | Financial, ACID required, FK chains |
| Order + OrderItem | PostgreSQL | Transactional, FK to Venue + Table |
| POSSyncRecord | PostgreSQL | FK to Order, retry state machine |
| Category | PostgreSQL | Relational, FK to Organization |
| MenuItem + Overrides | Local PostgreSQL | JSONB column for `nutritionalDetails` & `modifierGroups` |
| Printer | PostgreSQL | Config entity, FK to Venue |
| PrinterJob | Local PostgreSQL | High-write print queue payload, cleaned up by BullMQ |
| AuditLog | Local PostgreSQL | JSONB column for variable before/after snapshots |

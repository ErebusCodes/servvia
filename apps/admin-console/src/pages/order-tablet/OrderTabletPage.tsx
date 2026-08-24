import React, { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveOrders, LiveOrder, DEFAULT_VENUE_ID, authHeaders, liveOrdersQueryKey } from '../../shared/orders';
import { TABLES, TABLE_LAYOUTS, mapX, mapY, mapW, mapH } from '../../shared/tables';
import { useMenuStore, MenuItem, ModifierGroup } from '../../store/menu.store';
import { sortMenuItemsAlphabetically } from '../../shared/menu/menuData';
import { useReservationStore } from '../../store/reservation.store';
import { useAuthStore } from '../../store/auth.store';
import { useTabletDeviceAuthStore, isStaffElevated } from '../../store/tabletDeviceAuth.store';
import { TableMap, TableMapItem } from '../../components/TableMap';
import {
  computeCartTotals,
  isSupportedTaxProfile,
  seatBreakdownFor,
  lineTotalCents,
  type TaxProfile,
  type BillingLine,
} from './billing';
import './OrderTabletPage.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface RealTable {
  id: string;
  tableNumber: string;
  name: string | null;
  capacity: number;
}

// Mirrors GET /api/admin/orders/:id/pos-sync's real response shape exactly
// -- PosSyncRecordsService.getForOrder returns either the full POSSyncRecord
// (this shape) or a bare `{ orderId, status }` when no adapter is
// configured for this venue. This integration branch's chosen IdealPOS
// delivery lineage (IdealposOrderDispatcherService) exposes only the coarse
// POSSyncStatus state machine plus retry bookkeeping -- no discrepancy/
// authoritative-total fields exist yet (that richer reconciliation model
// was a competing, excluded implementation -- see the reconciliation
// decision record). Every field below is genuinely optional -- the UI must
// never assume presence.
interface PosSyncView {
  orderId: string;
  status: string; // POSSyncStatus
  nextRetryAt?: string | null;
  retryExhaustedAt?: string | null;
  errorMessage?: string | null;
}

// Mirrors GET /api/admin/orders/:id/print-jobs's real response shape (an
// array of raw PrinterJob rows) -- only the fields the KOT status panel
// actually renders are declared here.
interface PrintJobView {
  id: string;
  status: string; // PrintJobStatus
}

// States that will never change again without a fresh submission -- polling
// stops here, matching the backend's own terminal-state model rather than
// guessing which strings are final. Module-scope: a static constant, not
// derived from any component state.
const TERMINAL_POS_SYNC_STATES = new Set([
  'synced',
  'failed',
  'not_applicable',
  'unsupported',
]);

// ─────────────────────────────────── Types ──────────────────────────────────

// Story 15-3: a cart line's modifiers always carry the real, stable
// modifierGroupId/optionId they came from — never just a display label —
// so the order payload can submit ids instead of a client-trusted name/
// price. `label`/`delta` remain for display purposes (dollars, matching
// this file's existing display-unit convention). A rehydrated line from a
// pre-Story-15-3 (or legacy kiosk-shaped) persisted order may have null
// ids — such a line is always already `sent: true` and therefore never
// re-submitted, so buildOrderItemsPayload never needs to handle a null id.
interface TabletCartItem {
  key: number;
  itemId: string;
  name: string;
  unit: number; // base price in dollars
  qty: number;
  mods: Array<{ label: string; delta: number; groupId: string | null; optionId: string | null }>;
  note: string;
  seat: number;
  course: string;
  sent: boolean;
}

// ─────────────────────────────── Helper Functions ─────────────────────────────

function getItemPriceInfo(priceStr: string, title: string) {
  const clean = priceStr.replace(/[^\d/.\s]/g, '').trim(); // Remove "from", "$", etc.
  if (clean.includes('/')) {
    const parts = clean.split('/').map(p => parseFloat(p.trim()) || 0);
    const base = parts[0] || 0;
    
    let variantNames = parts.map((_, idx) => `Variant ${idx + 1}`);
    const titleLower = title.toLowerCase();
    if (titleLower.includes('chicken') && titleLower.includes('lamb') && titleLower.includes('combination')) {
      variantNames = ['Chicken', 'Lamb', 'Combination'];
    } else if (titleLower.includes('chicken') && titleLower.includes('lamb') && titleLower.includes('mix')) {
      variantNames = ['Chicken', 'Lamb', 'Mix'];
    } else if (titleLower.includes('chicken') && titleLower.includes('kebab') && titleLower.includes('lamb') && titleLower.includes('combo')) {
      variantNames = ['Chicken', 'Kebab', 'Lamb', 'Combo'];
    } else if (parts.length === 2) {
      variantNames = ['Regular', 'Large'];
    } else if (parts.length === 3) {
      variantNames = ['Chicken', 'Lamb', 'Mixed'];
    }

    const variants = parts.map((val, idx) => ({
      name: variantNames[idx] || `Option ${idx + 1}`,
      priceDeltaCents: Math.round((val - base) * 100),
    }));

    return { basePrice: base, variants };
  }

  const base = parseFloat(clean) || 0;
  return { basePrice: base, variants: [] };
}

const getCategoryIconPath = (catName: string) => {
  const name = catName.toLowerCase();
  if (name.includes('mezze') || name.includes('appetiz') || name.includes('starter')) return 'M2 17h20 M19 17a7 7 0 0 0-14 0 M12 10V8';
  if (name.includes('salad')) return 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12';
  if (name.includes('grill') || name.includes('kebab') || name.includes('meat')) return 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z';
  if (name.includes('main') || name.includes('plate') || name.includes('entree')) return 'M3 2v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2 M7 2v20 M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3z M21 15v7';
  if (name.includes('bowl')) return 'M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9z M7 21h10 M9 9a3 3 0 0 1 3-3 M13 6a3 3 0 0 1 3 3';
  if (name.includes('wrap') || name.includes('pita') || name.includes('sandwich') || name.includes('burger')) return 'M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5';
  if (name.includes('pizza') || name.includes('pide') || name.includes('flatbread')) return 'M2 16.5 21.5 22 16 2.5A20.2 20.2 0 0 0 2 16.5z M11.5 12.5h.01 M8.5 16.5h.01 M14.5 16.5h.01';
  if (name.includes('dessert') || name.includes('sweet') || name.includes('baklava') || name.includes('pastry')) return 'M7 11l4.08 10.35a1 1 0 0 0 1.84 0L17 11 M17 7A5 5 0 0 0 7 7 M17 7a2 2 0 0 1 0 4H7a2 2 0 0 1 0-4';
  if (name.includes('drink') || name.includes('beverage') || name.includes('coffee') || name.includes('tea') || name.includes('wine')) return 'M6 8l1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8 M5 8h14 M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0 M12 8L13 2h2';
  if (name.includes('popular')) return 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';
  return 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'; // default Grid
};

// Verdura-branded placeholder — the same visual treatment whether an item has
// no configured image at all, or its configured URL fails to load (a stale
// path, a private/inaccessible GCS object, etc.). A fixed aspect-ratio (not a
// fixed pixel height) keeps every card's image area proportioned the same way
// regardless of the grid's actual column width, and reserves the same space
// before/after load so a card never jumps. `failed` is per-mount local state,
// not derived from item data, since load success can only be known in the
// browser.
function MenuItemThumbnail({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  return (
    <div style={{ aspectRatio: '4 / 3', width: '100%', borderBottom: '1px solid var(--color-border)', overflow: 'hidden', background: 'var(--color-surface-2)' }}>
      {showImage ? (
        <img
          src={src as string}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <svg width="18" height="18" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Verdura" style={{ opacity: 0.35 }}>
            <rect width="40" height="40" rx="9" fill="#16A34A"></rect>
            <path d="M20 28.5c-5.1-1.7-9.5-6.8-9.5-14.4a.9.9 0 0 1 .9-.9c3.1 0 6.1.8 8.6 3.1 2.5-2.3 5.5-3.1 8.6-3.1a.9.9 0 0 1 .9.9c0 7.6-4.4 12.7-9.5 14.4Z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"></path>
            <path d="M20 17.4V29" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"></path>
          </svg>
          <span style={{ fontSize: '8.5px', letterSpacing: '0.1em', color: 'var(--color-text-tertiary)', fontWeight: '600' }}>VERDURA KITCHEN</span>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Main Component ──────────────────────────────

export function OrderTabletPage({ standalone = false }: { standalone?: boolean }) {
  // No useNavigate() here: standalone (VITE_APP_MODE=tablet) renders this
  // component with no <Router> ancestor at all (App.tsx mounts it directly
  // under TabletDeviceGate, full-viewport, no <Routes>) — calling the hook
  // unconditionally threw "useNavigate() may be used only in the context of
  // a <Router> component" and crashed the entire standalone tablet to a
  // blank screen immediately after unlock. It was already dead code (the
  // returned function was never actually called anywhere in this file),
  // found via real browser validation, not merely a hypothetical risk.
  const queryClient = useQueryClient();
  // Declared before useLiveOrders: an unelevated standalone device's bare
  // token (role `viewer`) is correctly rejected by /api/admin/orders's
  // staff-only RolesGuard, so restricted-mode order *viewing* must route
  // through the purpose-built /api/tablet/orders instead (mirrors the order
  // *creation* branch below, which already made this same distinction).
  const tabletDeviceAuth = useTabletDeviceAuthStore();
  const staffElevated = standalone && isStaffElevated(tabletDeviceAuth);
  const restrictedOrdersEndpoint = standalone && !staffElevated;
  const { data: orders = [] } = useLiveOrders({ restrictedEndpoint: restrictedOrdersEndpoint });

  // Deliberately reads the resolved* fields, not categories/items — those
  // belong to MenuManagementPage's unresolved admin/menu/* fetch, and the
  // two must never share state (see menu.store.ts's fetchResolvedMenu doc
  // comment: sharing one set of fields let whichever fetch resolved last
  // silently overwrite the other page's correct data with no error).
  const categories = useMenuStore(s => s.resolvedCategories);
  const menuItems = useMenuStore(s => s.resolvedItems);
  const fetchResolvedMenu = useMenuStore(s => s.fetchResolvedMenu);
  const menuError = useMenuStore(s => s.resolvedError);
  const reservations = useReservationStore(s => s.reservations);

  // useMenuStore's resolved* fields start empty and have no persistence —
  // this is the only call site of fetchResolvedMenu(). The tablet is an
  // ordering surface: it must show the same venue-resolved price/
  // availability (MenuItemVenueOverride-merged) that kiosk and customer
  // show, so it calls fetchResolvedMenu() against the same public
  // GET /api/kiosk/venues/:venueId/menu endpoint they use.
  useEffect(() => {
    fetchResolvedMenu(DEFAULT_VENUE_ID);
  }, [fetchResolvedMenu]);

  // ── States ──
  const [mode, setMode] = useState<'staff' | 'guest'>('staff');
  // 'pay' is a legacy internal key -- this screen is now "Review Order"
  // (before submission) / "Order Status" (after), never a payment step. Not
  // renamed to avoid an unnecessary sweeping identifier churn across this
  // file; see the screen's own render block for the user-visible titling.
  const [screen, setScreen] = useState<'floor' | 'order' | 'pay'>('floor');
  // Story 15-13: the single authoritative dine-in/takeaway signal for the
  // order currently in progress. Defaults to dine_in (the pre-existing,
  // only-ever-supported mode) and is reset to dine_in on handleReset. Never
  // inferred from tableId/tableNumber elsewhere in this file.
  const [serviceMode, setServiceMode] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [tableId, setTableId] = useState<string | null>(null);
  const [guests, setGuests] = useState<number>(0);
  const [seatsCount, setSeatsCount] = useState<number>(0);
  const [activeSeat, setActiveSeat] = useState<number>(1);
  const [cart, setCart] = useState<TabletCartItem[]>([]);
  const [cat, setCat] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'seat' | 'course' | 'table'>('seat');
  const [slide, setSlide] = useState<{
    itemId: string;
    sel: Record<string, Record<string, boolean>>;
    qty: number;
    note: string;
    seat: number;
  } | null>(null);

  const [enquiryOpen, setEnquiryOpen] = useState<boolean>(false);
  const [billOpen, setBillOpen] = useState<boolean>(false);
  const [notesOpen, setNotesOpen] = useState<boolean>(false);
  const [tableNote, setTableNote] = useState<string>('');
  const [tableNoteDraft, setTableNoteDraft] = useState<string>('');
  const [createdOrderRef, setCreatedOrderRef] = useState<string | null>(null);
  // Story 15-13: captured directly from submitOrderToKitchen's own response
  // -- never read back from the live-orders query cache, which is only
  // guaranteed to include the just-created order after its own reconcile
  // cycle, not synchronously on submission.
  const [createdTakeawayReference, setCreatedTakeawayReference] = useState<string | null>(null);
  const [orderActionError, setOrderActionError] = useState<string | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);

  // ── Idealpos reconciliation (Story 15-5) ──
  // Truthful, polled view of this order's POSSyncRecord. `null` while
  // unknown/loading; `{ status }`-only shape means no adapter is configured
  // for this venue (see PosSyncRecordsService.getForOrder) -- never
  // fabricated, never defaulted to a success-looking shape.
  const [posSyncView, setPosSyncView] = useState<PosSyncView | null>(null);
  const [posSyncLoadError, setPosSyncLoadError] = useState<string | null>(null);
  // Truthful, polled view of this order's PrinterJob rows (KOT status) --
  // same null-while-loading / never-fabricated convention as posSyncView.
  const [printJobsView, setPrintJobsView] = useState<PrintJobView[] | null>(null);
  const [printJobsLoadError, setPrintJobsLoadError] = useState<string | null>(null);

  // ── Venue tax configuration (Story 15-4 / DL-072) ──
  // The billing calculation in `totals` below is only correct for the NZ
  // GST-inclusive profile (billing.ts's SUPPORTED_TAX_PROFILE). Fetched from
  // the real Venue record (never hardcoded) so an incompatible venue
  // configuration fails safely instead of silently having NZ GST rules
  // applied to it — see `taxProfileStatus` below and its use in `totals`.
  const [venueTaxProfile, setVenueTaxProfile] = useState<TaxProfile | null>(null);
  const [taxProfileStatus, setTaxProfileStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    async function loadTaxConfig() {
      try {
        const res = await fetch(`${API_BASE}/api/venues/${DEFAULT_VENUE_ID}/tax-config`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`Failed to load venue tax configuration (${res.status})`);
        const data = await res.json() as TaxProfile;
        if (!cancelled) {
          setVenueTaxProfile(data);
          setTaxProfileStatus('ready');
        }
      } catch {
        if (!cancelled) setTaxProfileStatus('error');
      }
    }
    void loadTaxConfig();
    return () => { cancelled = true; };
  }, []);

  // One idempotency key per logical order-in-progress for this table —
  // generated once, reused across every submission attempt for the same
  // cart (including a manual retry after a dropped response), and rotated
  // only when the tablet actually starts a new order (handleReset). This is
  // required by CreateStaffOrderDto.idempotencyKey (@IsNotEmpty,
  // @MinLength(16)) — see Dev Agent Record for the defect this closes: the
  // field was previously never sent at all, so every real "Send to
  // kitchen"/"Place order" submission from this page failed with 400.
  const [orderIdempotencyKey, setOrderIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  // ── Named staff elevation (Story 15-1 / DL-081, standalone tablet only) ──
  // Only meaningful when `standalone` — the embedded Admin Console route is
  // already a full staff JWT session and has no separate elevation concept.
  // (tabletDeviceAuth/staffElevated themselves are declared above, before
  // useLiveOrders, since that hook needs staffElevated to pick its endpoint.)
  const [elevatePinOpen, setElevatePinOpen] = useState<boolean>(false);
  const [elevatePin, setElevatePin] = useState<string>('');
  const [elevateError, setElevateError] = useState<string | null>(null);
  const [elevating, setElevating] = useState<boolean>(false);

  // Auto-return to restricted mode the instant elevation expires — never
  // rely on the next failed request to notice; the UI must reflect
  // restricted mode as soon as the grant is no longer valid.
  useEffect(() => {
    if (!standalone || !tabletDeviceAuth.staffElevatedUntil) return;
    const msRemaining = tabletDeviceAuth.staffElevatedUntil - Date.now();
    if (msRemaining <= 0) {
      tabletDeviceAuth.clearStaffElevation();
      setMode('guest');
      return;
    }
    const timer = setTimeout(() => {
      tabletDeviceAuth.clearStaffElevation();
      setMode('guest');
    }, msRemaining);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone, tabletDeviceAuth.staffElevatedUntil]);

  async function elevateWithPin(event: React.FormEvent) {
    event.preventDefault();
    setElevateError(null);
    setElevating(true);
    try {
      const res = await fetch(`${API_BASE}/api/tablet/elevate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tabletDeviceAuth.deviceToken ?? ''}` },
        body: JSON.stringify({ staffPin: elevatePin }),
      });
      if (!res.ok) {
        setElevateError(res.status === 429 ? 'Too many attempts — try again shortly.' : 'Incorrect PIN.');
        return;
      }
      const data = await res.json() as { token: string; staff: { id: string; name: string; role: string } };
      tabletDeviceAuth.setStaffElevation(data.token, data.staff.name, data.staff.role);
      setMode('staff');
      setElevatePinOpen(false);
    } catch {
      setElevateError('Could not reach the server. Check the network connection.');
    } finally {
      setElevating(false);
      setElevatePin('');
    }
  }

  function lockTablet() {
    const bearer = tabletDeviceAuth.staffToken ?? tabletDeviceAuth.deviceToken;
    if (bearer) {
      void fetch(`${API_BASE}/api/tablet/lock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
      }).catch(() => undefined);
    }
    tabletDeviceAuth.clearStaffElevation();
    setMode('guest');
  }

  // ── Transfer/Close Table States ──
  const [transferOpen, setTransferOpen] = useState<boolean>(false);
  const [transferStep, setTransferStep] = useState<1 | 2>(1);
  const [destTableId, setDestTableId] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState<boolean>(false);
  const [closeReason, setCloseReason] = useState<string>('');
  const [closeError, setCloseError] = useState<string | null>(null);

  // ── Real backend Table records ──
  // The floor plan's visual layout (position/size) still comes from the
  // static shared/table-config.json (TABLE_LAYOUTS) — the backend Table
  // model has no notion of pixel geometry — but table IDENTITY used for
  // order creation/reservation matching must be the real Postgres Table.id,
  // never the synthetic "t1"/"T1" ids. Fetched once per venue via the
  // authenticated tables endpoint (kds_device tokens are allowed to read
  // it — see apps/api/src/tables/tables.controller.ts).
  const [realTables, setRealTables] = useState<RealTable[]>([]);
  const [realTablesError, setRealTablesError] = useState<string | null>(null);
  const realTableByNumber = useMemo(() => {
    const map = new Map<string, RealTable>();
    realTables.forEach(t => map.set(t.tableNumber, t));
    return map;
  }, [realTables]);

  useEffect(() => {
    let cancelled = false;
    async function loadTables() {
      try {
        const res = await fetch(`${API_BASE}/api/venues/${DEFAULT_VENUE_ID}/tables`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`Failed to load tables (${res.status})`);
        const data = await res.json() as RealTable[];
        if (!cancelled) {
          setRealTables(data);
          setRealTablesError(null);
        }
      } catch (err) {
        if (!cancelled) setRealTablesError(err instanceof Error ? err.message : 'Failed to load tables');
      }
    }
    void loadTables();
    return () => { cancelled = true; };
  }, []);

  // Force Light Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  }, []);

  // ── Computations & Helpers ──
  const formatPrice = (n: number) => '$' + n.toFixed(2);
  const lineUnit = (ln: TabletCartItem) => ln.unit + ln.mods.reduce((a, m) => a + m.delta, 0);
  const lineTotal = (ln: TabletCartItem) => lineUnit(ln) * ln.qty;

  const getActiveOrderForTable = (tableNumber: string) => {
    return orders.find(o => o.tableNumber === tableNumber && o.status !== 'completed' && o.status !== 'cancelled');
  };

  const isTableReserved = (tableNumber: string) => {
    // Reservations now store the real backend Table UUID (see Phase 3's
    // reservation.store.ts sanitizeTableId), so this must compare against
    // the same real Table.id, not a synthetic "t<number>" string.
    const realTable = realTableByNumber.get(tableNumber);
    if (!realTable) return false;
    return reservations.some(r => r.tableId === realTable.id && r.status === 'confirmed');
  };

  // Hydrate order details from query cache
  const hydrateTableOrder = (order: LiveOrder) => {
    let k = 1;
    // Defense in depth: the backend response this is normally fed from
    // now always includes `items` (see OrdersService.persistOrder's
    // 2026-08-20 fix), but this must never crash the whole table-selection
    // handler (and leave stale state from a previously-viewed table on
    // screen) if some other future caller's order object doesn't carry it.
    const cartItems = (order.items ?? []).map((item) => {
      const menuItem = menuItems.find(m => m.title === item.menuItemTitle);
      if (!menuItem) return null;
      
      const { basePrice } = getItemPriceInfo(menuItem.price, menuItem.title);
      
      let seat = 0;
      let cleanNotes = item.notes || '';
      const seatMatch = cleanNotes.match(/^\[Seat (\d+)\]\s*(.*)/);
      if (seatMatch && seatMatch[1] !== undefined && seatMatch[2] !== undefined) {
        seat = parseInt(seatMatch[1]);
        cleanNotes = seatMatch[2];
      }
      
      return {
        key: k++,
        itemId: menuItem.id,
        name: menuItem.title,
        unit: basePrice,
        qty: item.quantity,
        mods: item.selectedModifiers.map(mod => ({
          label: mod.optionName,
          delta: mod.priceDeltaCents / 100,
          groupId: mod.modifierGroupId,
          optionId: mod.optionId,
        })),
        note: cleanNotes,
        seat,
        course: categories.find(c => c.id === menuItem.categoryId)?.name || menuItem.subCategory || 'Mains',
        sent: true
      };
    }).filter(Boolean) as TabletCartItem[];
    
    let guestsCount = 2;
    if (order.notes) {
      const guestMatch = order.notes.match(/Guests:\s*(\d+)/);
      if (guestMatch && guestMatch[1] !== undefined) {
        guestsCount = parseInt(guestMatch[1]);
      }
    }
    
    return { cart: cartItems, guests: guestsCount, seatsCount: guestsCount, keyN: k };
  };

  // Totals calculations (Story 15-4 / DL-072) — see billing.ts for the
  // single deterministic calculation boundary. This intentionally computes
  // in integer cents internally; `totals.sub`/`totals.total`/etc. below stay
  // in dollars (this component's pre-existing convention, consumed by
  // `formatPrice` and dozens of display sites) so nothing downstream of this
  // block needs to change shape. No service charge is computed anywhere in
  // this object, and GST is disclosed (`totals.gst`) but never added to
  // `totals.total` — the payable total is subtotal minus any valid discount.
  const isTaxProfileSupported = taxProfileStatus === 'ready' && isSupportedTaxProfile(venueTaxProfile);
  const taxConfigUnavailable = taxProfileStatus === 'error' || (taxProfileStatus === 'ready' && !isTaxProfileSupported);

  const billingLines: BillingLine[] = useMemo(
    () => cart.map((l) => ({ seat: l.seat, unitDollars: l.unit, modifierDeltaDollars: l.mods.map((m) => m.delta), qty: l.qty })),
    [cart],
  );

  // Single-line conversion into billing.ts's cents-safe shape, for the
  // group-header totals below (cartGroups/enquiryGroups) — independent
  // review (2026-08-19) found these summed via the local float-dollar
  // `lineTotal` helper instead of going through billing.ts, a real crack in
  // this module's "single calculation source" claim (harmless today only
  // because no discount mechanism is wired up yet — see NO_DISCOUNT usage
  // above). Individual per-line displays elsewhere are unaffected by this
  // fix and intentionally left as-is (a single line's own float arithmetic
  // carries no aggregation-drift risk); this fix is scoped to the two
  // group-level aggregations that do.
  const toBillingLine = (l: TabletCartItem): BillingLine => (
    { seat: l.seat, unitDollars: l.unit, modifierDeltaDollars: l.mods.map((m) => m.delta), qty: l.qty }
  );

  // No promo/discount source exists yet (Story 15-3: the prior VERDURA10
  // toggle was a client-side fiction with no backend validation — removed,
  // not reimplemented, since no authoritative promotion model exists to
  // validate it against). `computeCartTotals` still accepts a generic
  // DiscountInput for whenever a real one does.
  const cartTotals = useMemo(
    () => computeCartTotals(billingLines, { kind: 'none' }),
    [billingLines],
  );

  const totals = useMemo(() => ({
    sub: cartTotals.subtotalCents / 100,
    gst: cartTotals.containedGstCents / 100, // disclosure only — NOT added to `total`
    total: cartTotals.payableCents / 100, // provisional — see DL-072; Idealpos-authoritative total is story 15-5's scope
  }), [cartTotals]);

  const seatCounts = useMemo(() => {
    const c: Record<number, number> = {};
    cart.forEach(l => {
      c[l.seat] = (c[l.seat] || 0) + l.qty;
    });
    return c;
  }, [cart]);

  // Per-seat provisional payable amount — the seat's own item/modifier
  // total less its proportional share of any valid discount. No service
  // charge or GST is added (matches the table-level `totals.total` rule);
  // per-seat figures are reconciled to sum exactly to the table-level
  // rounded totals via billing.ts's largest-remainder allocation.
  const seatGrand = (n: number) => seatBreakdownFor(cartTotals, n).payableCents / 100;

  const getGroupsFor = (modeType: 'seat' | 'course' | 'table') => {
    const out: Array<{ title: string; lines: TabletCartItem[]; meta: any }> = [];
    const pushGroup = (title: string, lines: TabletCartItem[], meta = {}) => {
      if (lines.length) out.push({ title, lines, meta });
    };
    if (modeType === 'seat') {
      pushGroup(serviceMode === 'takeaway' ? 'Order items' : 'Table (shared)', cart.filter((l) => l.seat === 0), { seat: 0 });
      for (let n = 1; n <= seatsCount; n++) {
        pushGroup('Seat ' + n, cart.filter((l) => l.seat === n), { seat: n });
      }
    } else if (modeType === 'course') {
      sortedCategories.forEach(catItem => {
        const linesForCat = cart.filter(line => {
          const mItem = menuItems.find(m => m.id === line.itemId);
          return mItem && mItem.categoryId === catItem.id;
        });
        pushGroup(catItem.name, linesForCat);
      });
      const activeCatIds = new Set(sortedCategories.map(c => c.id));
      const uncategorizedLines = cart.filter(line => {
        const mItem = menuItems.find(m => m.id === line.itemId);
        return !mItem || !activeCatIds.has(mItem.categoryId);
      });
      pushGroup('General', uncategorizedLines);
    } else {
      pushGroup('All items', [...cart]);
    }
    return out;
  };

  // ── Actions ──
  const handleAddLine = (item: MenuItem, mods: TabletCartItem['mods'], qty: number, note: string, seat: number) => {
    const { basePrice } = getItemPriceInfo(item.price, item.title);
    setCart(prev => {
      const nextKey = prev.length > 0 ? Math.max(...prev.map(l => l.key)) + 1 : 1;
      return [...prev, {
        key: nextKey,
        itemId: item.id,
        name: item.title,
        unit: basePrice,
        qty,
        mods,
        note: note.trim(),
        seat,
        course: categories.find(c => c.id === item.categoryId)?.name || item.subCategory || 'Mains',
        sent: false
      }];
    });
  };

  // `sel` is keyed by real modifierGroupId -> optionId -> selected, always
  // from `item.modifierGroups` (authoritative backend data, Story 15-3) —
  // never a category/name-inferred catalog.
  const handleOpenSlide = (item: MenuItem) => {
    const groups = item.modifierGroups || [];
    const sel: Record<string, Record<string, boolean>> = {};
    groups.forEach(g => {
      if (!g.id) return;
      sel[g.id] = {};
      // A required single-select group gets a sane default so the modal
      // doesn't open already invalid — the first available option, since
      // there's no authored "default" flag in the real domain model.
      if (g.required && g.maxSelections === 1) {
        const firstAvailable = g.options.find(o => o.isAvailable);
        if (firstAvailable?.id) {
          sel[g.id][firstAvailable.id] = true;
        }
      }
    });
    setSlide({ itemId: item.id, sel, qty: 1, note: '', seat: activeSeat });
  };

  const handleTapItem = (item: MenuItem) => {
    const groups = item.modifierGroups || [];
    if (groups.length > 0) {
      handleOpenSlide(item);
    } else {
      handleAddLine(item, [], 1, '', activeSeat);
    }
  };

  // Client-side mirror of the backend's authoritative required/min/max
  // enforcement (OrdersService.resolveModifiers, strict path) — purely for
  // UX (block "Add"/show a clear message before a round trip); the server
  // independently re-validates every selection regardless of what this
  // function decides. Zero-priced selected options are never dropped: for
  // a required group, the option id itself is the thing that must reach
  // the server, not just its price contribution.
  function validateSlideSelection(groups: ModifierGroup[], sel: Record<string, Record<string, boolean>>): string[] {
    const messages: string[] = [];
    for (const g of groups) {
      if (!g.id) continue;
      const count = Object.values(sel[g.id] || {}).filter(Boolean).length;
      if (g.required && count === 0) {
        messages.push(`"${g.name}" requires a selection`);
        continue;
      }
      if ((g.required || count > 0) && count < g.minSelections) {
        messages.push(`"${g.name}" requires at least ${g.minSelections} selection(s)`);
      }
      if (count > g.maxSelections) {
        messages.push(`"${g.name}" allows at most ${g.maxSelections} selection(s)`);
      }
    }
    return messages;
  }

  const handleConfirmSlide = () => {
    if (!slide) return;
    const item = menuItems.find(i => i.id === slide.itemId);
    if (!item) return;

    const groups = item.modifierGroups || [];
    if (validateSlideSelection(groups, slide.sel).length > 0) return; // Add button is disabled in this state too — defensive only.

    const mods: TabletCartItem['mods'] = [];
    groups.forEach(g => {
      if (!g.id) return;
      g.options.forEach(op => {
        if (!op.id) return;
        const isSelected = !!slide.sel[g.id!]?.[op.id];
        if (isSelected) {
          // Every selected option is submitted, including a zero-priced
          // one — its id is what the server needs to see for a required
          // group, not just a non-zero price contribution.
          mods.push({ label: op.name, delta: op.priceDeltaCents / 100, groupId: g.id!, optionId: op.id });
        }
      });
    });

    handleAddLine(item, mods, slide.qty, slide.note, slide.seat);
    setActiveSeat(slide.seat);
    setSlide(null);
  };

  // Builds the real backend order-creation payload from unsent cart lines.
  // menuItemId (item.itemId) already comes from the real backend-backed
  // menu store (Phase 2) — never fabricated. selectedModifiers carries only
  // ids (Story 15-3) — the server resolves name/price from authoritative
  // data, never a client-supplied value. expectedUnitPriceCents is the
  // price this tablet is currently displaying for the line — if the
  // server's authoritative resolution disagrees, the whole request fails
  // closed with a 409 the caller can recover from, rather than silently
  // charging a different amount than what was reviewed.
  function buildOrderItemsPayload() {
    return cart.filter(item => !item.sent).map(item => ({
      menuItemId: item.itemId,
      quantity: item.qty,
      selectedModifiers: item.mods
        .filter((mod): mod is typeof mod & { groupId: string; optionId: string } => !!mod.groupId && !!mod.optionId)
        .map(mod => ({ modifierGroupId: mod.groupId, optionId: mod.optionId })),
      expectedUnitPriceCents: Math.round(item.unit * 100) + item.mods.reduce((s, m) => s + Math.round(m.delta * 100), 0),
      notes: item.seat > 0 ? `[Seat ${item.seat}] ${item.note}` : (item.note || undefined),
    }));
  }

  // Creates a real order via POST /api/admin/orders (staff/Order-Tablet
  // creation path — see apps/api/src/orders/orders.controller.ts). Returns
  // the backend-persisted order on success, or null on failure (with
  // orderActionError set honestly — never a fabricated fallback order).
  async function submitOrderToKitchen(): Promise<LiveOrder | null> {
    // Story 15-13: dine-in still requires a real backend table; takeaway
    // never resolves or sends one — no table is ever fabricated.
    let realTable: RealTable | undefined;
    if (serviceMode === 'dine_in') {
      realTable = table ? realTableByNumber.get(table.tableNumber) : undefined;
      if (!realTable) {
        setOrderActionError('This table is not linked to a real backend table yet — cannot send the order.');
        return null;
      }
    }
    const items = buildOrderItemsPayload();
    if (items.length === 0) return null;

    setIsSubmittingOrder(true);
    setOrderActionError(null);
    try {
      // Restricted/customer-context ordering (an unelevated standalone
      // device) must never reach /api/admin/orders — that endpoint's
      // staff-tier RolesGuard would either reject a bare device token
      // outright or, worse, imply administrative-adjacent authority it
      // should never have. Story 15-1/DL-081's purpose-built
      // /api/tablet/orders endpoint is used instead; its own venue comes
      // only from the device's own token, never client-supplied.
      const url = restrictedOrdersEndpoint ? `${API_BASE}/api/tablet/orders` : `${API_BASE}/api/admin/orders`;
      const notes = serviceMode === 'takeaway'
        ? 'Order Tablet Checkout (Takeaway)'
        : `Order Tablet Checkout (Guests: ${seatsCount})`;
      const body = restrictedOrdersEndpoint
        ? {
            ...(realTable ? { tableId: realTable.id } : {}),
            serviceMode,
            items,
            notes,
            idempotencyKey: orderIdempotencyKey,
          }
        : {
            venueId: DEFAULT_VENUE_ID,
            ...(realTable ? { tableId: realTable.id } : {}),
            serviceMode,
            items,
            notes,
            idempotencyKey: orderIdempotencyKey,
          };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 409 && serviceMode === 'dine_in') {
          // A 409 here can mean this table already has a durable active
          // order — including the case where THIS submission's own earlier
          // attempt already committed server-side (e.g. a browser reload
          // regenerated orderIdempotencyKey — see its own doc comment —
          // so this retry no longer shares a key with an in-flight
          // original request the backend's table-lock now correctly
          // rejected as a duplicate; see persistOrder's FOR UPDATE guard).
          // Recover the real state rather than leaving the customer at a
          // dead-end error: refetch the live order list and, if this
          // table now shows an active order, hydrate the cart from it
          // exactly as selecting an occupied table already does
          // (handleSelectTable) — showing what the kitchen actually has
          // is the only honest response to "did my order go through?".
          // Takeaway has no table to recover via — every takeaway
          // submission is inherently a fresh new order (see
          // handleSendToKitchen's own serviceMode guard above), so this
          // recovery path is dine-in only.
          await queryClient.refetchQueries({ queryKey: liveOrdersQueryKey(restrictedOrdersEndpoint) });
          const refetched = queryClient.getQueryData<LiveOrder[]>(liveOrdersQueryKey(restrictedOrdersEndpoint));
          const recovered = refetched?.find(
            (o) => o.tableNumber === table?.tableNumber && o.status !== 'completed' && o.status !== 'cancelled',
          );
          if (recovered) {
            const hydrated = hydrateTableOrder(recovered);
            setCart(hydrated.cart);
            setGuests(hydrated.guests);
            setSeatsCount(hydrated.seatsCount);
            setCreatedOrderRef(recovered.id);
            setCreatedTakeawayReference(recovered.takeawayReference ?? null);
            return recovered;
          }
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Failed to send order (${res.status})`);
      }
      const created = await res.json() as LiveOrder;
      // Real backend data — merge immediately for a responsive UI; the
      // WebSocket orderUpdate push (already subscribed via useLiveOrders)
      // will reconcile it again shortly after.
      queryClient.setQueryData<LiveOrder[]>(liveOrdersQueryKey(restrictedOrdersEndpoint), current =>
        current ? [created, ...current.filter(o => o.id !== created.id)] : [created]);
      setCart(prev => prev.map(item => ({ ...item, sent: true })));
      setCreatedOrderRef(created.id);
      setCreatedTakeawayReference(created.takeawayReference ?? null);
      return created;
    } catch (err) {
      setOrderActionError(err instanceof Error ? err.message : 'Failed to send order to the kitchen.');
      return null;
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  // Attempts the real, FSM-enforced status transition to 'completed' (or
  // 'cancelled'). The backend only allows completed from 'ready' — if the
  // kitchen hasn't marked the order ready yet, this honestly reports that
  // instead of pretending payment succeeded.
  async function transitionOrderStatus(orderId: string, status: 'completed' | 'cancelled'): Promise<boolean> {
    setIsSubmittingOrder(true);
    setOrderActionError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            status === 'completed'
              ? 'This order is still being prepared — payment can complete once the kitchen marks it ready.'
              : (body.message || `Could not update order (${res.status})`),
          );
        }
        throw new Error(`Could not update order (${res.status})`);
      }
      const updated = await res.json() as LiveOrder;
      queryClient.setQueryData<LiveOrder[]>(liveOrdersQueryKey(restrictedOrdersEndpoint), current =>
        current?.map(o => o.id === updated.id ? updated : o) || [updated]);
      return true;
    } catch (err) {
      setOrderActionError(err instanceof Error ? err.message : 'Failed to update order.');
      return false;
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  // Story 15-5: fetches the real, current POSSyncRecord/reconciliation
  // state for an order. Never called on a timer that outlives the
  // component -- see the polling useEffect below, which clears its own
  // interval on unmount/order-change.
  async function fetchPosSyncStatus(orderId: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/pos-sync`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setPosSyncLoadError(`Could not load Idealpos reconciliation status (${res.status})`);
        return;
      }
      const body = (await res.json()) as PosSyncView;
      setPosSyncView(body);
      setPosSyncLoadError(null);
    } catch (err) {
      setPosSyncLoadError(err instanceof Error ? err.message : 'Failed to load reconciliation status.');
    }
  }

  // KOT status: fetches the real, current PrinterJob rows for an order --
  // same pattern and same never-fabricated convention as
  // fetchPosSyncStatus above.
  async function fetchPrintJobsStatus(orderId: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/print-jobs`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setPrintJobsLoadError(`Could not load kitchen ticket status (${res.status})`);
        return;
      }
      const body = (await res.json()) as PrintJobView[];
      setPrintJobsView(body);
      setPrintJobsLoadError(null);
    } catch (err) {
      setPrintJobsLoadError(err instanceof Error ? err.message : 'Failed to load kitchen ticket status.');
    }
  }

  const TERMINAL_PRINT_JOB_STATES = new Set(['delivered', 'manual', 'failed', 'cancelled']);

  useEffect(() => {
    // Clear any previous order's reconciliation panel immediately on every
    // createdOrderRef change (including a change to null) -- otherwise a
    // stale render showing a DIFFERENT order's status/pay-eligibility could
    // briefly (or, before the resync fix above, indefinitely) be visible
    // for the order actually being viewed.
    setPosSyncView(null);
    setPosSyncLoadError(null);
    setPrintJobsView(null);
    setPrintJobsLoadError(null);
    if (!createdOrderRef) return;
    let cancelled = false;
    void fetchPosSyncStatus(createdOrderRef);
    void fetchPrintJobsStatus(createdOrderRef);
    const interval = setInterval(() => {
      if (cancelled) return;
      const idealposDone = posSyncView?.status && TERMINAL_POS_SYNC_STATES.has(posSyncView.status);
      if (!idealposDone) void fetchPosSyncStatus(createdOrderRef);
      const kotDone =
        printJobsView !== null &&
        printJobsView.every((job) => TERMINAL_PRINT_JOB_STATES.has(job.status));
      if (!kotDone) void fetchPrintJobsStatus(createdOrderRef);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Intentionally depends only on createdOrderRef, not posSyncView --
    // this effect re-arms the interval only when the order changes; reading
    // posSyncView inside the interval callback always sees its latest value
    // via closure-over-state-setter semantics is not guaranteed here, so
    // instead each tick calls fetchPosSyncStatus unconditionally except
    // when the (possibly stale) last-known state was already terminal --
    // an intentional trade-off (never OVER-polls a live order; may run one
    // extra tick after reaching terminal, never fewer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdOrderRef]);

  // Refresh/reconnect persistence AND cross-table correctness:
  // `createdOrderRef` is client-side React state and does not survive a
  // browser refresh, but the real order and its POSSyncRecord do (they are
  // backend-persisted). This resync always re-derives `createdOrderRef`
  // from the live orders query for whichever table is currently selected,
  // rather than only doing so when it was previously null.
  //
  // Regression fix (2026-08-20, found during Story 15-5 real-browser
  // verification): the "Charge"/"Place order" button (below) only calls
  // `setScreen('pay')` -- it does not itself set `createdOrderRef`. The
  // previous version of this effect skipped its resync whenever
  // `createdOrderRef` was already truthy, so after viewing ANY table's
  // payment screen once, `createdOrderRef` was never updated again:
  // navigating to a SECOND table's payment screen kept polling and
  // displaying the FIRST table's Idealpos reconciliation status (reproduced
  // live -- a table with a real, unresolved discrepancy displayed the
  // previous table's "totals match" and enabled Pay). Always resyncing to
  // the current table's own active order (or clearing to null if that
  // table has none yet) closes this — a stale/wrong order's reconciliation
  // result can never be displayed for the table actually being viewed.
  useEffect(() => {
    if (screen !== 'pay') return;
    // Story 15-13: this resync is a table-lookup mechanism — takeaway has
    // no table to look up by, so createdOrderRef (already set directly by
    // submitOrderToKitchen on success) is left exactly as it is. A raw page
    // refresh mid-takeaway genuinely cannot recover which order was in
    // progress from table state alone (there is none) — the truthful state
    // after a refresh is "no order in progress," not a guess.
    if (serviceMode === 'takeaway') return;
    const tableNumber = tableId ? tableId.slice(1) : '';
    const activeOrder = getActiveOrderForTable(tableNumber);
    if (activeOrder) {
      if (activeOrder.id !== createdOrderRef) setCreatedOrderRef(activeOrder.id);
    } else if (createdOrderRef) {
      setCreatedOrderRef(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, tableId, serviceMode, orders]);

  // 2026-08-20: the single primary staff action on the cart screen. Merges
  // what were previously two separate steps ("Send to kitchen" then a
  // separate "Charge"/payment-method screen) into one: submit the order,
  // then go straight to the operational dispatch-status screen (Idealpos/
  // KOT/KDS) -- payment selection no longer happens here at all (Idealpos
  // owns Card/Cash/EFTPOS; see the redesigned `screen === 'pay'` staff
  // branch below). Guest/restricted-mode ordering is untouched -- it still
  // reaches `screen === 'pay'` via its own separate `Place order` button.
  const handleSendToKitchen = async () => {
    // Story 15-13: the one-active-order-per-table guard is a dine-in-only
    // concept — takeaway has no table to collide on, and every takeaway
    // submission is inherently a fresh new order.
    if (serviceMode === 'dine_in') {
      const tableNumber = tableId ? tableId.slice(1) : '';
      const activeOrder = getActiveOrderForTable(tableNumber);

      if (activeOrder) {
        // The backend enforces one active dine-in order per table (see
        // OrdersService.validateTableForOrder) — there is no "append items to
        // an existing order" endpoint, so a second round can't be silently
        // merged in the way the previous client-only mock allowed.
        setOrderActionError('This table already has an order being prepared.');
        setCreatedOrderRef(activeOrder.id);
        setScreen('pay');
        return;
      }
    }

    const created = await submitOrderToKitchen();
    if (created) setScreen('pay');
  };

  // The single primary customer/guest action -- mirrors handleSendToKitchen
  // exactly (submit once, land on the same order-status/dispatch screen).
  // The Order Tablet never processes payment: there is no payment step
  // before or after this action. Payment happens separately in
  // Idealpos/EFTPOS -- see the "Review Order" screen's informational note
  // and DL-087.
  const handleGuestSendToKitchen = async () => {
    if (serviceMode === 'dine_in') {
      const tableNumber = tableId ? tableId.slice(1) : '';
      const activeOrder = getActiveOrderForTable(tableNumber);

      if (activeOrder) {
        setOrderActionError('This table already has an order being prepared.');
        setCreatedOrderRef(activeOrder.id);
        return;
      }
    }

    await submitOrderToKitchen();
  };

  const handleReset = () => {
    setScreen('floor');
    setServiceMode('dine_in');
    setCreatedTakeawayReference(null);
    setTableId(null);
    setGuests(0);
    setSeatsCount(0);
    setActiveSeat(1);
    setCart([]);
    setCat('all');
    setSearch('');
    setGroupBy('seat');
    setSlide(null);
    setTableNote('');
    setTableNoteDraft('');
    setOrderIdempotencyKey(crypto.randomUUID());
  };

  // Story 15-13: the takeaway counterpart of startOrder below — bypasses
  // table selection entirely (no table is ever fabricated for a takeaway
  // order) and goes straight to the cart/order screen. Rotates the
  // idempotency key exactly like starting a genuinely new dine-in order
  // (handleSelectTable's own non-occupied branch, same reasoning: a fresh
  // takeaway order must never collide with whatever the previous key was
  // used for). Seats are a dine-in-only concept for this component (see
  // billing.ts's per-seat split) -- activeSeat/seatsCount are pinned to 0 so
  // every takeaway line lands in the single unsplit cart bucket, never a
  // "Seat N" grouping that would misleadingly imply per-guest seating.
  const handleStartTakeaway = () => {
    setServiceMode('takeaway');
    setCreatedOrderRef(null);
    setCreatedTakeawayReference(null);
    setTableId(null);
    setGuests(0);
    setSeatsCount(0);
    setActiveSeat(0);
    setCart([]);
    setTableNote('');
    setOrderIdempotencyKey(crypto.randomUUID());
    setScreen('order');
  };

  const handleSelectTable = (tb: any, status: 'available' | 'occupied' | 'reserved', activeOrder: any) => {
    const free = status === 'available' || (mode === 'staff' && (status === 'reserved' || status === 'occupied'));
    if (!free) return;

    // Selecting a table on the floor plan is unambiguously a dine-in action.
    setServiceMode('dine_in');

    if (tableId === tb.id) {
      setTableId(null);
      setGuests(0);
      setCart([]);
      setSeatsCount(0);
      setTableNote('');
    } else {
      setTableId(tb.id);
      if (status === 'occupied' && activeOrder) {
        const hydrated = hydrateTableOrder(activeOrder);
        setCart(hydrated.cart);
        setGuests(hydrated.guests);
        setSeatsCount(hydrated.seatsCount);
      } else {
        setCart([]);
        setGuests(0);
        setSeatsCount(0);
        setTableNote('');
        // A genuinely new order is about to start at this table -- rotate
        // the idempotency key so it can never collide with whatever order
        // (at this table or a different one) the previous key was already
        // used for.
        //
        // Regression fix (2026-08-20, found during Story 15-5 real-browser
        // verification): `orderIdempotencyKey` was previously only rotated
        // by `handleReset`, reachable only after a full payment cycle at
        // the SAME table. Selecting a second, different table to start a
        // new order while an earlier order was still pending (a normal
        // multi-table service pattern) reused the same stale key -- the
        // backend correctly rejected the second table's "Send to
        // kitchen"/"Charge" with a confusing idempotencyKey-reuse
        // ConflictException (reproduced live: table 5's submission failed
        // with "idempotencyKey ... was already used to create a different
        // order" after table 4's order had already used it), silently
        // blocking ordinary concurrent-table service.
        setOrderIdempotencyKey(crypto.randomUUID());
      }
    }
  };

  // ── Render Values ──
  const isStaff = mode === 'staff';
  const table = TABLES.find((t) => `T${t.tableNumber}` === tableId) || null;
  const tableNumber = table ? table.tableNumber : '';
  const activeOrder = getActiveOrderForTable(tableNumber);
  const occSel = !!activeOrder;

  const tablesV: TableMapItem[] = TABLE_LAYOUTS.map((tb) => {
    const sel = tb.id === tableId;
    const isReserved = isTableReserved(tb.id.slice(1));
    const activeOrd = getActiveOrderForTable(tb.id.slice(1));
    const status = activeOrd ? 'occupied' : isReserved ? 'reserved' : 'available';
    const free = status === 'available' || (isStaff && (status === 'reserved' || status === 'occupied'));
    
    // table status colors: Available: white, Occupied: #FFB703, Reserved: #8B5CF6
    const statusColor = status === 'occupied' ? '#FFB703' : status === 'reserved' ? '#8B5CF6' : 'var(--color-surface)';
    const textColor = sel ? '#fff' : status === 'occupied' ? '#4A3200' : status === 'reserved' ? '#fff' : 'var(--color-text)';
    const borderStyle = sel ? '1px solid var(--color-primary)' : status === 'occupied' ? '1px solid #FFB703' : status === 'reserved' ? '1px solid #8B5CF6' : free ? '1.5px solid var(--color-border-strong)' : '1px solid var(--color-border)';

    return {
      id: tb.id,
      x: mapX(tb.x),
      y: mapY(tb.y),
      w: mapW(tb.w),
      h: mapH(tb.h),
      label: tb.id,
      subLabel: tb.seats + ' seats' + (status !== 'available' ? ' · ' + status : ''),
      cursor: free ? 'pointer' : 'default',
      bg: sel ? 'var(--color-primary)' : statusColor,
      border: borderStyle,
      color: textColor,
      shadow: sel ? 'var(--shadow-md)' : 'none',
      onTap: () => handleSelectTable(tb, status, activeOrd),
    };
  });

  // Filter active categories and sort by sortOrder
  const sortedCategories = useMemo(() => {
    return [...categories]
      .filter(c => c.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [categories]);

  const categoriesV = useMemo(() => {
    return [
      { id: 'all', name: 'All Items', icon: getCategoryIconPath('All Items') },
      { id: 'popular', name: 'Popular', icon: getCategoryIconPath('Popular') },
      ...sortedCategories
    ].map((c) => {
      const act = c.id === cat;
      return {
        id: c.id,
        name: c.name,
        icon: getCategoryIconPath(c.name),
        onTap: () => setCat(c.id),
        bg: act ? 'var(--color-primary-subtle)' : 'transparent',
        color: act ? 'var(--color-primary)' : 'var(--color-text-secondary)',
        weight: act ? 600 : 500,
        accent: act ? 'var(--color-primary)' : 'transparent'
      };
    });
  }, [sortedCategories, cat]);

  // Filter items: must belong to an active category, filter by selected category and search string, then sort
  // alphabetically by customer-facing name within each category (the authoritative category order from
  // `sortedCategories` is preserved as-is; `sortOrder` is a per-item admin/reorder field, not a naming
  // convention, and must never drive display order here — see MENU_COLLATOR in shared/menu/menuData.mjs
  // for the locale-aware, case-insensitive comparator used).
  const list = useMemo(() => {
    const activeCategoryIds = new Set(sortedCategories.map(c => c.id));
    let filtered = menuItems.filter((it) => {
      if (!activeCategoryIds.has(it.categoryId)) return false;
      return (cat === 'all' || (cat === 'popular' ? it.nutritionalDetails?.isFeatured : it.categoryId === cat));
    });

    const q = search.trim().toLowerCase();
    if (q) {
      filtered = menuItems.filter((it) => {
        if (!activeCategoryIds.has(it.categoryId)) return false;
        return it.title.toLowerCase().includes(q) || (it.description && it.description.toLowerCase().includes(q));
      });
    }

    // Group by the authoritative category order first (never mutating `filtered`/`menuItems`), then
    // alphabetize within each group, so a flat "All Items"/"Popular" view still reads as
    // category-cohesive, ordered A-Z within each category.
    const byCategory = new Map<string, MenuItem[]>();
    filtered.forEach((it) => {
      const group = byCategory.get(it.categoryId);
      if (group) group.push(it); else byCategory.set(it.categoryId, [it]);
    });
    return sortedCategories.flatMap((c) => {
      const group = byCategory.get(c.id);
      return group ? sortMenuItemsAlphabetically(group) : [];
    });
  }, [menuItems, sortedCategories, cat, search]);

  const itemsV = useMemo(() => {
    return list.map((it) => {
      const { basePrice } = getItemPriceInfo(it.price, it.title);
      const groups = it.modifierGroups || [];
      return {
        id: it.id,
        name: it.title,
        priceStr: formatPrice(basePrice),
        time: it.preparationTime || (it as any).prepTime || 10,
        popular: it.nutritionalDetails?.isFeatured,
        tagList: it.nutritionalDetails?.tags || [],
        imageUrl: it.imageUrl,
        isAvailable: it.isAvailable !== false,
        plusGlyph: groups.length ? '⋯' : '+',
        onTap: () => {
          if (it.isAvailable !== false) {
            handleTapItem(it);
          }
        },
      };
    });
    // handleTapItem is intentionally omitted below: it's a plain
    // (non-useCallback) function recreated every render, so listing it here
    // would make this memo recompute on every render too. Traced its
    // transitive closures (handleOpenSlide/handleAddLine): they only read
    // `activeSeat`/`categories` (both already listed) plus stable setState
    // functions — no stale-closure risk today. If handleAddLine/
    // handleOpenSlide/handleTapItem ever start reading additional component
    // state, that state must be added here explicitly, since this
    // suppression means the linter can no longer catch it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, activeSeat, categories]);

  const q = search.trim().toLowerCase();
  const catTitle = q ? 'Search results' : (categoriesV.find((c) => c.id === cat) || {}).name || '';

  const seatChips = useMemo(() => {
    const mkChip = (n: number) => {
      const act = activeSeat === n;
      const count = seatCounts[n] || 0;
      return {
        label: n === 0 ? 'Table' : 'Seat ' + n,
        count,
        hasCount: count > 0,
        onTap: () => setActiveSeat(n),
        bg: act ? 'var(--color-primary)' : 'var(--color-surface)',
        border: act ? '1px solid var(--color-primary)' : '1px solid var(--color-border-strong)',
        color: act ? '#fff' : 'var(--color-text)',
        badgeBg: act ? 'rgba(255,255,255,0.25)' : 'var(--color-primary-subtle)',
        badgeColor: act ? '#fff' : 'var(--color-primary)'
      };
    };
    const chips = [mkChip(0)];
    for (let n = 1; n <= seatsCount; n++) {
      chips.push(mkChip(n));
    }
    return chips;
  }, [seatsCount, activeSeat, seatCounts]);

  const groupTabs = [
    { label: 'By seat', id: 'seat' },
    { label: 'By course', id: 'course' },
    { label: 'Table', id: 'table' }
  ].map((tab) => {
    const act = groupBy === tab.id;
    return {
      label: tab.label,
      onTap: () => setGroupBy(tab.id as any),
      bg: act ? 'var(--color-surface)' : 'transparent',
      color: act ? 'var(--color-text)' : 'var(--color-text-secondary)',
      shadow: act ? 'var(--shadow-xs)' : 'none'
    };
  });

  const cartGroups = getGroupsFor(groupBy).map((g: any) => ({
    title: g.title,
    // Story 15-4 fix (independent review, 2026-08-19): a seat-tagged group
    // (groupBy === 'seat') reuses the same seatGrand()/billing.ts figure the
    // payment and seat-check screens already use, instead of re-deriving it
    // via local float-dollar arithmetic — the two could silently diverge the
    // moment a real discount is wired up (billing.ts apportions discount
    // per-seat; this reducer never did). Course/table groupings have no
    // seat-level breakdown to reuse, so they fall back to billing.ts's own
    // cents-safe per-line total (lineTotalCents) — still the single
    // calculation source, just summed without seat-discount apportionment,
    // which doesn't apply to a non-seat grouping regardless.
    totalStr: formatPrice(
      typeof g.meta?.seat === 'number'
        ? seatGrand(g.meta.seat)
        : g.lines.reduce((a: number, l: TabletCartItem) => a + lineTotalCents(toBillingLine(l)) / 100, 0),
    ),
    lines: g.lines.map((ln: TabletCartItem) => ({
      key: ln.key,
      name: ln.name,
      qty: ln.qty,
      totalStr: formatPrice(lineTotal(ln)),
      hasMods: ln.mods.length > 0,
      modText: ln.mods.map((m: any) => m.label + (m.delta ? ' +' + formatPrice(m.delta).slice(1) : '')).join(' · '),
      hasNote: !!ln.note,
      note: ln.note,
      sent: ln.sent,
      editable: !ln.sent,
      opacity: ln.sent ? 0.72 : 1,
      showSeatTag: groupBy !== 'seat',
      seatTag: ln.seat === 0 ? 'Table' : 'S' + ln.seat,
      onInc: () => setCart(prev => prev.map(l => l.key === ln.key ? { ...l, qty: l.qty + 1 } : l)),
      onDec: () => setCart(prev => prev.map(l => l.key === ln.key ? { ...l, qty: l.qty - 1 } : l).filter(l => l.qty > 0)),
    }))
  }));

  const cartCount = cart.reduce((a, l) => a + l.qty, 0);
  const unsent = cart.some((l) => !l.sent);
  const cartEmpty = cart.length === 0;

  // Customizer modal values
  let slideVals = {
    slideOpen: false, slideName: '', slideDesc: '', slideGroups: [] as any[], slideSeats: [] as any[],
    slideQty: 1, slideNote: '', slideTotalStr: '', slideValid: true, slideValidationMessages: [] as string[],
  };
  if (slide) {
    const item = menuItems.find((i) => i.id === slide.itemId);
    if (item) {
      const groups = item.modifierGroups || [];
      let unit = getItemPriceInfo(item.price, item.title).basePrice;
      const slideGroups = groups.map((g) => {
        const groupId = g.id;
        const selectedCount = groupId ? Object.values(slide.sel[groupId] || {}).filter(Boolean).length : 0;
        return {
          name: g.name,
          hint: `${g.required ? 'Required' : 'Optional'} · ${g.maxSelections === 1 ? 'choose 1' : `choose up to ${g.maxSelections}`}`,
          options: g.options.map((op) => {
            const optionId = op.id;
            const on = !!(groupId && optionId && slide.sel[groupId]?.[optionId]);
            const unavailable = op.isAvailable === false;
            if (on) unit += op.priceDeltaCents / 100;
            return {
              label: op.name,
              deltaStr: unavailable ? 'Unavailable' : (op.priceDeltaCents ? '+' + formatPrice(op.priceDeltaCents / 100) : ''),
              unavailable,
              bg: unavailable ? 'var(--color-surface-2)' : on ? 'var(--color-primary-subtle)' : 'var(--color-surface)',
              border: on && !unavailable ? '1px solid var(--color-primary)' : '1px solid var(--color-border-strong)',
              markRadius: g.maxSelections === 1 ? '999px' : '4px',
              markBorder: on && !unavailable ? '1px solid var(--color-primary)' : '1px solid var(--color-border-strong)',
              markBg: on && !unavailable ? 'var(--color-primary)' : 'var(--color-surface)',
              markGlyph: on && !unavailable ? '✓' : '',
              onTap: unavailable || !groupId || !optionId ? undefined : () => setSlide(prev => {
                if (!prev) return null;
                const newSel = { ...prev.sel };
                const currentGroupSel = newSel[groupId] || {};
                newSel[groupId] = g.maxSelections === 1
                  ? { [optionId]: true }
                  : { ...currentGroupSel, [optionId]: !currentGroupSel[optionId] };
                return { ...prev, sel: newSel };
              })
            };
          }),
          selectedCount,
        };
      });

      const mkSS = (n: number) => {
        const act = slide.seat === n;
        return {
          label: n === 0 ? 'Table' : 'Seat ' + n,
          onTap: () => setSlide(prev => prev ? { ...prev, seat: n } : null),
          bg: act ? 'var(--color-primary)' : 'var(--color-surface)',
          border: act ? '1px solid var(--color-primary)' : '1px solid var(--color-border-strong)',
          color: act ? '#fff' : 'var(--color-text)'
        };
      };
      const slideSeats = [mkSS(0)];
      for (let n = 1; n <= seatsCount; n++) {
        slideSeats.push(mkSS(n));
      }

      const validationMessages = validateSlideSelection(groups, slide.sel);

      slideVals = {
        slideOpen: true,
        slideName: item.title,
        slideDesc: item.description || '',
        slideGroups,
        slideSeats,
        slideQty: slide.qty,
        slideNote: slide.note,
        slideTotalStr: formatPrice(unit * slide.qty),
        slideValid: validationMessages.length === 0,
        slideValidationMessages: validationMessages,
      };
    }
  }

  // Review/status screen line-item breakdown, grouped by seat -- purely
  // informational (review + KDS/KOT/Idealpos status), never a payment
  // check/split.
  const reviewGroups = getGroupsFor('seat').map((g) => ({
    title: g.title,
    totalStr: formatPrice(seatGrand(g.meta.seat)),
    lines: g.lines.map((l: TabletCartItem) => ({
      qty: l.qty,
      name: l.name + (l.mods.length ? ' · ' + l.mods.map((m: any) => m.label).join(', ') : ''),
      totalStr: formatPrice(lineTotal(l))
    }))
  }));

  const seg = (act: boolean) => ({
    bg: act ? 'var(--color-surface)' : 'transparent',
    color: act ? 'var(--color-text)' : 'var(--color-text-secondary)',
    shadow: act ? 'var(--shadow-xs)' : 'none'
  });

  // ── Permissions & Roles ──
  const currentUser = useAuthStore(s => s.user);

  // Standalone mode has no fabricated identity: the role used for gating
  // staff-only UI here is the REAL elevated staff member's role (story
  // 15-1/DL-081) — or empty (no permissions) when unelevated, never a
  // simulated fallback. The embedded Admin Console route is unchanged,
  // using the real logged-in staff member's role as before. Note this is
  // a UX convenience only — the actual security boundary is the backend
  // guard chain on each endpoint, which enforces this independently of
  // whatever the frontend chooses to show or hide.
  const userRole = (standalone ? (staffElevated ? tabletDeviceAuth.staffRole ?? '' : '') : currentUser?.role || '').toLowerCase();

  // Permissions
  const hasTransferPerm = isStaff && (
    userRole === 'staff' ||
    userRole === 'server' ||
    userRole === 'supervisor' ||
    userRole === 'manager' ||
    userRole === 'admin'
  );

  const hasClosePerm = isStaff && (
    userRole === 'supervisor' ||
    userRole === 'manager' ||
    userRole === 'admin'
  );

  // Order-affecting actions (status transitions) are audit-logged by the
  // backend itself (OrdersService.updateStatus -> AuditLogService), which
  // is the real, queryable source of truth — no separate client-side/
  // localStorage audit trail is written here.

  // ── Action Button States ──
  const enquiryEnabled = !!table;
  const enquiryColor = enquiryEnabled ? 'var(--color-text)' : 'var(--color-text-tertiary)';
  const enquiryStroke = enquiryEnabled ? 'var(--color-primary)' : 'var(--color-text-tertiary)';
  const enquiryCursor = enquiryEnabled ? 'pointer' : 'default';

  const transferEnabled = !!table && occSel && hasTransferPerm;
  const transferColor = transferEnabled ? 'var(--color-text)' : 'var(--color-text-tertiary)';
  const transferStroke = transferEnabled ? 'var(--color-primary)' : 'var(--color-text-tertiary)';
  const transferCursor = transferEnabled ? 'pointer' : 'default';

  const billEnabled = !!table && occSel;
  const billColor = billEnabled ? 'var(--color-text)' : 'var(--color-text-tertiary)';
  const billStroke = billEnabled ? 'var(--color-primary)' : 'var(--color-text-tertiary)';
  const billCursor = billEnabled ? 'pointer' : 'default';

  const closeEnabled = !!table && occSel && hasClosePerm;
  const closeColor = closeEnabled ? 'var(--color-text)' : 'var(--color-text-tertiary)';
  const closeStroke = closeEnabled ? 'var(--color-primary)' : 'var(--color-text-tertiary)';
  const closeCursor = closeEnabled ? 'pointer' : 'default';

  const notesEnabled = !!table;
  const notesColor = notesEnabled ? 'var(--color-text)' : 'var(--color-text-tertiary)';
  const notesStroke = notesEnabled ? 'var(--color-primary)' : 'var(--color-text-tertiary)';
  const notesCursor = notesEnabled ? 'pointer' : 'default';

  const notesCountLabel = tableNote ? ' · 1' : '';
  const notesBtnBorder = tableNote ? 'var(--color-primary)' : 'var(--color-border-strong)';
  const notesBtnBg = tableNote ? 'var(--color-primary-subtle)' : 'var(--color-surface)';
  // Contained GST only — there is no service charge (removed, story 15-4).
  const gstStr = formatPrice(totals.gst);

  const startReady = !!table && (occSel || guests > 0);
  const startDisabled = !startReady;
  const startBg = startReady ? 'var(--color-primary)' : 'var(--color-surface-3)';
  const startColor = startReady ? '#fff' : 'var(--color-text-tertiary)';
  const startCursor = startReady ? 'pointer' : 'default';
  const startLabel = occSel ? 'Open order · add items' : (guests > 0 ? 'Start order · ' + guests + (guests === 1 ? ' guest' : ' guests') : 'Set guest count to start');

  const startOrder = () => {
    if (!table) return;
    if (occSel) {
      setScreen('order');
      setActiveSeat(1);
    } else if (guests > 0) {
      setScreen('order');
      setSeatsCount(guests);
      setActiveSeat(1);
    }
  };

  const billLines = cart.map((l) => ({
    qty: l.qty,
    name: l.name + (l.mods.length ? ' (' + l.mods.map((m) => m.label).join(', ') + ')' : ''),
    totalStr: formatPrice(lineTotal(l))
  }));

  const handleOpenNotes = () => {
    if (table) {
      setNotesOpen(true);
      setTableNoteDraft(tableNote);
    }
  };

  const handleSaveNotes = () => {
    setTableNote(tableNoteDraft.trim());
    setNotesOpen(false);
  };

  const handleOpenTransfer = () => {
    setTransferOpen(true);
    setTransferStep(1);
    setDestTableId(null);
    setTransferError(null);
  };

  // Reassigning an order's table has no backend equivalent (Order.tableId
  // is set at creation; there is no "move order" endpoint) — rather than
  // silently mutating the client cache as if it had happened, this is
  // honestly reported as unsupported.
  const handlePerformTransfer = () => {
    setTransferError("Table transfer isn't supported yet — this order stays on its original table.");
  };

  const handlePerformCloseTable = async () => {
    if (!table || !activeOrder) return;

    const finalStatus: 'completed' | 'cancelled' = closeReason === 'Cancelled' ? 'cancelled' : 'completed';
    setCloseError(null);
    const ok = await transitionOrderStatus(activeOrder.id, finalStatus);
    if (!ok) {
      setCloseError(orderActionError);
      return;
    }

    setCart([]);
    setGuests(0);
    setSeatsCount(0);
    setTableNote('');

    setCloseOpen(false);
    setCloseReason('');
  };

  const enquiryGroups = getGroupsFor('seat').map((g: any) => ({
    title: g.title,
    // Story 15-4 fix (independent review, 2026-08-19) — see cartGroups'
    // identical fix above for the full rationale. This grouping is always
    // by seat, so g.meta.seat is always defined here.
    totalStr: formatPrice(seatGrand(g.meta.seat)),
    lines: g.lines.map((l: TabletCartItem) => ({
      qty: l.qty,
      name: l.name,
      totalStr: formatPrice(lineTotal(l)),
      hasMods: l.mods.length > 0,
      modText: l.mods.map((m: any) => m.label).join(' · '),
      hasNote: !!l.note,
      note: l.note,
      sent: l.sent,
      unsent: !l.sent
    }))
  }));

  // Dynamic layout styling based on whether the component is running in the standalone tablet app
  // or embedded inside the main Admin Portal's Layout shell.
  const rootStyle: React.CSSProperties = standalone
    ? { width: '100vw', height: '100vh', position: 'fixed', inset: 0, zIndex: 50 }
    : { width: '100%', height: '100%', position: 'relative' };

  return (
    <div className="order-tablet-body" style={{ ...rootStyle, display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', fontFamily: "'Inter',system-ui,sans-serif", color: 'var(--color-text)', overflow: 'hidden', userSelect: 'none' }}>

      {/* ══ App header (Standalone Only) ══ */}
      {standalone && (
        <div style={{ height: '56px', flex: 'none', display: 'flex', alignItems: 'center', gap: '16px', padding: '0 16px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <svg width="103.2" height="24" viewBox="0 0 172 40" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Verdura" style={{ height: '24px' }}>
            <rect width="40" height="40" rx="9" fill="#16A34A"></rect>
            <path d="M20 28.5c-5.1-1.7-9.5-6.8-9.5-14.4a.9.9 0 0 1 .9-.9c3.1 0 6.1.8 8.6 3.1 2.5-2.3 5.5-3.1 8.6-3.1a.9.9 0 0 1 .9.9c0 7.6-4.4 12.7-9.5 14.4Z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"></path>
            <path d="M20 17.4V29" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"></path>
            <text x="52" y="27" fontFamily="Inter, sans-serif" fontSize="22" fontWeight="600" letterSpacing="-0.02em" fill="#111827">Verdura</text>
          </svg>
          <div style={{ width: '1px', height: '24px', background: 'var(--color-border)' }}></div>
          <div style={{ fontSize: '14px', fontWeight: '600', letterSpacing: '-0.01em' }}>Order Tablet</div>
          <div style={{ flex: '1' }}></div>
          <div style={{ display: 'flex', background: 'var(--color-surface-3)', borderRadius: '8px', padding: '3px', gap: '2px' }}>
            <button
              onClick={() => (staffElevated ? setMode('staff') : setElevatePinOpen(true))}
              style={{ border: 'none', cursor: 'pointer', padding: '6px 16px', borderRadius: '6px', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', background: seg(isStaff).bg, color: seg(isStaff).color, boxShadow: seg(isStaff).shadow }}
            >
              Staff mode
            </button>
            <button onClick={() => setMode('guest')} style={{ border: 'none', cursor: 'pointer', padding: '6px 16px', borderRadius: '6px', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', background: seg(!isStaff).bg, color: seg(!isStaff).color, boxShadow: seg(!isStaff).shadow }}>Guest mode</button>
          </div>
          <div style={{ flex: '1' }}></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: 'var(--color-success)', display: 'inline-block' }}></span>
            Kitchen open · avg <b style={{ color: 'var(--color-text)', fontWeight: '600' }}>14 min</b>
          </div>
          {staffElevated ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '12px', borderLeft: '1px solid var(--color-border)' }}>
              <div style={{ width: '30px', height: '30px', borderRadius: '999px', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600' }}>
                {(tabletDeviceAuth.staffName || '?').charAt(0)}
              </div>
              <div style={{ fontSize: '12px', lineHeight: '1.25' }}>
                <div style={{ fontWeight: '600' }}>{tabletDeviceAuth.staffName}</div>
                <div style={{ color: 'var(--color-text-secondary)' }}>{tabletDeviceAuth.staffRole}</div>
              </div>
              <button onClick={lockTablet} title="Lock — end staff session" style={{ border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '11.5px', fontWeight: '600', color: 'var(--color-text)' }}>
                Lock
              </button>
            </div>
          ) : (
            standalone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '12px', borderLeft: '1px solid var(--color-border)', fontSize: '11.5px', color: 'var(--color-text-tertiary)' }}>
                Restricted mode — customer/device only
              </div>
            )
          )}
        </div>
      )}

      {/* ══ Staff PIN elevation dialog ══ */}
      {elevatePinOpen && (
        <div onClick={() => setElevatePinOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => void elevateWithPin(e)} style={{ width: '320px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: 'var(--shadow-xl)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '15px', fontWeight: '600', textAlign: 'center' }}>Staff sign-in</div>
            <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', textAlign: 'center', margin: 0 }}>Enter your personal tablet PIN to elevate this session.</p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={elevatePin}
              onChange={(e) => setElevatePin(e.target.value)}
              placeholder="PIN"
              style={{ height: '46px', textAlign: 'center', fontSize: '18px', letterSpacing: '0.3em', border: '1px solid var(--color-border-strong)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
            {elevateError && <p style={{ color: 'var(--color-danger)', fontSize: '12px', textAlign: 'center', margin: 0 }}>{elevateError}</p>}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={() => setElevatePinOpen(false)} style={{ flex: 1, height: '42px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', color: 'var(--color-text)' }}>Cancel</button>
              <button type="submit" disabled={elevating || elevatePin.length === 0} style={{ flex: 1, height: '42px', border: 'none', background: 'var(--color-primary)', color: '#fff', borderRadius: '8px', cursor: elevating ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: '600' }}>
                {elevating ? 'Checking…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ══════════ SCREEN · FLOOR PLAN ══════════ */}
      {screen === 'floor' && (
        <div data-screen-label="A · Floor plan" style={{ flex: '1', display: 'flex', minHeight: '0' }}>
          <div style={{ flex: '1', display: 'flex', flexDirection: 'column', padding: '20px', minWidth: '0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <div style={{ fontSize: '18px', fontWeight: '600', letterSpacing: '-0.02em', color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                  {serviceMode === 'takeaway' ? 'Takeaway order' : 'Select a table'}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                  {serviceMode === 'takeaway' ? 'No table required' : 'Main dining room'}
                </div>
                {/* Story 15-13: dine-in/takeaway mode toggle -- the user must
                    choose before proceeding to table selection or the cart. */}
                <div role="group" aria-label="Service mode" style={{ display: 'flex', border: '1px solid var(--color-border-strong)', borderRadius: '8px', overflow: 'hidden', marginLeft: '4px', flexShrink: 0 }}>
                  <button
                    onClick={() => setServiceMode('dine_in')}
                    aria-pressed={serviceMode === 'dine_in'}
                    style={{ height: '36px', padding: '0 16px', border: 'none', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '600', cursor: 'pointer', background: serviceMode === 'dine_in' ? 'var(--color-primary)' : 'var(--color-surface)', color: serviceMode === 'dine_in' ? '#fff' : 'var(--color-text-secondary)' }}
                  >
                    Dine-in
                  </button>
                  <button
                    onClick={() => setServiceMode('takeaway')}
                    aria-pressed={serviceMode === 'takeaway'}
                    style={{ height: '36px', padding: '0 16px', border: 'none', borderLeft: '1px solid var(--color-border-strong)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '600', cursor: 'pointer', background: serviceMode === 'takeaway' ? 'var(--color-primary)' : 'var(--color-surface)', color: serviceMode === 'takeaway' ? '#fff' : 'var(--color-text-secondary)' }}
                  >
                    Takeaway
                  </button>
                </div>
                {serviceMode === 'dine_in' && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: '4px', flexShrink: 0 }}>
                  <button 
                    onClick={() => enquiryEnabled && setEnquiryOpen(true)} 
                    disabled={!enquiryEnabled}
                    style={{ height: '36px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '7px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: enquiryColor, cursor: enquiryCursor }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={enquiryStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.3-4.3 M11 8v3 M11 14h.01"></path></svg>
                    Enquiry
                  </button>
                  <button 
                    onClick={() => transferEnabled && handleOpenTransfer()} 
                    disabled={!transferEnabled}
                    style={{ height: '36px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '7px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: transferColor, cursor: transferCursor }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={transferStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 17H4M4 17l4 4M4 17l4-4M4 7h16M20 7l-4 4M20 7l-4-4" />
                    </svg>
                    Transfer Table
                  </button>
                  <button 
                    onClick={() => billEnabled && setBillOpen(true)} 
                    disabled={!billEnabled}
                    style={{ height: '36px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '7px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: billColor, cursor: billCursor }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={billStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z"></path></svg>
                    View bill
                  </button>
                  <button
                    onClick={() => closeEnabled && (setCloseError(null), setCloseOpen(true))}
                    disabled={!closeEnabled}
                    style={{ height: '36px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '7px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: closeColor, cursor: closeCursor }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={closeStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="15" y1="9" x2="9" y2="15"></line>
                      <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                    Close Table
                  </button>
                  <button 
                    onClick={handleOpenNotes} 
                    disabled={!notesEnabled}
                    style={{ height: '36px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '7px', border: `1px solid ${notesBtnBorder}`, borderRadius: '6px', background: notesBtnBg, fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: notesColor, cursor: notesCursor }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={notesStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>
                    Notes{notesCountLabel}
                  </button>
                </div>
                )}
              </div>
              {serviceMode === 'dine_in' && (
              <div style={{ display: 'flex', gap: '16px', fontSize: '11.5px', color: 'var(--color-text-secondary)', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--color-surface)', border: '1.5px solid var(--color-border-strong)', display: 'inline-block' }}></span>Available</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', borderRadius: '3px', background: '#FFB703', display: 'inline-block' }}></span>Occupied</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', borderRadius: '3px', background: '#8B5CF6', display: 'inline-block' }}></span>Reserved</span>
              </div>
              )}
            </div>
            {serviceMode === 'takeaway' ? (
              <div style={{ flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '14px', background: 'var(--color-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0"></path></svg>
                </div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--color-text)' }}>No table required for takeaway</div>
                <div style={{ fontSize: '12.5px', lineHeight: '1.5', maxWidth: '280px' }}>A stable takeaway reference is generated once the order is sent to the kitchen.</div>
                <button
                  onClick={handleStartTakeaway}
                  style={{ height: '52px', padding: '0 32px', border: 'none', borderRadius: '8px', background: 'var(--color-primary)', color: '#fff', fontFamily: 'inherit', fontSize: '14.5px', fontWeight: '600', cursor: 'pointer', boxShadow: 'var(--shadow-xs)' }}
                >
                  Start takeaway order
                </button>
              </div>
            ) : (
            <TableMap
              tables={tablesV}
              onBackgroundTap={() => {
                setTableId(null);
                setGuests(0);
                setCart([]);
                setSeatsCount(0);
              }}
            />
            )}
          </div>
          {serviceMode === 'dine_in' && (
          <div style={{ width: '340px', flex: 'none', background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', padding: '20px' }}>
            {!table && (
              <div style={{ flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'var(--color-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="22" height="22" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Verdura" style={{ opacity: 0.5 }}>
                    <rect width="40" height="40" rx="9" fill="#16A34A"></rect>
                    <path d="M11 13.5c0 7.2 4.2 12 9 13.6 4.8-1.6 9-6.4 9-13.6-3.2 0-6.2.9-9 3.5-2.8-2.6-5.8-3.5-9-3.5Z" fill="#fff" fillOpacity="0.16"></path>
                    <path d="M20 28.5c-5.1-1.7-9.5-6.8-9.5-14.4a.9.9 0 0 1 .9-.9c3.1 0 6.1.8 8.6 3.1 2.5-2.3 5.5-3.1 8.6-3.1a.9.9 0 0 1 .9.9c0 7.6-4.4 12.7-9.5 14.4Z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"></path>
                    <path d="M20 17.4V29" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"></path>
                  </svg>
                </div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-text)' }}>No table selected</div>
                <div style={{ fontSize: '12px', lineHeight: '1.45', maxWidth: '200px' }}>Tap an available table on the floor plan to start an order.</div>
              </div>
            )}
            {table && (
              <>
                <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Selected table</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', border: '1px solid var(--color-border)', borderRadius: '12px', background: 'var(--color-surface-2)' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: '600' }}>{table.tableNumber}</div>
                  <div style={{ lineHeight: '1.3' }}><div style={{ fontSize: '14px', fontWeight: '600' }}>Table {table.tableNumber}</div><div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Seats up to {table.capacity}</div></div>
                </div>
                {!occSel && (
                  <>
                    <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', margin: '20px 0 8px' }}>Guests</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <button onClick={() => setGuests(prev => Math.max(0, prev - 1))} style={{ width: '48px', height: '48px', borderRadius: '8px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', fontSize: '20px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'inherit' }}>−</button>
                      <div style={{ flex: 1, textAlign: 'center', fontSize: '24px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{guests > 0 ? guests : '—'}</div>
                      <button onClick={() => setGuests(prev => Math.min(table.capacity, prev + 1))} style={{ width: '48px', height: '48px', borderRadius: '8px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', fontSize: '20px', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'inherit' }}>+</button>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)', marginTop: '10px', lineHeight: '1.5' }}>A seat is created for each guest so items can be assigned per person.</div>
                  </>
                )}
                {occSel && (
                  <>
                    <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', margin: '20px 0 8px' }}>Open order</div>
                    <div style={{ padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: '12px', background: 'var(--color-surface-2)', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '9.5px', fontWeight: '600', padding: '2px 7px', borderRadius: '4px', background: '#FFB703', color: '#4A3200' }}>OCCUPIED</span>
                        <span style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>Seated {new Date(activeOrder.submittedAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: 'var(--color-text-secondary)' }}><span>Guests</span><span style={{ fontWeight: '600', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{guests}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: 'var(--color-text-secondary)' }}><span>Items sent</span><span style={{ fontWeight: '600', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{cartCount}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: 'var(--color-text-secondary)' }}><span>Total so far</span><span style={{ fontWeight: '600', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(totals.total)}</span></div>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)', marginTop: '10px', lineHeight: '1.5' }}>Use Enquiry to review the order, or open it to add items when guests request more.</div>
                  </>
                )}
                <div style={{ flex: '1' }}></div>
                <button onClick={startOrder} disabled={startDisabled} style={{ height: '52px', border: 'none', borderRadius: '8px', background: startBg, color: startColor, fontFamily: 'inherit', fontSize: '14.5px', fontWeight: '600', cursor: startCursor, boxShadow: 'var(--shadow-xs)' }}>{startLabel}</button>
              </>
            )}
          </div>
          )}
        </div>
      )}

      {/* ══ SCREEN · ORDER ══════════ */}
      {screen === 'order' && (
        <div data-screen-label="A · Order" style={{ flex: '1', display: 'flex', minHeight: '0', position: 'relative' }}>
          {/* left: rail + browse */}
          <div style={{ flex: '1', display: 'flex', flexDirection: 'column', minWidth: '0' }}>
            {/* context bar */}
            <div style={{ height: '52px', flex: 'none', display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <button onClick={() => setScreen('floor')} title="Back to table map" style={{ height: '36px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '7px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: 'var(--color-text)', cursor: 'pointer' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10"></path></svg>
                Home
              </button>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>
                {serviceMode === 'takeaway' ? 'Takeaway order' : `Table ${tableNumber}`}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                {serviceMode === 'takeaway' ? 'No table' : `${seatsCount} guests · Dine in`}
              </div>
              <div style={{ flex: '1' }}></div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {serviceMode === 'dine_in' && (
                <button onClick={() => setBillOpen(true)} style={{ height: '36px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '7px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: 'var(--color-text)', cursor: 'pointer' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z"></path></svg>
                  View bill
                </button>
                )}
                {serviceMode === 'dine_in' && (
                <button onClick={handleOpenNotes} style={{ height: '36px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '7px', border: `1px solid ${notesBtnBorder}`, borderRadius: '6px', background: notesBtnBg, fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: 'var(--color-text)', cursor: 'pointer' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>
                  Notes{notesCountLabel}
                </button>
                )}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search menu…" style={{ width: '200px', height: '36px', padding: '0 12px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '13px', color: 'var(--color-text)', outline: 'none' }} />
            </div>
            {/* seat strip -- dine-in only; takeaway has no seat-assignment
                concept (Story 15-13: seat assignment must not be mandatory
                or misleading for takeaway). */}
            {serviceMode === 'dine_in' && (
            <div style={{ height: '52px', flex: 'none', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', overflowX: 'auto' }}>
              <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', flex: 'none', marginRight: '2px' }}>Ordering for</div>
              {seatChips.map((s: any, idx: number) => (
                <button key={idx} onClick={s.onTap} style={{ flex: 'none', height: '34px', padding: '0 14px', display: 'flex', alignItems: 'center', gap: '7px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '600', background: s.bg, border: s.border, color: s.color, transition: 'background 150ms ease-out' }}>
                  {s.label}
                  {s.hasCount && (
                    <span style={{ minWidth: '18px', height: '18px', padding: '0 5px', borderRadius: '999px', background: s.badgeBg, color: s.badgeColor, fontSize: '10.5px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
                  )}
                </button>
              ))}
              <button onClick={() => { setSeatsCount(prev => prev + 1); setActiveSeat(seatsCount + 1); }} style={{ flex: 'none', height: '34px', padding: '0 14px', borderRadius: '999px', border: '1px dashed var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-secondary)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', cursor: 'pointer' }}>+ Seat</button>
            </div>
            )}
            <div style={{ flex: '1', display: 'flex', minHeight: '0' }}>
              {/* category rail */}
              <div style={{ width: '150px', flex: 'none', background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', overflowY: 'auto', padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {categoriesV.map((c: any) => (
                  <button key={c.id} onClick={c.onTap} style={{ height: '52px', flex: 'none', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12.5px', textAlign: 'left', padding: '0 12px', background: c.bg, color: c.color, fontWeight: c.weight, borderLeft: `3px solid ${c.accent}`, transition: 'background 150ms ease-out' }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={c.icon}></path></svg>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
              {/* item grid */}
              <div style={{ flex: '1', overflowY: 'auto', padding: '14px 16px', minWidth: '0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600' }}>{catTitle}</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>{itemsV.length} items</div>
                </div>
                {menuError && (
                  <div style={{ fontSize: '12px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '6px 10px', marginBottom: '10px' }}>
                    Couldn't load the menu: {menuError}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px' }}>
                  {itemsV.map((it: any) => {
                    const cardOpacity = it.isAvailable ? 1 : 0.52;
                    const cardCursor = it.isAvailable ? 'pointer' : 'not-allowed';
                    return (
                      <div key={it.id} onClick={it.onTap} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden', cursor: cardCursor, opacity: cardOpacity, boxShadow: 'var(--shadow-xs)', position: 'relative', transition: 'border-color 150ms ease-out, opacity 150ms ease-out' }}>
                        <MenuItemThumbnail src={it.imageUrl} alt={it.name} />
                        {it.popular && (
                          <span style={{ position: 'absolute', top: '6px', left: '6px', fontSize: '9px', fontWeight: '600', letterSpacing: '0.04em', padding: '2px 7px', borderRadius: '4px', background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid var(--color-warning-border)' }}>POPULAR</span>
                        )}
                        <div style={{ padding: '9px 11px 10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                            <div style={{ fontSize: '12.5px', fontWeight: '600', lineHeight: 1.25 }}>{it.name}</div>
                            <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{it.priceStr}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px' }}>
                            <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{it.time} min</span>
                            {it.tagList.map((tg: any, tIdx: number) => (
                              <span key={tIdx} style={{ fontSize: '9px', fontWeight: '600', padding: '1px 5px', borderRadius: '4px', background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid var(--color-success-border)' }}>{tg}</span>
                            ))}
                            <div style={{ flex: '1' }}></div>
                            {it.isAvailable ? (
                              <span style={{ width: '22px', height: '22px', borderRadius: '6px', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '600' }}>{it.plusGlyph}</span>
                            ) : (
                              <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--color-text-tertiary)', background: 'var(--color-surface-3)', padding: '2px 6px', borderRadius: '4px' }}>OUT</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* right: order ticket */}
          <div style={{ width: '340px', flex: 'none', background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', minHeight: '0' }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>
                  {serviceMode === 'takeaway' ? 'Order · Takeaway' : `Order · Table ${tableNumber}`}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{cartCount} items</div>
              </div>
              <div style={{ display: 'flex', background: 'var(--color-surface-3)', borderRadius: '6px', padding: '2px', gap: '2px', marginTop: '10px' }}>
                {groupTabs.map((g: any, idx: number) => (
                  <button key={idx} onClick={g.onTap} style={{ flex: '1', border: 'none', cursor: 'pointer', padding: '5px 0', borderRadius: '5px', fontFamily: 'inherit', fontSize: '11px', fontWeight: '500', background: g.bg, color: g.color, boxShadow: g.shadow }}>{g.label}</button>
                ))}
              </div>
            </div>
            <div style={{ flex: '1', overflowY: 'auto', padding: '6px 16px 10px' }}>
              {cartEmpty && (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--color-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="20" height="20" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Verdura" style={{ opacity: 0.5 }}>
                      <rect width="40" height="40" rx="9" fill="#16A34A"></rect>
                      <path d="M11 13.5c0 7.2 4.2 12 9 13.6 4.8-1.6 9-6.4 9-13.6-3.2 0-6.2.9-9 3.5-2.8-2.6-5.8-3.5-9-3.5Z" fill="#fff" fillOpacity="0.16"></path>
                      <path d="M20 28.5c-5.1-1.7-9.5-6.8-9.5-14.4a.9.9 0 0 1 .9-.9c3.1 0 6.1.8 8.6 3.1 2.5-2.3 5.5-3.1 8.6-3.1a.9.9 0 0 1 .9.9c0 7.6-4.4 12.7-9.5 14.4Z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"></path>
                      <path d="M20 17.4V29" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"></path>
                    </svg>
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: '600', color: 'var(--color-text)' }}>No items yet</div>
                  <div style={{ fontSize: '11.5px', lineHeight: '1.45', maxWidth: '190px' }}>Pick a seat, then tap menu items to add them.</div>
                </div>
              )}
              {cartGroups.map((grp: any, idx: number) => (
                <div key={idx} style={{ paddingTop: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 0' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{grp.title}</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{grp.totalStr}</div>
                  </div>
                  {grp.lines.map((ln: any) => (
                    <div key={ln.key} style={{ display: 'flex', gap: '8px', padding: '7px 0', borderBottom: '1px solid var(--color-border)', opacity: ln.opacity }}>
                      <div style={{ flex: '1', minWidth: '0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <div style={{ fontSize: '12.5px', fontWeight: 500, lineHeight: 1.3 }}>{ln.name}</div>
                          <div style={{ fontSize: '12.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{ln.totalStr}</div>
                        </div>
                        {ln.hasMods && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{ln.modText}</div>}
                        {ln.hasNote && <div style={{ fontSize: '11px', color: 'var(--color-warning)', lineHeight: 1.4 }}>“{ln.note}”</div>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' }}>
                          {ln.sent && (
                            <span style={{ fontSize: '9.5px', fontWeight: '600', padding: '2px 7px', borderRadius: '4px', background: 'var(--color-info-bg)', color: 'var(--color-info)', border: '1px solid var(--color-info-border)' }}>SENT</span>
                          )}
                          {ln.showSeatTag && (
                            <span style={{ fontSize: '9.5px', fontWeight: '600', padding: '2px 7px', borderRadius: '4px', background: 'var(--color-surface-3)', color: 'var(--color-text-secondary)' }}>{ln.seatTag}</span>
                          )}
                          <div style={{ flex: '1' }}></div>
                          {ln.editable && (
                            <>
                              <button onClick={ln.onDec} style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', color: 'var(--color-text)', lineHeight: 1 }}>−</button>
                              <span style={{ minWidth: '18px', textAlign: 'center', fontSize: '12.5px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{ln.qty}</span>
                              <button onClick={ln.onInc} style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', color: 'var(--color-text)', lineHeight: 1 }}>+</button>
                            </>
                          )}
                          {ln.sent && (
                            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>×{ln.qty}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '10px 16px 14px', background: 'var(--color-surface)' }}>
              {realTablesError && (
                <div style={{ fontSize: '12px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '6px 10px', marginBottom: '8px' }}>
                  Couldn't load real tables: {realTablesError}
                </div>
              )}
              {orderActionError && (
                <div style={{ fontSize: '12px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '6px 10px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span>{orderActionError}</span>
                  <button onClick={() => setOrderActionError(null)} style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-secondary)', padding: '2px 0' }}><span>Subtotal</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPrice(totals.sub)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-secondary)', padding: '2px 0' }}><span>GST included</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPrice(totals.gst)}</span></div>
              {taxConfigUnavailable ? (
                <div style={{ fontSize: '11.5px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '6px 10px', margin: '4px 0' }}>Unable to calculate a safe total for this venue's tax configuration. Payment is disabled until this is resolved.</div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '600', padding: '6px 0 2px' }}><span>Total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPrice(totals.total)}</span></div>
              )}
              <div style={{ fontSize: '10.5px', color: 'var(--color-text-tertiary)', padding: '0 0 10px' }}>Provisional — pending Idealpos confirmation</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {isStaff ? (
                  // The single primary staff action: submit once, then land
                  // on the shared order-status/dispatch screen below. No
                  // payment step exists before or after this.
                  (() => {
                    const disabledNow = cartEmpty || taxConfigUnavailable || !unsent || isSubmittingOrder;
                    return (
                      <button onClick={() => void handleSendToKitchen()} disabled={disabledNow} style={{ flex: '1', height: '46px', border: 'none', borderRadius: '8px', background: disabledNow ? 'var(--color-surface-3)' : 'var(--color-primary)', color: disabledNow ? 'var(--color-text-tertiary)' : '#fff', fontFamily: 'inherit', fontSize: '13px', fontWeight: '600', cursor: disabledNow ? 'default' : 'pointer', boxShadow: 'var(--shadow-xs)' }}>
                        {taxConfigUnavailable ? 'Totals unavailable' : isSubmittingOrder ? 'Sending…' : !unsent ? 'Sent ✓' : 'Send to Kitchen'}
                      </button>
                    );
                  })()
                ) : (
                  // Guest/customer-mode: this only navigates to the Review
                  // Order screen -- it never submits and never processes
                  // payment. The actual "Send to Kitchen" action lives on
                  // that screen (screen === 'pay', createdOrderRef == null
                  // branch, below).
                  <button onClick={() => !cartEmpty && !taxConfigUnavailable && setScreen('pay')} disabled={cartEmpty || taxConfigUnavailable} style={{ flex: 1.4, height: '46px', border: 'none', borderRadius: '8px', background: (cartEmpty || taxConfigUnavailable) ? 'var(--color-surface-3)' : 'var(--color-primary)', color: (cartEmpty || taxConfigUnavailable) ? 'var(--color-text-tertiary)' : '#fff', fontFamily: 'inherit', fontSize: '13px', fontWeight: '600', cursor: (cartEmpty || taxConfigUnavailable) ? 'default' : 'pointer', boxShadow: 'var(--shadow-xs)' }}>
                    {taxConfigUnavailable ? 'Totals unavailable' : 'Review order'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ══ Modifier slide-over ══ */}
          {slideVals.slideOpen && (
            <>
              <div onClick={() => setSlide(null)} style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)' }}></div>
              <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '372px', background: 'var(--color-surface)', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column', animation: 'vslidein 200ms ease-out', zIndex: 100 }}>
                <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '16px', fontWeight: '600', letterSpacing: '-0.01em' }}>{slideVals.slideName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '3px', lineHeight: 1.45 }}>{slideVals.slideDesc}</div>
                  </div>
                  <button onClick={() => setSlide(null)} style={{ width: '34px', height: '34px', flex: 'none', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: '14px', color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Assign to</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                    {slideVals.slideSeats.map((ss: any, idx: number) => (
                      <button key={idx} onClick={ss.onTap} style={{ height: '32px', padding: '0 12px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '11.5px', fontWeight: 600, background: ss.bg, border: ss.border, color: ss.color }}>{ss.label}</button>
                    ))}
                  </div>
                  {slideVals.slideGroups.map((mg: any, grpIdx: number) => (
                    <div key={grpIdx} style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 600 }}>{mg.name}</div>
                        <div style={{ fontSize: '10.5px', color: 'var(--color-text-tertiary)' }}>{mg.hint}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {mg.options.map((op: any, opIdx: number) => (
                          <button key={opIdx} onClick={op.onTap} disabled={op.unavailable}
                            style={{ height: '42px', display: 'flex', alignItems: 'center', gap: '10px', padding: '0 12px', borderRadius: '8px', cursor: op.unavailable ? 'not-allowed' : 'pointer', fontFamily: 'inherit', textAlign: 'left', background: op.bg, border: op.border, opacity: op.unavailable ? 0.55 : 1, transition: 'background 150ms ease-out' }}>
                            <span style={{ width: '17px', height: '17px', flex: 'none', borderRadius: op.markRadius, border: op.markBorder, background: op.markBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '10px', fontWeight: 700 }}>{op.markGlyph}</span>
                            <span style={{ flex: 1, fontSize: '12.5px', fontWeight: 500, color: 'var(--color-text)' }}>{op.label}</span>
                            <span style={{ fontSize: '11.5px', color: op.unavailable ? 'var(--color-danger)' : 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{op.deltaStr}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {slideVals.slideValidationMessages.length > 0 && (
                    <div style={{ fontSize: '11.5px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '8px 10px', marginBottom: '14px' }}>
                      {slideVals.slideValidationMessages.map((msg, i) => <div key={i}>{msg}</div>)}
                    </div>
                  )}
                  <div style={{ fontSize: '12.5px', fontWeight: '600', marginBottom: '8px' }}>Notes for kitchen</div>
                  <input value={slideVals.slideNote} onChange={(e) => setSlide(prev => prev ? { ...prev, note: e.target.value } : null)} placeholder="e.g. no onion, sauce on the side" style={{ width: '100%', boxSizing: 'border-box', height: '40px', padding: '0 12px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', color: 'var(--color-text)', outline: 'none' }} />
                </div>
                <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '12px 18px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button onClick={() => setSlide(prev => prev ? { ...prev, qty: Math.max(1, prev.qty - 1) } : null)} style={{ width: '44px', height: '46px', borderRadius: '8px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', fontSize: '17px', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}>−</button>
                  <span style={{ minWidth: '24px', textAlign: 'center', fontSize: '16px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{slideVals.slideQty}</span>
                  <button onClick={() => setSlide(prev => prev ? { ...prev, qty: prev.qty + 1 } : null)} style={{ width: '44px', height: '46px', borderRadius: '8px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', fontSize: '17px', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' }}>+</button>
                  <button onClick={handleConfirmSlide} disabled={!slideVals.slideValid}
                    style={{ flex: 1, height: '46px', border: 'none', borderRadius: '8px', background: slideVals.slideValid ? 'var(--color-primary)' : 'var(--color-surface-3)', color: slideVals.slideValid ? '#fff' : 'var(--color-text-secondary)', fontFamily: 'inherit', fontSize: '13.5px', fontWeight: '600', cursor: slideVals.slideValid ? 'pointer' : 'not-allowed', boxShadow: 'var(--shadow-xs)' }}>
                    {slideVals.slideValid ? `Add ${slideVals.slideQty} · ${slideVals.slideTotalStr}` : 'Complete required selections'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══ SCREEN · PAYMENT ══════════ */}
      {screen === 'pay' && (
        <div data-screen-label={createdOrderRef ? 'A · Order Status' : 'A · Review Order'} style={{ flex: '1', display: 'flex', minHeight: '0' }}>
          <div style={{ flex: '1', display: 'flex', flexDirection: 'column', minWidth: '0', padding: '20px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              {/* Post-submission: a full reset (table/cart/filters/idempotency
                  key) -- the order is already placed, so there is nothing to
                  keep editing. Pre-submission: just navigate back to keep
                  editing the same cart. */}
              <button onClick={() => (createdOrderRef ? handleReset() : setScreen('order'))} style={{ height: '36px', padding: '0 12px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '500', color: 'var(--color-text)', cursor: 'pointer' }}>
                {createdOrderRef ? '‹ Back to floor plan' : '‹ Back to order'}
              </button>
              <div style={{ fontSize: '18px', fontWeight: '600', letterSpacing: '-0.02em' }}>
                {createdOrderRef ? 'Order Status' : 'Review Order'} ·{' '}
                {serviceMode === 'takeaway'
                  ? (createdTakeawayReference ? `Takeaway ${createdTakeawayReference}` : 'Takeaway')
                  : `Table ${tableNumber}`}
              </div>
            </div>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: 'var(--shadow-xs)', padding: '6px 18px 12px' }}>
              {reviewGroups.map((pg: any, idx: number) => (
                <div key={idx} style={{ paddingTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{pg.title}</div>
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{pg.totalStr}</div>
                  </div>
                  {pg.lines.map((pl: any, plIdx: number) => (
                    <div key={plIdx} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12.5px', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <span style={{ color: 'var(--color-text)' }}><b style={{ fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{pl.qty}×</b> {pl.name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>{pl.totalStr}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ width: '340px', flex: 'none', background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', padding: '20px', overflowY: 'auto' }}>
            <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Order total</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: 'var(--color-text-secondary)', padding: '2px 0' }}><span>Subtotal</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPrice(totals.sub)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: 'var(--color-text-secondary)', padding: '2px 0' }}><span>GST included</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPrice(totals.gst)}</span></div>
            {taxConfigUnavailable ? (
              <div style={{ fontSize: '11.5px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '8px 10px', margin: '4px 0' }}>Unable to calculate a safe total for this venue's tax configuration. Sending to the kitchen is disabled until this is resolved.</div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '17px', fontWeight: '600', padding: '8px 0 2px' }}><span>Total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPrice(totals.total)}</span></div>
            )}
            <div style={{ fontSize: '10.5px', color: 'var(--color-text-tertiary)', padding: '0 0 8px' }}>Provisional — pending Idealpos confirmation</div>
            <div style={{ fontSize: '10.5px', color: 'var(--color-text-tertiary)', padding: '0 0 14px', borderBottom: '1px solid var(--color-border)' }}>Payment is completed separately through IdealPOS/EFTPOS.</div>

            {createdOrderRef ? (
              <>
                {orderActionError && (
                  <div style={{ fontSize: '12px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '8px 10px', margin: '12px 0' }}>
                    {orderActionError}
                  </div>
                )}
                {createdOrderRef && (
                  <div style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)', padding: '10px 0 2px', fontFamily: "'JetBrains Mono',monospace" }}>
                    Order {createdOrderRef} ·{' '}
                    {serviceMode === 'takeaway'
                      ? (createdTakeawayReference ? `Takeaway ${createdTakeawayReference}` : 'Takeaway')
                      : `Table ${tableNumber}`}
                  </div>
                )}

                {/* Truthful Idealpos delivery status. Every branch here
                    reflects a real, polled POSSyncRecord.status value from
                    the chosen IdealposOrderDispatcherService lineage -- never
                    a client-side guess about what Idealpos is doing. No
                    authoritative-total/discrepancy comparison is shown here:
                    that richer reconciliation model does not exist on this
                    integration branch's chosen backend (see the
                    reconciliation decision record) -- an unrecognized status
                    string always renders as "needs attention", never
                    silently as success. */}
                {createdOrderRef && (
                  <div style={{ margin: '12px 0', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <div style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>Idealpos status</div>
                    {posSyncLoadError ? (
                      <div style={{ color: 'var(--color-danger)' }}>{posSyncLoadError}</div>
                    ) : !posSyncView ? (
                      <div style={{ color: 'var(--color-text-tertiary)' }}>Checking…</div>
                    ) : (
                      <>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                          {(
                            {
                              not_synced: 'Not yet sent to Idealpos',
                              queued_for_connector: 'Submitting to Idealpos…',
                              submitted_awaiting_confirmation: 'Sent — awaiting native confirmation',
                              synced: 'Idealpos confirmed',
                              failed: 'Idealpos delivery failed — needs attention',
                              not_applicable: 'No Idealpos integration configured for this venue',
                              unsupported: 'This venue’s POS adapter is not yet supported',
                            } as Record<string, string>
                          )[posSyncView.status] ?? `Unrecognized state (${posSyncView.status}) — treat as needing attention`}
                        </div>
                        {posSyncView.errorMessage && (
                          <div style={{ color: 'var(--color-danger)', marginTop: '4px' }}>{posSyncView.errorMessage}</div>
                        )}
                        {posSyncView.retryExhaustedAt && (
                          <div style={{ color: 'var(--color-danger)', marginTop: '4px' }}>Retries exhausted — requires manual review.</div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* KOT status: real, polled PrinterJob/ConnectorCommand
                    state via GET /admin/orders/:id/print-jobs -- same
                    closed-allow-list technique as the Idealpos panel above;
                    an unrecognized status is always treated as needing
                    attention, never silently "OK". */}
                {createdOrderRef && (
                  <div style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <div style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>Kitchen ticket (KOT) status</div>
                    {printJobsLoadError ? (
                      <div style={{ color: 'var(--color-danger)' }}>{printJobsLoadError}</div>
                    ) : !printJobsView ? (
                      <div style={{ color: 'var(--color-text-tertiary)' }}>Checking…</div>
                    ) : printJobsView.length === 0 ? (
                      <div style={{ color: 'var(--color-text-tertiary)' }}>
                        {posSyncView && posSyncView.status !== 'not_applicable' && posSyncView.status !== 'unsupported'
                          ? // This venue is on a real POS integration -- Verdura
                            // deliberately never queues its own PrinterJob here
                            // (see orders.service.ts's persistOrder), since that
                            // POS's own existing kitchen-ticket workflow is the
                            // one that fires once the order reaches it (see the
                            // Idealpos status panel above). No Verdura-native
                            // print job existing is correct, not a gap.
                            'Kitchen ticket is produced by IdealPOS once it confirms this order — see Idealpos status above.'
                          : 'No printer configured for this venue.'}
                      </div>
                    ) : (
                      printJobsView.map((job) => (
                        <div key={job.id} style={{ padding: '2px 0' }}>
                          {(
                            {
                              queued: 'Queued',
                              accepted: 'Queued',
                              dispatching: 'Queued',
                              connector_dispatched: 'Sent to kitchen printer…',
                              delivered: 'Printed',
                              manual: 'Needs manual reprint',
                              uncertain: 'Uncertain — may need reprint',
                              failed: 'Failed to print',
                              cancelled: 'Cancelled',
                              printing: 'Sent to kitchen printer…',
                            } as Record<string, string>
                          )[job.status] ?? `Unrecognized state (${job.status}) — treat as needing attention`}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* KDS status: no delivery-ack channel exists from the
                    Kitchen Display back to the server (confirmed this
                    session) -- this reports only what Verdura itself did
                    (the durable order write + WebSocket push, which is what
                    createdOrderRef being set means already succeeded), never
                    a fabricated "published"/"delivered" claim. */}
                {createdOrderRef && (
                  <div style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <div style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>Kitchen display (KDS) status</div>
                    <div style={{ fontWeight: '600' }}>Order sent to kitchen display</div>
                    <div style={{ color: 'var(--color-text-tertiary)' }}>(delivery confirmation not available)</div>
                  </div>
                )}
              </>
            ) : (
              // Not yet submitted: the sole primary action is Send to
              // Kitchen. There is no payment step here or after it -- this
              // action durably creates the order plus its Idealpos/KDS/KOT
              // delivery intents in one submission (see submitOrderToKitchen).
              <>
                {orderActionError && (
                  <div style={{ fontSize: '12px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '8px 10px', margin: '12px 0' }}>
                    {orderActionError}
                  </div>
                )}
                <div style={{ flex: '1' }}></div>
                <button
                  onClick={() => void handleGuestSendToKitchen()}
                  disabled={isSubmittingOrder || taxConfigUnavailable || cartEmpty}
                  style={{
                    height: '54px',
                    border: 'none',
                    borderRadius: '8px',
                    background: (isSubmittingOrder || taxConfigUnavailable || cartEmpty) ? 'var(--color-surface-3)' : 'var(--color-primary)',
                    color: (isSubmittingOrder || taxConfigUnavailable || cartEmpty) ? 'var(--color-text-tertiary)' : '#fff',
                    fontFamily: 'inherit',
                    fontSize: '14.5px',
                    fontWeight: '600',
                    cursor: (isSubmittingOrder || taxConfigUnavailable || cartEmpty) ? 'default' : 'pointer',
                    boxShadow: 'var(--shadow-xs)',
                    marginTop: '16px',
                  }}
                >
                  {taxConfigUnavailable ? 'Totals unavailable' : isSubmittingOrder ? 'Sending…' : 'Send to Kitchen'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ Enquiry dialog ══ */}
      {enquiryOpen && (
        <div onClick={() => setEnquiryOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '560px', maxHeight: '640px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: '600', letterSpacing: '-0.01em' }}>Order enquiry · Table {tableNumber}</div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{seatsCount} guests · Dine in · {cartCount} items · Server Chowdhury</div>
              </div>
              <button onClick={() => setEnquiryOpen(false)} style={{ width: '34px', height: '34px', flex: 'none', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: '14px', color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 12px' }}>
              {cartEmpty && (
                <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '12.5px' }}>No items on this table yet.</div>
              )}
              {enquiryGroups.map((eg: any, idx: number) => (
                <div key={idx} style={{ paddingTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: '4px' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{eg.title}</div>
                    <div style={{ fontSize: '11px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{eg.totalStr}</div>
                  </div>
                  {eg.lines.map((el: any, lineIdx: number) => (
                    <div key={lineIdx} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', fontSize: '12.5px', padding: '5px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <span style={{ fontWeight: '600', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{el.qty}×</span>
                      <span style={{ flex: 1, minWidth: '0' }}>
                        {el.name}
                        {el.hasMods && <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-secondary)' }}>{el.modText}</span>}
                        {el.hasNote && <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-warning)' }}>“{el.note}”</span>}
                      </span>
                      {el.sent && <span style={{ fontSize: '9.5px', fontWeight: '600', padding: '2px 7px', borderRadius: '4px', background: 'var(--color-info-bg)', color: 'var(--color-info)', border: '1px solid var(--color-info-border)', flex: 'none' }}>SENT</span>}
                      {!el.sent && <span style={{ fontSize: '9.5px', fontWeight: '600', padding: '2px 7px', borderRadius: '4px', background: 'var(--color-surface-3)', color: 'var(--color-text-secondary)', flex: 'none' }}>PENDING</span>}
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, flex: 'none' }}>{el.totalStr}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-surface-2)' }}>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Subtotal {formatPrice(totals.sub)} · GST included {gstStr}</div>
              <div style={{ fontSize: '15px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>Total {formatPrice(totals.total)} <span style={{ fontSize: '10.5px', fontWeight: 400, color: 'var(--color-text-tertiary)' }}>(provisional)</span></div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Bill preview dialog ══ */}
      {/* Read-only on-screen summary only. Verdura's Order Tablet does not
          drive a physical printer — that was previously fabricated here
          (a fake "Print bill" action that just set a timeout and claimed
          "Sent to printer ✓" with no backend call at all, alongside a
          hardcoded "ORD-4821" placeholder that never reflected the real
          order). Printing a real bill/receipt is entirely IdealPOS's
          responsibility; this dialog never claims to have done it. */}
      {billOpen && (
        <div onClick={() => setBillOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '400px', maxHeight: '660px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 'auto' }}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, fontSize: '16px', fontWeight: '600', letterSpacing: '-0.01em' }}>Bill</div>
              <button onClick={() => setBillOpen(false)} style={{ width: '34px', height: '34px', flex: 'none', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: '14px', color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px', fontFamily: "'JetBrains Mono',monospace", fontSize: '11px', lineHeight: 1.7, color: 'var(--color-text)', background: 'var(--color-surface-2)' }}>
                <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                  {serviceMode === 'takeaway'
                    ? `Takeaway${createdTakeawayReference ? ` · ${createdTakeawayReference}` : ''}`
                    : `Table ${tableNumber} · ${seatsCount} guests`}
                  {createdOrderRef ? ` · ${createdOrderRef}` : ''}
                </div>
                <div style={{ borderTop: '1px dashed var(--color-border-strong)', margin: '10px 0' }}></div>
                {billLines.map((bl: any, idx: number) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><span>{bl.qty}× {bl.name}</span><span style={{ flex: 'none' }}>{bl.totalStr}</span></div>
                ))}
                <div style={{ borderTop: '1px dashed var(--color-border-strong)', margin: '10px 0' }}></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatPrice(totals.sub)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>GST included</span><span>{formatPrice(totals.gst)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '12px', marginTop: '4px' }}><span>TOTAL (provisional)</span><span>{formatPrice(totals.total)}</span></div>
              </div>
            </div>
            <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '12px 20px', display: 'flex', gap: '10px' }}>
              <button onClick={() => setBillOpen(false)} style={{ flex: 1, height: '44px', borderRadius: '8px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '13px', fontWeight: '600', color: 'var(--color-text)', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Notes dialog ══ */}
      {notesOpen && (
        <div onClick={() => setNotesOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '440px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: '600', letterSpacing: '-0.01em' }}>Table notes · Table {tableNumber}</div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Comments and special instructions for this table's order</div>
              </div>
              <button onClick={() => setNotesOpen(false)} style={{ width: '34px', height: '34px', flex: 'none', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: '14px', color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}>✕</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <textarea value={tableNoteDraft} onChange={(e) => setTableNoteDraft(e.target.value)} rows={4} placeholder="e.g. Guest allergic to nuts · birthday at seat 3 · split payment expected" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--color-border-strong)', borderRadius: '6px', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '12.5px', lineHeight: 1.5, color: 'var(--color-text)', outline: 'none', resize: 'none' }}></textarea>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>Notes are visible to staff and printed on kitchen tickets. Per-item notes can be added from each item's options panel.</div>
            </div>
            <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '12px 20px', display: 'flex', gap: '10px' }}>
              <button onClick={() => setNotesOpen(false)} style={{ flex: 1, height: '44px', borderRadius: '8px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '13px', fontWeight: '600', color: 'var(--color-text)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSaveNotes} style={{ flex: 1.4, height: '44px', border: 'none', borderRadius: '8px', background: 'var(--color-primary)', color: '#fff', fontFamily: 'inherit', fontSize: '13px', fontWeight: '600', cursor: 'pointer', boxShadow: 'var(--shadow-xs)' }}>Save note</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Transfer Table dialog ══ */}
      {transferOpen && (
        <div onClick={() => setTransferOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '480px', maxHeight: '600px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: '600', letterSpacing: '-0.01em' }}>{transferStep === 1 ? 'Transfer Table' : 'Transfer Order'}</div>
                {transferStep === 1 && (
                  <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    Current Table: <b>{tableId}</b>
                  </div>
                )}
              </div>
              <button onClick={() => setTransferOpen(false)} style={{ width: '34px', height: '34px', flex: 'none', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: '14px', color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}>✕</button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {transferError && (
                <div style={{ padding: '10px 12px', background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: '6px', fontSize: '12.5px', fontWeight: '500', marginBottom: '14px' }}>
                  {transferError}
                </div>
              )}
              
              {transferStep === 1 ? (
                <>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-text)', marginBottom: '8px' }}>Select destination table</div>
                  {TABLE_LAYOUTS.filter((tb) => tb.id !== tableId && !getActiveOrderForTable(tb.id.slice(1)) && !isTableReserved(tb.id.slice(1))).length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '12.5px' }}>
                      No available tables to transfer to.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                      {TABLE_LAYOUTS.filter((tb) => tb.id !== tableId && !getActiveOrderForTable(tb.id.slice(1)) && !isTableReserved(tb.id.slice(1))).map((tb) => (
                        <button
                          key={tb.id}
                          onClick={() => {
                            setDestTableId(tb.id);
                            setTransferStep(2);
                            setTransferError(null);
                          }}
                          style={{
                            padding: '12px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border-strong)',
                            background: 'var(--color-surface)',
                            fontFamily: 'inherit',
                            fontSize: '13px',
                            fontWeight: '600',
                            color: 'var(--color-text)',
                            cursor: 'pointer',
                            textAlign: 'center',
                            transition: 'all 150ms ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-primary)';
                            e.currentTarget.style.background = 'var(--color-primary-subtle)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-border-strong)';
                            e.currentTarget.style.background = 'var(--color-surface)';
                          }}
                        >
                          <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--color-primary)', marginBottom: '2px' }}>{tb.id}</div>
                          <div style={{ fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>{tb.seats} seats</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '10px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px', justifyContent: 'center', width: '100%' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</div>
                      <div style={{ width: '64px', height: '64px', borderRadius: '12px', background: '#FFB703', color: '#4A3200', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '700' }}>{tableId}</div>
                    </div>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</div>
                      <div style={{ width: '64px', height: '64px', borderRadius: '12px', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '700', border: '1.5px dashed var(--color-primary)' }}>{destTableId}</div>
                    </div>
                  </div>
                  
                  <div style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px 16px', background: 'var(--color-surface-2)', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: 'var(--color-text)' }}>This will move:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {['Order', 'Guests', 'Notes', 'Kitchen status', 'Running bill'].map((item) => (
                        <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--color-text-secondary)' }}>
                          <span style={{ color: 'var(--color-success)', fontWeight: 'bold' }}>✓</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '12px 20px', display: 'flex', gap: '10px' }}>
              <button 
                onClick={() => {
                  if (transferStep === 2) {
                    setTransferStep(1);
                    setDestTableId(null);
                  } else {
                    setTransferOpen(false);
                  }
                }} 
                style={{ flex: 1, height: '44px', borderRadius: '8px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '13.5px', fontWeight: '600', color: 'var(--color-text)', cursor: 'pointer' }}
              >
                {transferStep === 2 ? 'Back' : 'Cancel'}
              </button>
              {transferStep === 2 ? (
                <button 
                  onClick={handlePerformTransfer} 
                  style={{ flex: 1.4, height: '44px', border: 'none', borderRadius: '8px', background: 'var(--color-primary)', color: '#fff', fontFamily: 'inherit', fontSize: '13.5px', fontWeight: '600', cursor: 'pointer', boxShadow: 'var(--shadow-xs)' }}
                >
                  Transfer
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ══ Close Table dialog ══ */}
      {closeOpen && (
        <div onClick={() => setCloseOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '420px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: '600', letterSpacing: '-0.01em' }}>Close Table</div>
                <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                  Force release <b>{tableId}</b>
                </div>
              </div>
              <button onClick={() => setCloseOpen(false)} style={{ width: '34px', height: '34px', flex: 'none', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: '14px', color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}>✕</button>
            </div>
            
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: '1.5', marginBottom: '14px' }}>
                This will close the current table session and mark the table as <b>Available</b>.<br />
                The completed order will remain in history.
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '4px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: '600', color: 'var(--color-text-secondary)' }}>Reason</div>
                {[
                  'Paid externally',
                  'Complimentary',
                  'Cancelled',
                  'Manager Override',
                  'Other'
                ].map((r) => {
                  const isSelected = closeReason === r;
                  return (
                    <button
                      key={r}
                      onClick={() => setCloseReason(r)}
                      style={{
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '0 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        background: isSelected ? 'var(--color-primary-subtle)' : 'var(--color-surface)',
                        border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--color-border-strong)',
                        transition: 'all 150ms ease'
                      }}
                    >
                      <span style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '999px',
                        border: isSelected ? '5px solid var(--color-primary)' : '1.5px solid var(--color-border-strong)',
                        background: '#fff',
                        boxSizing: 'border-box',
                        flex: 'none'
                      }}></span>
                      <span style={{ fontSize: '12.5px', fontWeight: '500', color: 'var(--color-text)' }}>{r}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            
            {closeError && (
              <div style={{ margin: '0 20px 8px', fontSize: '12px', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: '6px', padding: '8px 10px' }}>
                {closeError}
              </div>
            )}
            <div style={{ flex: 'none', borderTop: '1px solid var(--color-border)', padding: '12px 20px', display: 'flex', gap: '10px' }}>
              <button onClick={() => setCloseOpen(false)} style={{ flex: 1, height: '44px', borderRadius: '8px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', fontFamily: 'inherit', fontSize: '13.5px', fontWeight: '600', color: 'var(--color-text)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => void handlePerformCloseTable()} disabled={isSubmittingOrder} style={{ flex: 1.4, height: '44px', border: 'none', borderRadius: '8px', background: isSubmittingOrder ? 'var(--color-surface-3)' : '#DC2626', color: '#fff', fontFamily: 'inherit', fontSize: '13.5px', fontWeight: '600', cursor: isSubmittingOrder ? 'default' : 'pointer', boxShadow: 'var(--shadow-xs)' }}>
                {isSubmittingOrder ? 'Closing…' : 'Close Table'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

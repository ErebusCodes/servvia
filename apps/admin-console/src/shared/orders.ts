import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { compareMenuItemsAlphabetically } from './menu/menuData';
import { useAuthStore } from '../store/auth.store';
import { useKdsDeviceAuthStore } from '../store/kdsDeviceAuth.store';
import {
  useTabletDeviceAuthStore,
  activeTabletToken,
  isManagerSteppedUp,
  isStaffElevated,
  isDeviceEnrolled,
} from '../store/tabletDeviceAuth.store';

export type LiveOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';

/**
 * Mirrors apps/api/prisma/schema.prisma's POSSyncStatus enum exactly — this
 * is the truthful IdealPOS-delivery lifecycle, entirely separate from
 * LiveOrderStatus (kitchen-facing pending/confirmed/preparing/ready/...).
 * Never infer "sent to kitchen"/"done" from LiveOrderStatus alone: a
 * 'confirmed' kitchen status says nothing about whether IdealPOS actually
 * received the order — check posSyncStatus for that.
 */
export type LiveOrderPosSyncStatus =
  | 'not_synced'
  | 'queued_for_connector'
  | 'submitted_awaiting_confirmation'
  | 'synced'
  | 'failed'
  | 'not_applicable'
  | 'unsupported'
  // This order's POS submission is owned by the native IdealPOS handheld
  // workflow (NativeTableRound -> Order2 over TCP), not the Webit connector
  // pipeline. It is not a progress state: a native order's real delivery
  // state lives in its rounds, and this row exists to say who owns the order.
  | 'owned_by_native'
  // Staff cancelled the order while its dispatch was still stoppable.
  // Pre-existing on the server; it was simply missing from this union.
  | 'cancelled';

/**
 * Which POS pipeline owns an order - see
 * apps/api/src/pos-sync/pos-submission-strategy.ts.
 *
 * THE TABLET READS THIS TO DECIDE WHICH BUTTON IT IS PRESSING. A `webit` order
 * is sent by being created, exactly as it always has been. A
 * `native_table_round` order is created first and then sent, round by round,
 * through POST /admin/orders/:id/rounds - which is also what makes a second
 * round on an open table possible at all.
 *
 * Absent on an older cached response; treat that as `webit`, which is what
 * every order was before the column existed.
 */
export type LiveOrderPosStrategy = 'webit' | 'native_table_round';

/** Mirrors the subset of POSSyncRecord this order's staff-facing status
 * indicator needs — attemptCount/nextRetryAt distinguish "never attempted"
 * from "temporarily failing, will retry" (both otherwise look like
 * posSyncStatus 'not_synced'). Absent entirely for an order whose
 * posSyncRecord row hasn't loaded on this response (older cached data);
 * treat that the same as "no detail available yet", not as a failure. */
export interface LiveOrderPosSyncRecord {
  status: LiveOrderPosSyncStatus;
  attemptCount: number;
  nextRetryAt: string | null;
  errorMessage: string | null;
  /** Absent on an older cached response — treat as 'webit'. */
  strategy?: LiveOrderPosStrategy;
}

/**
 * Matches `docs/domain-model.md`'s `SelectedModifier` and the persisted
 * `OrderItem.selectedModifiers` snapshot shape (Story 15-3). `modifierGroupId`/
 * `optionId` are `null` only for an order placed through the legacy,
 * name-based kiosk path (Window Display's separate, out-of-scope ordering
 * flow) — every Order Tablet order always has real ids.
 */
export interface LiveOrderModifier {
  modifierGroupId: string | null;
  modifierGroupName: string | null;
  optionId: string | null;
  optionName: string;
  priceDeltaCents: number;
}

export interface LiveOrderItem {
  id: string;
  menuItemTitle: string;
  menuItemCategory: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  selectedModifiers: LiveOrderModifier[];
  notes: string | null;
}

export type ServiceMode = 'dine_in' | 'takeaway';

export interface LiveOrder {
  id: string;
  venueId: string;
  tableId: string | null;
  tableNumber: string | null;
  /** Story 15-13: the single authoritative dine-in/takeaway signal — never
   * infer service mode from tableId/tableNumber/source elsewhere. */
  serviceMode: ServiceMode;
  /** Non-null only when serviceMode is 'takeaway'. */
  takeawayReference: string | null;
  status: LiveOrderStatus;
  /** Direct scalar on Order — always present, coarse-grained. */
  posSyncStatus: LiveOrderPosSyncStatus;
  /** Richer detail (attemptCount/nextRetryAt/errorMessage) — may be absent
   * on stale cached data; prefer posSyncStatus above when this is null. */
  posSyncRecord?: LiveOrderPosSyncRecord | null;
  source: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  submittedAt: string;
  confirmedAt?: string | null;
  preparingAt?: string | null;
  readyAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  priority?: boolean;
  items: LiveOrderItem[];
}

export type PaymentStatus = 'paid' | 'unpaid' | 'partially_paid' | 'refunded' | 'pending_payment' | 'unknown';
export type AdminOrderStatus = 'pending' | 'preparing' | 'ready' | 'ready_to_serve' | 'served' | 'delivered';

export interface AdminOrderItem {
  name: string;
  qty: number;
  price: number;
  line: number;
  dish: string;
  modifiers: string[];
  notes: string | null;
}

export interface AdminOrder {
  id: string;
  customer: string;
  email: string;
  phone: string;
  type: 'Dine-in' | 'Takeaway' | 'Delivery';
  paymentStatus: PaymentStatus;
  orderStatus: AdminOrderStatus;
  dish: 'pizza' | 'salad' | 'burger' | 'pasta' | 'drink' | 'dessert';
  items: number;
  total: number;
  date: string;
  tableNumber: string | null;
  notes: string | null;
  submittedAt: string;
  itemsList: AdminOrderItem[];
}

export const LIVE_ORDERS_QUERY_KEY = ['live-orders'] as const;

/**
 * The restricted (`/api/tablet/orders`) and staff (`/api/admin/orders`)
 * variants of live-orders must not share a react-query cache entry — a
 * component switching between them (e.g. OrderTabletPage on staff
 * elevation/lock) needs its own fetch, not another variant's stale/differently
 * -scoped cached data. Callers that only ever use one variant (KDS, the admin
 * Orders page) get the same key as before this option existed.
 */
export function liveOrdersQueryKey(restrictedEndpoint = false) {
  return [...LIVE_ORDERS_QUERY_KEY, restrictedEndpoint] as const;
}
export const DEFAULT_VENUE_ID = import.meta.env.VITE_VENUE_ID || '';
const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Resolves the bearer token for the currently-signed-in caller, highest
 * authority first: a logged-in staff member's session token (embedded
 * Admin Console route), the Order Tablet's own device/staff-elevation/
 * manager-step-up token (story 15-1, DL-081 — standalone VITE_APP_MODE=
 * tablet, gated by TabletDeviceGate), or an unattended KDS terminal's
 * venue-scoped device token (VITE_APP_MODE=kds, gated by KdsPinGate).
 * These three are mutually exclusive in practice (a given build mode only
 * ever populates one of them), but checked in this fixed order regardless.
 * There is no static/shared fallback token — a caller with none of these
 * simply gets no Authorization header and the backend rejects the request.
 */
export function getAuthToken(): string | undefined {
  return (
    useAuthStore.getState().accessToken ??
    activeTabletToken(useTabletDeviceAuthStore.getState()) ??
    useKdsDeviceAuthStore.getState().accessToken ??
    undefined
  );
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Mirrors api.ts's axios response interceptor ("An expired/invalid session
 * must not linger client-side") for the Order Tablet's hand-rolled fetch()
 * calls (useLiveOrders, fetchPosSyncStatus, fetchPrintJobsStatus,
 * submitOrderToKitchen), which never went through that axios instance and
 * so never benefited from it — the exact gap behind the 2026-08-26/27
 * DUNEDIN incident: a 401 on the orders query left a stale cached "active
 * order" in place indefinitely instead of clearing the dead session, and
 * the duplicate-order guard kept trusting it.
 *
 * Clears whichever auth layer is actually active, mirroring
 * getAuthToken()'s own precedence (staff > tablet elevation/device > KDS)
 * — never guesses; a caller with no active layer is a no-op.
 */
export function clearAuthOnUnauthorized(): void {
  if (useAuthStore.getState().accessToken) {
    useAuthStore.getState().clearAuth();
    return;
  }
  const tabletState = useTabletDeviceAuthStore.getState();
  if (isManagerSteppedUp(tabletState)) {
    tabletState.clearManagerStepUp();
    return;
  }
  if (isStaffElevated(tabletState)) {
    tabletState.clearStaffElevation();
    return;
  }
  if (isDeviceEnrolled(tabletState)) {
    tabletState.clearDevice();
    return;
  }
  if (useKdsDeviceAuthStore.getState().accessToken) {
    useKdsDeviceAuthStore.getState().clear();
  }
}

export const ORDERS_API_BASE = API_BASE;

function dishFor(value: string): AdminOrder['dish'] {
  const text = value.toLowerCase();
  if (/pizza|pide|flatbread|oven/.test(text)) return 'pizza';
  if (/salad|cold|hummus|mezze/.test(text)) return 'salad';
  if (/burger|wrap|kebab|grill/.test(text)) return 'burger';
  if (/pasta|risotto|main/.test(text)) return 'pasta';
  if (/drink|beverage|mocktail/.test(text)) return 'drink';
  return 'dessert';
}

export function mapLiveOrderToAdminOrder(order: LiveOrder): AdminOrder {
  // Story 15-13: authoritative — never inferred from tableNumber presence.
  const type: AdminOrder['type'] =
    order.serviceMode === 'takeaway'
      ? 'Takeaway'
      : order.source === 'delivery' || order.source === 'online'
        ? 'Delivery'
        : 'Dine-in';
  const firstItem = order.items[0];
  const orderStatus: AdminOrderStatus = {
    pending: 'pending', confirmed: 'pending', preparing: 'preparing', ready: 'ready_to_serve',
    completed: 'served', cancelled: 'delivered',
  }[order.status] as AdminOrderStatus;

  return {
    id: order.id,
    customer:
      order.customerName ||
      (order.serviceMode === 'takeaway'
        ? order.takeawayReference || 'Takeaway'
        : order.tableNumber
          ? `Table ${order.tableNumber}`
          : type),
    email: order.customerEmail || '—',
    phone: order.customerPhone || '—',
    type,
    // The backend does not persist a payment status on Order (no Stripe
    // capture verification is wired up — see OrdersService.create's mock
    // payment validation), so this must never claim 'paid' as if it were
    // backend-confirmed. Only states we can actually assert from the order
    // lifecycle itself are used; everything else is honestly 'unknown'.
    paymentStatus: order.status === 'cancelled' ? 'refunded' : order.status === 'pending' ? 'pending_payment' : 'unknown',
    orderStatus,
    dish: dishFor(`${firstItem?.menuItemCategory || ''} ${firstItem?.menuItemTitle || ''}`),
    items: order.items.reduce((total, item) => total + item.quantity, 0),
    total: order.totalCents / 100,
    date: new Date(order.submittedAt).toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' }),
    tableNumber: order.tableNumber,
    notes: order.notes,
    submittedAt: order.submittedAt,
    itemsList: [...order.items].sort(compareMenuItemsAlphabetically).map(item => ({
      name: item.menuItemTitle,
      qty: item.quantity,
      price: item.unitPriceCents / 100,
      line: item.lineTotalCents / 100,
      dish: dishFor(`${item.menuItemCategory} ${item.menuItemTitle}`),
      modifiers: (item.selectedModifiers || []).map(modifier => modifier.optionName),
      notes: item.notes,
    })),
  };
}

/**
 * `restrictedEndpoint: true` routes through `GET /api/tablet/orders` instead
 * of `GET /api/admin/orders` — required for an unelevated standalone Order
 * Tablet, whose bare device token (role `viewer`) is correctly rejected by
 * `/api/admin/orders`'s staff-only `RolesGuard`. Elevated staff/manager
 * tablet sessions, KDS, and the admin Orders page all keep using the
 * unmodified `/api/admin/orders` (default, unchanged behavior).
 */
export function useLiveOrders(options?: { restrictedEndpoint?: boolean }) {
  const restrictedEndpoint = options?.restrictedEndpoint ?? false;
  const queryClient = useQueryClient();
  const [isRealtimeConnected, setRealtimeConnected] = useState(false);
  const query = useQuery<LiveOrder[]>({
    queryKey: liveOrdersQueryKey(restrictedEndpoint),
    queryFn: async () => {
      const path = restrictedEndpoint ? '/api/tablet/orders' : '/api/admin/orders';
      const response = await fetch(`${API_BASE}${path}?venueId=${DEFAULT_VENUE_ID}`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        if (response.status === 401) clearAuthOnUnauthorized();
        throw new Error(`Failed to load orders (${response.status})`);
      }
      return response.json() as Promise<LiveOrder[]>;
    },
    // No fake fallback on failure: query.data stays undefined and isError
    // reflects the real fetch outcome, so consumers can show an honest
    // loading/error/retry state instead of fabricated orders.
    retry: 1,
    // Safety net for a WebSocket that never connects at all (proxy/firewall
    // misconfiguration) or stalls without firing 'disconnect': without this,
    // a client stuck in isRealtimeConnected=false has no path back to fresh
    // data short of a manual page reload. Once connected, the socket's own
    // 'connect'/'orderUpdate' handlers are authoritative and this is disabled.
    refetchInterval: isRealtimeConnected ? false : 15000,
  });

  // 2026-08-26/27 DUNEDIN incident: once background refetches started
  // failing (session expiry), the last successful `data` lingered forever
  // — React Query's default behavior — and callers (getActiveOrderForTable,
  // the createdOrderRef resync effect) kept treating it as current truth,
  // producing a false "table already has an order" claim with no real
  // backend order behind it. True exactly when the most recent settled
  // fetch was a success, not a failure — no invented TTL, just React
  // Query's own dataUpdatedAt/errorUpdatedAt timestamps compared directly.
  // Flips back to true for free the moment a subsequent fetch succeeds
  // (e.g. after re-authenticating), satisfying "stale state clears after a
  // successful refresh" with no extra invalidation logic needed.
  const ordersDataIsAuthoritative = query.dataUpdatedAt > 0 && query.errorUpdatedAt <= query.dataUpdatedAt;

  useEffect(() => {
    const socket = io(API_BASE || undefined, {
      transports: ['websocket'],
      reconnection: true,
      auth: { token: getAuthToken() },
    });
    socket.on('connect', () => {
      setRealtimeConnected(true);
      socket.emit('joinVenue', { venueId: DEFAULT_VENUE_ID });
      void query.refetch();
    });
    socket.on('disconnect', () => setRealtimeConnected(false));
    socket.on('orderUpdate', (updated: LiveOrder) => {
      queryClient.setQueryData<LiveOrder[]>(liveOrdersQueryKey(restrictedEndpoint), current => {
        if (!current) return [updated];
        return current.some(order => order.id === updated.id)
          ? current.map(order => order.id === updated.id ? updated : order)
          : [updated, ...current];
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient, restrictedEndpoint]);

  return { ...query, isRealtimeConnected, ordersDataIsAuthoritative };
}

export function useLiveOrderStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, nextStatus }: { orderId: string; nextStatus: LiveOrderStatus }) => {
      const response = await fetch(`${API_BASE}/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) throw new Error(`Failed to update order (${response.status})`);
      return response.json() as Promise<LiveOrder>;
    },
    onSuccess: updated => {
      queryClient.setQueryData<LiveOrder[]>(liveOrdersQueryKey(false), current =>
        current?.map(order => order.id === updated.id ? updated : order) || [updated]);
    },
  });
}

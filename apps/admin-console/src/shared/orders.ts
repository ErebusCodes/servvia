import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { compareMenuItemsAlphabetically } from './menu/menuData';
import { useAuthStore } from '../store/auth.store';
import { useKdsDeviceAuthStore } from '../store/kdsDeviceAuth.store';
import { useTabletDeviceAuthStore, activeTabletToken } from '../store/tabletDeviceAuth.store';

export type LiveOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';

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
      if (!response.ok) throw new Error(`Failed to load orders (${response.status})`);
      return response.json() as Promise<LiveOrder[]>;
    },
    // No fake fallback on failure: query.data stays undefined and isError
    // reflects the real fetch outcome, so consumers can show an honest
    // loading/error/retry state instead of fabricated orders.
    retry: 1,
  });

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

  return { ...query, isRealtimeConnected };
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

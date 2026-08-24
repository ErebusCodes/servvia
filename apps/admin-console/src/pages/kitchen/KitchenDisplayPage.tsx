import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import {
  useLiveOrders,
  useLiveOrderStatusMutation,
  type LiveOrderStatus,
} from '../../shared/orders';
import { compareMenuItemsAlphabetically } from '../../shared/menu/menuData';

function mapBackendOrderToTicket(order: any): Ticket {
  const source = order.source || 'dine_in';
  // Story 15-13: authoritative — never inferred from tableNumber presence.
  const serviceMode: 'dine_in' | 'takeaway' = order.serviceMode === 'takeaway' ? 'takeaway' : 'dine_in';
  const takeawayReference: string | null = order.takeawayReference ?? null;
  const table = serviceMode === 'takeaway'
    ? (takeawayReference ? `Takeaway ${takeawayReference}` : 'Takeaway')
    : `Table ${order.tableNumber}`;
  const no = serviceMode === 'takeaway'
    ? (takeawayReference || (order.id.startsWith('ORD-') ? order.id : `#${order.id.substring(0, 8).toUpperCase()}`))
    : `T${order.tableNumber}`;

  const submittedAt = new Date(order.submittedAt).getTime();
  const nowMs = Date.now();
  const elapsedSec = Math.floor((nowMs - submittedAt) / 1000);
  
  const items = [...(order.items || [])].sort(compareMenuItemsAlphabetically).map((item: any) => ({
    q: item.quantity,
    n: item.menuItemTitle,
    mods: (item.selectedModifiers || []).map((m: any) => m.optionName),
  }));

  const station = stationForTicket(items);

  let lane: 'new' | 'preparing' | 'ready' | 'completed' = 'new';
  if (order.status === 'confirmed' || order.status === 'pending') lane = 'new';
  else if (order.status === 'preparing') lane = 'preparing';
  else if (order.status === 'ready') lane = 'ready';
  else if (order.status === 'completed' || order.status === 'cancelled') lane = 'completed';

  const confirmedAt = order.confirmedAt ? new Date(order.confirmedAt).getTime() : undefined;
  const preparingAt = order.preparingAt ? new Date(order.preparingAt).getTime() : undefined;
  const readyAt = order.readyAt ? new Date(order.readyAt).getTime() : undefined;
  const completedAt = order.completedAt ? new Date(order.completedAt).getTime() : undefined;

  return {
    id: order.id,
    no,
    table,
    serviceMode,
    takeawayReference,
    customer: order.customerName || (serviceMode === 'dine_in' ? undefined : 'Customer'),
    source,
    station,
    staff: '—',
    lane,
    e0: elapsedSec,
    slaSec: 15 * 60,
    vip: order.totalCents > 10000,
    held: false,
    items,
    allergy: order.allergyNotes || null,
    special: order.notes || null,
    submittedAt,
    confirmedAt,
    preparingAt,
    readyAt,
    completedAt,
  };
}


// ── Types ──────────────────────────────────────────────────────────────────────

type OrderStatus = 'new' | 'preparing' | 'ready' | 'completed';
type ItemStatus = 'pending' | 'preparing' | 'ready' | 'completed';
type SlaStatus = 'ok' | 'warning' | 'critical' | 'done';

interface TicketItem {
  q: number;
  n: string;
  mods: string[];
}

interface Ticket {
  id: string;
  no: string;
  table: string;
  /** Story 15-13: authoritative dine-in/takeaway signal. */
  serviceMode: 'dine_in' | 'takeaway';
  takeawayReference: string | null;
  customer?: string;
  source: string;
  station: string;
  staff: string;
  lane: OrderStatus;
  e0: number; // initial elapsed seconds
  slaSec: number;
  vip: boolean;
  held?: boolean;
  items: TicketItem[];
  allergy?: string | null;
  special?: string | null;
  submittedAt: number;
  confirmedAt?: number;
  preparingAt?: number;
  readyAt?: number;
  completedAt?: number;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IcoClock = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const IcoWarn = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

const IcoCrit = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);

const IcoDone = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M21.8 10A10 10 0 1 1 17 3.3" />
    <path d="m9 11 3 3L22 4" />
  </svg>
);

const IcoFlame = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);

const IcoSearch = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const IcoSort = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16" />
  </svg>
);

const IcoComfy = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="14" width="18" height="7" rx="1.5" />
  </svg>
);

const IcoCompact = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 5h18M3 10h18M3 14h18M3 19h18" />
  </svg>
);

const IcoSelect = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 11 3 3 8-8" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const IcoFocus = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

const IcoLink = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
  </svg>
);

const IcoCheckMini = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12 5 5L20 7" />
  </svg>
);

const IcoCheckItemReady = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const IcoCheckItemPrep = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const IcoFolder = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M5 12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2M5 12a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2" />
  </svg>
);

const IcoPause = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

const IcoPlay = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ flexShrink: 0 }}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

const IcoInfo = ({ size = 16, style }: { size?: number; style?: CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const STATION_LIST = ['All', 'Grill', 'Fry', 'Cold & Salad', 'Pizza & Oven', 'Main Kitchen', 'Dessert'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function mmss(s: number): string {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

function assignStaff(station: string): string {
  return {
    'Grill': 'Marcus L.',
    'Fry': 'Omar H.',
    'Cold & Salad': 'Dana K.',
    'Pizza & Oven': 'Lena V.',
    'Main Kitchen': 'Priya N.',
    'Dessert': 'Sam R.'
  }[station] || 'Priya N.';
}

function orderType(t: Ticket): { primary: string; fulfill: string | null } {
  // Story 15-13: fixed to check the authoritative serviceMode field. The
  // prior `t.source === 'dine_in'` check compared against a value the real
  // OrderSource enum (kiosk/staff/online) never actually produces — that
  // branch was structurally unreachable against real backend data (a latent
  // pre-existing defect, not introduced here), always falling through to
  // 'TA'/pickup-or-delivery regardless of table presence.
  if (t.serviceMode === 'dine_in') return { primary: 'T', fulfill: null };
  const fulfill = (t.source === 'delivery' || t.source === 'online') ? 'DEL' : 'PUP';
  return { primary: 'TA', fulfill };
}

function classifyItem(name: string): string {
  const n = (name || '').toLowerCase();
  if (/baklava|gelato|dessert|sweet|kunafa|cake|pudding|ice cream|knafeh/.test(n)) return 'Dessert';
  if (/pizza|pide|lahm|ajin|manakish|flatbread|oven|focaccia|kataifi/.test(n)) return 'Pizza & Oven';
  if (/salad|fattoush|tabbouleh|hummus|\bdip|dolma|guacamole|caprese|burrata|baba|labneh|mezza|mezze|\bcold/.test(n)) return 'Cold & Salad';
  if (/grill|shish|kebab|kabab|chicken|lamb|ribeye|strip|steak|branzino|salmon|fish|skewer|char|kofta|kofte|prawn|mixed grill/.test(n)) return 'Grill';
  if (/wing|falafel|kibbeh|fries|frites|crispy|shrimp|dynamite|sigara|borek|börek|fried|calamari|nugget/.test(n)) return 'Fry';
  return 'Main Kitchen';
}

function stationForTicket(items: TicketItem[]): string {
  const counts: Record<string, number> = {};
  let firstStn: string | null = null;
  (items || []).forEach(i => {
    const s = classifyItem(i.n);
    if (!firstStn) firstStn = s;
    counts[s] = (counts[s] || 0) + i.q;
  });
  let best = firstStn || 'Main Kitchen';
  let bestN = -1;
  Object.keys(counts).forEach(s => {
    const val = counts[s];
    if (val !== undefined && val > bestN) {
      bestN = val;
      best = s;
    }
  });
  if (firstStn && counts[firstStn] !== undefined && counts[firstStn] === bestN) best = firstStn;
  return best;
}

function itemDefault(lane: OrderStatus): ItemStatus {
  return { new: 'pending', preparing: 'preparing', ready: 'ready', completed: 'completed' }[lane] as ItemStatus || 'pending';
}

const ITEM_STAGE_RANK: Record<ItemStatus, number> = {
  pending: 0,
  preparing: 1,
  ready: 2,
  completed: 3,
};

const TARGET_ITEM_STAGE: Partial<Record<OrderStatus, ItemStatus>> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};

const NEXT_ORDER_STATUS: Partial<Record<OrderStatus, LiveOrderStatus>> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};

// ── Main Page Component ────────────────────────────────────────────────────────

export function KitchenDisplayPage() {
  const [tick, setTick] = useState(0);
  const [heldTickets, setHeldTickets] = useState<Record<string, boolean>>({});
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [autoSort, setAutoSort] = useState(true);
  const [focus, setFocus] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [toastTimeout, setToastTimeout] = useState<NodeJS.Timeout | null>(null);

  // Filters & Views
  const [station, setStation] = useState('All');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'live' | 'expedite' | 'station' | 'history'>('live');
  const showCompleted = true;

  // History states
  const [histTime, setHistTime] = useState<'today' | 'hour'>('today');
  const [histStation, setHistStation] = useState('All');
  const [histType, setHistType] = useState('All');
  const [histQuery, setHistQuery] = useState('');

  const { data: orders = [], isLoading, isError, refetch, isRealtimeConnected } = useLiveOrders();
  const mutate = useLiveOrderStatusMutation();
  const tickets = useMemo(
    () => orders.map(order => ({
      ...mapBackendOrderToTicket(order),
      held: heldTickets[order.id] || false,
    })),
    [orders, heldTickets],
  );

  // Live timer for clock and ticket elapsed tracking
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const flash = useCallback((m: string) => {
    setToast(m);
    if (toastTimeout) clearTimeout(toastTimeout);
    const to = setTimeout(() => setToast(null), 2200);
    setToastTimeout(to);
  }, [toastTimeout]);

  // Local prep statuses for individual items
  const [itemPS, setItemPS] = useState<Record<string, Record<number, ItemStatus>>>({});

  // When tickets are loaded/changed, initialize default item statuses if not present
  useEffect(() => {
    setItemPS(prevPS => {
      const nextPS = { ...prevPS };
      let changed = false;
      tickets.forEach(t => {
        if (!nextPS[t.id]) {
          const n = t.items.length;
          const m: Record<number, ItemStatus> = {};
          for (let k = 0; k < n; k++) m[k] = itemDefault(t.lane);
          nextPS[t.id] = m;
          changed = true;
        }
      });
      return changed ? nextPS : prevPS;
    });
  }, [tickets]);

  const comfy = density === 'comfortable';
  const isHistory = viewMode === 'history';
  const isLive = viewMode === 'live';
  const isExpedite = viewMode === 'expedite';
  const isStation = viewMode === 'station';

  // ── Operations ──────────────────────────────────────────────────────────────

  const itemAdvance = useCallback((id: string, idx: number) => {
    const tk = tickets.find(t => t.id === id);
    if (!tk || tk.held || tk.lane === 'completed') return;

    const def = itemDefault(tk.lane);
    const cur = (itemPS[id] && itemPS[id][idx] != null) ? itemPS[id][idx]! : def;
    const target = TARGET_ITEM_STAGE[tk.lane];
    if (!target || ITEM_STAGE_RANK[cur] >= ITEM_STAGE_RANK[target]) return;

    const nextStatus = target;
    setItemPS(prevPS => {
      const tmap = { ...(prevPS[id] || {}) };
      tmap[idx] = nextStatus;
      return { ...prevPS, [id]: tmap };
    });

    // Individual item actions only advance the card when every item reaches
    // the target stage for the current lane.
    const currentPS = itemPS[id] || {};
    const statuses = tk.items.map((_, k) => k === idx ? nextStatus : (currentPS[k] != null ? currentPS[k]! : def));
    const nextBackendStatus = NEXT_ORDER_STATUS[tk.lane];
    const allAtTarget = target && statuses.length > 0
      && statuses.every(status => ITEM_STAGE_RANK[status] >= ITEM_STAGE_RANK[target]);

    if (allAtTarget && nextBackendStatus) {
      mutate.mutate({ orderId: id, nextStatus: nextBackendStatus });
      flash(tk.no + ' → ' + (nextBackendStatus === 'completed' ? 'Completed' : nextBackendStatus === 'ready' ? 'Ready' : 'Preparing'));
    }
  }, [tickets, itemPS, mutate, flash]);

  const advance = useCallback((id: string) => {
    const ticket = tickets.find(t => t.id === id);
    if (!ticket) return;

    const nextStatus = NEXT_ORDER_STATUS[ticket.lane];
    const targetItemStage = TARGET_ITEM_STAGE[ticket.lane];
    if (nextStatus && targetItemStage) {
      setItemPS(current => ({
        ...current,
        [id]: Object.fromEntries(ticket.items.map((_, index) => [index, targetItemStage])),
      }));
      mutate.mutate({ orderId: id, nextStatus });
      const label = ticket.no + ' → ' + (nextStatus === 'completed' ? 'Completed' : nextStatus === 'ready' ? 'Ready' : 'Preparing');
      flash(label);
    }
  }, [tickets, mutate, flash]);

  const hold = useCallback((id: string) => {
    setHeldTickets(current => ({ ...current, [id]: !current[id] }));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const clearSel = useCallback(() => {
    setSelected({});
  }, []);

  const advanceSelected = useCallback(() => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    ids.forEach(id => {
      const ticket = tickets.find(t => t.id === id);
      if (!ticket) return;
      const nextStatus = NEXT_ORDER_STATUS[ticket.lane];
      const targetItemStage = TARGET_ITEM_STAGE[ticket.lane];
      if (nextStatus && targetItemStage) {
        setItemPS(current => ({
          ...current,
          [id]: Object.fromEntries(ticket.items.map((_, index) => [index, targetItemStage])),
        }));
        mutate.mutate({ orderId: id, nextStatus });
      }
    });
    setSelected({});
    flash(ids.length + ' tickets advanced');
  }, [selected, tickets, mutate, flash]);

  const completeSelected = useCallback(() => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    ids.forEach(id => {
      const ticket = tickets.find(candidate => candidate.id === id);
      if (ticket) {
        setItemPS(current => ({
          ...current,
          [id]: Object.fromEntries(ticket.items.map((_, index) => [index, 'completed' as ItemStatus])),
        }));
      }
      mutate.mutate({ orderId: id, nextStatus: 'completed' });
    });
    setSelected({});
    flash(ids.length + ' tickets completed');
  }, [selected, tickets, mutate, flash]);

  // ── Styled Tokens ───────────────────────────────────────────────────────────

  const orderNoStyle: CSSProperties = useMemo(() => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: comfy ? '22px' : '18px', color: 'var(--color-text)', letterSpacing: '-0.01em', lineHeight: 1, padding: comfy ? '5px 10px' : '4px 8px', border: '1.5px solid var(--color-border-strong)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)'
  }), [comfy]);

  const metaStyle: CSSProperties = useMemo(() => ({
    fontSize: comfy ? '12px' : '11px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)'
  }), [comfy]);

  const itemQnStyle: CSSProperties = useMemo(() => ({
    fontSize: comfy ? '15px' : '13px', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.25
  }), [comfy]);

  const modStyle: CSSProperties = useMemo(() => ({
    fontSize: comfy ? '13px' : '12px', color: 'var(--color-text-secondary)'
  }), [comfy]);

  const allBarStyle: CSSProperties = useMemo(() => ({
    width: '100%', height: comfy ? '44px' : '38px', border: '1px solid transparent', borderRadius: 'var(--radius-sm)', background: 'var(--color-primary)', color: 'var(--color-on-primary)', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: comfy ? '14px' : '12px', letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
  }), [comfy]);

  const holdBtnStyle: CSSProperties = useMemo(() => ({
    width: comfy ? '50px' : '44px', height: comfy ? '44px' : '40px', flex: 'none', borderRadius: 'var(--radius-md)', border: 'none', background: '#005F99', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
  }), [comfy]);

  // ── Derived State ───────────────────────────────────────────────────────────

  const URGENCY_DATA: Record<SlaStatus, { accent: string; fg: string; cardBg: string; cardBorder: string; rank: number; label: string }> = {
    ok: { accent: 'var(--green-500)', fg: 'var(--green-700)', cardBg: 'var(--color-surface)', cardBorder: 'var(--color-border)', rank: 1, label: 'On time' },
    warning: { accent: 'var(--amber-500)', fg: 'var(--color-warning)', cardBg: 'var(--color-warning-bg)', cardBorder: 'var(--color-warning-border)', rank: 2, label: 'Approaching SLA' },
    critical: { accent: 'var(--red-500)', fg: 'var(--color-danger)', cardBg: 'var(--color-danger-bg)', cardBorder: 'var(--color-danger-border)', rank: 3, label: 'SLA breached' },
    done: { accent: 'var(--gray-300)', fg: 'var(--color-text-tertiary)', cardBg: 'var(--color-surface)', cardBorder: 'var(--color-border)', rank: 0, label: 'Completed' },
  };

  const enrichedTickets = useMemo(() => {
    const nowTs = Date.now();
    return tickets.map(t => {
      const active = t.lane !== 'completed';
      const stn = stationForTicket(t.items);
      const staffName = t.staff === '—' ? '—' : assignStaff(stn);
      const elapsed = active ? t.e0 + tick : t.e0;
      const ratio = elapsed / t.slaSec;
      const u = !active ? 'done' : ratio >= 1 ? 'critical' : ratio >= 0.8 ? 'warning' : 'ok';
      const ug = URGENCY_DATA[u]!;
      const ot = orderType(t);
      const loc = ot.primary === 'T'
        ? t.table
        : (t.takeawayReference ? `Takeaway ${t.takeawayReference}` : (t.customer ? 'Cust. ' + t.customer : 'Takeaway'));
      const def = itemDefault(t.lane);
      const psMap = itemPS[t.id] || {};

      const items = t.items.map((i, idx) => {
        const st = psMap[idx] !== undefined ? psMap[idx]! : def;
        const istn = classifyItem(i.n);
        const indDone = st === 'ready' || st === 'completed';
        const indPrep = st === 'preparing';
        const targetStage = TARGET_ITEM_STAGE[t.lane] || 'completed';
        const stageComplete = ITEM_STAGE_RANK[st] >= ITEM_STAGE_RANK[targetStage];
        return {
          q: i.q,
          n: i.n,
          mods: i.mods,
          qn: i.q + '×  ' + i.n,
          modsText: i.mods.join(' · '),
          hasMods: i.mods.length > 0,
          status: st,
          isReady: indDone,
          isCompleted: st === 'completed',
          isPreparing: indPrep,
          isPending: st === 'pending',
          isStageComplete: stageComplete,
          station: istn,
          idx,
          indStyle: {
            width: comfy ? '26px' : '22px', height: comfy ? '26px' : '22px', flex: 'none', borderRadius: '50%',
            border: '2px solid ' + (indDone ? 'var(--color-success)' : indPrep ? '#FCA311' : 'var(--color-border-strong)'),
            background: indDone ? 'var(--color-success)' : indPrep ? '#FCA311' : 'transparent',
            color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: t.lane === 'completed' ? 'default' : 'pointer', marginTop: '1px'
          } as CSSProperties,
          rowTextStyle: { textDecoration: indDone ? 'line-through' : 'none', opacity: indDone ? 0.6 : 1 } as CSSProperties,
          onClick: () => itemAdvance(t.id, idx),
        };
      });

      const totalItems = t.items.reduce((a, i) => a + i.q, 0);
      const doneCount = items.filter(it => it.isStageComplete).length;
      const totalCount = items.length;
      const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
      const progDone = doneCount === totalCount && totalCount > 0;
      const progAccent = progDone ? 'var(--color-success)' : '#FCA311';

      const fireTogether = /fire.*together|together|coordinate/i.test(t.special || '') || /birthday/i.test(t.special || '');
      const fireMode = t.held ? 'hold' : (fireTogether ? 'together' : 'now');
      const readyAt = t.readyAt || null;
      const waitMin = readyAt ? Math.max(0, Math.round((nowTs - readyAt) / 60000)) : 0;
      const isDelivery = ot.fulfill === 'DEL';
      const readyWaitText = isDelivery ? 'Ready for driver' : ('Ready for ' + (waitMin <= 0 ? '<1' : waitMin) + ' min');
      const sel = !!selected[t.id];

      // Derived UI Styles
      const OT_PRIMARY: Record<string, { bg: string }> = { T: { bg: 'var(--color-info)' }, TA: { bg: 'var(--color-accent)' } };
      const OT_FULFILL: Record<string, { fg: string; bg: string; border: string }> = {
        DEL: { fg: 'var(--color-accent)', bg: 'var(--color-accent-bg)', border: 'var(--color-accent-border)' },
        PUP: { fg: 'var(--color-info)', bg: 'var(--color-info-bg)', border: 'var(--color-info-border)' },
      };

      const otPrimaryStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '26px', height: '22px', padding: '0 8px', borderRadius: 'var(--radius-xs)', background: OT_PRIMARY[ot.primary]?.bg, color: '#fff', fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' as const, flex: 'none' as const };
      const otFulfillStyle = ot.fulfill ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '30px', height: '22px', padding: '0 8px', borderRadius: 'var(--radius-xs)', background: OT_FULFILL[ot.fulfill]?.bg, color: OT_FULFILL[ot.fulfill]?.fg, border: '1px solid ' + OT_FULFILL[ot.fulfill]?.border, fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' as const, flex: 'none' as const } : {};
      const timerStyle = { display: 'inline-flex', alignItems: 'center', gap: '5px', color: ug.fg, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: comfy ? '24px' : '19px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' as const, letterSpacing: '-0.01em' };
      const cardStyle = { position: 'relative' as const, background: ug.cardBg, border: '1px solid ' + ug.cardBorder, borderLeft: '5px solid ' + ug.accent, borderRadius: 'var(--radius-lg)', padding: comfy ? '14px 16px' : '10px 12px', boxShadow: 'var(--shadow-xs)', display: 'flex', flexDirection: 'column' as const, gap: comfy ? '11px' : '7px', opacity: t.held ? 0.55 : 1 };
      const checkboxStyle = { width: '24px', height: '24px', flex: 'none' as const, borderRadius: 'var(--radius-xs)', border: '2px solid ' + (sel ? 'var(--color-primary)' : 'var(--color-border-strong)'), background: sel ? 'var(--color-primary)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginTop: '2px' };
      
      const PILL = {
        ok: { text: 'On time', bg: 'var(--color-success)' },
        warning: { text: 'Due soon', bg: 'var(--color-warning)' },
        critical: { text: 'Overdue', bg: 'var(--color-danger)' },
        done: { text: 'Completed', bg: 'var(--color-text-tertiary)' }
      };
      const BAR = { new: 'Start All Items', preparing: 'Mark all ready', ready: 'Mark All Complete', completed: 'Completed' };
      
      const fireBadge = (bg: string, fg: string, bd: string) => ({ display: 'inline-flex' as const, alignItems: 'center', gap: '4px', height: '22px', padding: '0 9px', borderRadius: 'var(--radius-xs)', background: bg, color: fg, border: '1px solid ' + bd, fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const, flex: 'none' as const });
      const readyBannerStyle = { display: 'flex', alignItems: 'center', gap: '8px', padding: comfy ? '9px 12px' : '7px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)' };

      const progWrapStyle = { display: 'flex', flexDirection: 'column' as const, gap: '5px' };
      const progTrackStyle = { width: '100%', height: comfy ? '7px' : '6px', borderRadius: 'var(--radius-full)', background: 'var(--color-surface-3)', overflow: 'hidden' };
      const progHeadStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-sans)', fontSize: comfy ? '12px' : '11px', fontWeight: 700, letterSpacing: '0.02em' };
      const progFillStyle = { width: pct + '%', height: '100%', borderRadius: 'var(--radius-full)', background: progAccent, transition: 'width .3s ease' };
      const progValStyle = { color: progDone ? 'var(--color-success)' : 'var(--color-text-secondary)' };

      return {
        ...t,
        station: stn,
        items,
        totalItems,
        elapsed,
        timer: mmss(elapsed),
        urgency: u,
        readyWaitText,
        isDelivery,
        fireMode,
        isHold: fireMode === 'hold',
        isFireTogether: fireMode === 'together',
        fireNow: fireMode !== 'hold',
        selected: sel,
        isActive: active,
        progLabel: doneCount + ' / ' + totalCount + ' items',
        progPctText: pct + '%',
        pct,
        progAccent,
        progDone,
        loc,
        staffName,
        otPrimary: ot.primary,
        otFulfill: ot.fulfill,
        waitMin,
        // UI styles
        otPrimaryStyle,
        otFulfillStyle,
        timerStyle,
        cardStyle,
        checkboxStyle,
        uClock: u === 'ok',
        uWarn: u === 'warning',
        uCrit: u === 'critical',
        uDone: u === 'done',
        pillStyle: { display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 'var(--radius-xs)', background: PILL[u].bg, color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const },
        pillText: PILL[u].text,
        barLabel: BAR[t.lane] || 'Advance',
        readyBannerStyle,
        readyWaitStyle: { fontFamily: 'var(--font-sans)', fontSize: comfy ? '13px' : '12px', fontWeight: 700, color: 'var(--color-success)' },
        metaLine: t.id + ' · ' + loc + ' · ' + stn + ' · ' + staffName,
        accent: ug.accent,
        rank: ug.rank,
        otHasFulfill: !!ot.fulfill,
        fireTogetherStyle: fireBadge('var(--color-warning-bg)', 'var(--color-warning)', 'var(--color-warning-border)'),
        holdBadgeStyle: fireBadge('var(--color-info-bg)', 'var(--color-info)', 'var(--color-info-border)'),
        progWrapStyle,
        progTrackStyle,
        progHeadStyle,
        progFillStyle,
        progValStyle,
        showReadyBanner: t.lane === 'ready',
        onSelectToggle: () => toggleSelect(t.id),
        onPrimary: () => advance(t.id),
        onHold: () => hold(t.id),
      };
    });
  }, [tickets, tick, comfy, selected, itemPS, itemAdvance, advance, hold, toggleSelect]);

  // ── Filters & Visibility ───────────────────────────────────────────────────

  const filteredTickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enrichedTickets.filter(t => {
      if (station !== 'All' && t.station !== station) return false;
      if (q) {
        const hay = (t.no + ' ' + t.metaLine + ' ' + t.items.map(i => i.qn).join(' ')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedTickets, station, query]);

  // ── Metric Calculations ─────────────────────────────────────────────────────

  const activeT = useMemo(() => enrichedTickets.filter(t => t.isActive), [enrichedTickets]);
  const delayedCount = useMemo(() => activeT.filter(t => t.urgency === 'critical').length, [activeT]);
  const atRiskCount = useMemo(() => activeT.filter(t => t.urgency === 'warning').length, [activeT]);
  const preparingTickets = useMemo(() => enrichedTickets.filter(t => t.lane === 'preparing'), [enrichedTickets]);
  const avgSec = useMemo(() => preparingTickets.length ? Math.round(preparingTickets.reduce((a, t) => a + t.elapsed, 0) / preparingTickets.length) : 0, [preparingTickets]);
  const onTimeCount = useMemo(() => activeT.filter(t => t.urgency !== 'critical').length, [activeT]);
  const slaPct = useMemo(() => activeT.length ? Math.round(100 * onTimeCount / activeT.length) : 100, [activeT, onTimeCount]);

  const metrics = useMemo(() => {
    const numBase = { fontSize: '22px', fontWeight: 600, fontFamily: 'var(--font-mono)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' as const, letterSpacing: '-0.01em' };
    return {
      active: String(activeT.length),
      activeHint: 'across 6 stations',
      activeStyle: { ...numBase, color: 'var(--color-text)' },
      delayed: String(delayedCount),
      delayedHint: atRiskCount > 0 ? ('+' + atRiskCount + ' at risk') : 'on pace',
      delayedStyle: { ...numBase, color: delayedCount > 0 ? 'var(--color-danger)' : 'var(--color-text)' },
      avg: mmss(avgSec),
      avgStyle: { ...numBase, color: avgSec > 12 * 60 ? 'var(--color-warning)' : 'var(--color-text)' },
      sla: slaPct + '%',
      slaStyle: { ...numBase, color: slaPct >= 95 ? 'var(--color-success)' : (slaPct >= 85 ? 'var(--color-warning)' : 'var(--color-danger)') },
    };
  }, [activeT, delayedCount, atRiskCount, avgSec, slaPct]);

  // ── Expedite Rail ──────────────────────────────────────────────────────────

  const expediteTickets = useMemo(() => {
    return activeT.filter(t => t.vip || t.urgency === 'critical').slice().sort((a, b) => b.rank - a.rank || b.elapsed - a.elapsed);
  }, [activeT]);

  const expediteShow = !focus && isLive && expediteTickets.length > 0;

  // ── History View Calculations ────────────────────────────────────────────────

  const historyTickets = useMemo(() => {
    const nowTs = Date.now();
    let hist = enrichedTickets.filter(t => t.lane === 'completed').map(t => {
      const agoMin = Math.max(0, Math.round((nowTs - (t.completedAt || nowTs)) / 60000));
      const hstn = stationForTicket(t.items);
      const hstaff = t.staff === '—' ? '—' : assignStaff(hstn);
      const ot = orderType(t);
      const typeKey = ot.fulfill || ot.primary;
      return {
        ...t,
        station: hstn,
        otPrimary: ot.primary,
        otFulfill: ot.fulfill,
        typeKey,
        staff: hstaff,
        agoMin,
        prepDur: mmss(t.e0),
        completedClock: t.completedAt ? new Date(t.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      };
    });

    if (histTime === 'hour') hist = hist.filter(h => h.agoMin <= 60);
    if (histStation !== 'All') hist = hist.filter(h => h.station === histStation);
    if (histType !== 'All') hist = hist.filter(h => h.typeKey === histType);
    const hq = histQuery.trim().toLowerCase();
    if (hq) hist = hist.filter(h => (h.no + ' ' + h.id).toLowerCase().includes(hq));

    hist.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    const OT_PRIMARY: Record<string, { bg: string }> = { T: { bg: 'var(--color-info)' }, TA: { bg: 'var(--color-accent)' } };
    const OT_FULFILL: Record<string, { fg: string; bg: string; border: string }> = {
      DEL: { fg: 'var(--color-accent)', bg: 'var(--color-accent-bg)', border: 'var(--color-accent-border)' },
      PUP: { fg: 'var(--color-info)', bg: 'var(--color-info-bg)', border: 'var(--color-info-border)' },
    };

    return hist.map(h => ({
      ...h,
      agoText: h.agoMin <= 0 ? 'just now' : h.agoMin + 'm ago',
      rowStyle: { borderBottom: '1px solid var(--color-border)' },
      otPrimaryStyle: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '26px', height: '22px', padding: '0 8px', borderRadius: 'var(--radius-xs)', background: OT_PRIMARY[h.otPrimary]?.bg, color: '#fff', fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' as const, flex: 'none' as const },
      otFulfillStyle: h.otFulfill ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '30px', height: '22px', padding: '0 8px', borderRadius: 'var(--radius-xs)', background: OT_FULFILL[h.otFulfill]?.bg, color: OT_FULFILL[h.otFulfill]?.fg, border: '1px solid ' + OT_FULFILL[h.otFulfill]?.border, fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' as const, flex: 'none' as const } : {},
    }));
  }, [enrichedTickets, histTime, histStation, histType, histQuery]);

  // ── Lane construction ────────────────────────────────────────────────────────

  const lanes = useMemo(() => {
    const laneStyleBase: CSSProperties = { display: 'flex', flexDirection: 'column', flex: '1 1 0px', minWidth: comfy ? '264px' : '212px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' };
    const headPad = comfy ? '11px 14px' : '8px 12px';
    const bodyPad = comfy ? '0 12px 12px' : '0 8px 8px';
    const stackBody: CSSProperties = { display: 'flex', flexDirection: 'column', gap: comfy ? '12px' : '8px', overflowY: 'auto', padding: bodyPad, flex: 1 };
    const gridBody: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(338px, 1fr))', gap: comfy ? '14px' : '10px', overflowY: 'auto', padding: comfy ? '14px' : '10px', flex: 1, alignContent: 'start' };

    const makeColumn = (key: string, title: string, accent: string, arr: any[], grid: boolean) => ({
      key, title, count: arr.length, tickets: arr, empty: arr.length === 0,
      laneStyle: (grid
        ? { display: 'flex', flexDirection: 'column', flex: '1 1 0px', minWidth: 0, background: 'transparent', borderRadius: 'var(--radius-lg)', border: 'none', overflow: 'hidden' }
        : laneStyleBase) as CSSProperties,
      headStyle: (grid
        ? { display: 'flex', alignItems: 'center', gap: '8px', padding: comfy ? '2px 4px 12px' : '2px 4px 8px', flexShrink: 0 }
        : { display: 'flex', alignItems: 'center', gap: '8px', padding: headPad, position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }) as CSSProperties,
      dotStyle: { width: '9px', height: '9px', borderRadius: '50%', background: accent, flexShrink: 0 } as CSSProperties,
      countStyle: { marginLeft: 'auto', minWidth: '22px', height: '20px', padding: '0 7px', borderRadius: 'var(--radius-full)', background: 'var(--color-surface-3)', color: 'var(--color-text-secondary)', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } as CSSProperties,
      bodyStyle: (grid ? gridBody : stackBody) as CSSProperties,
    });

    if (isStation) {
      const order = ['Grill', 'Fry', 'Cold & Salad', 'Pizza & Oven', 'Main Kitchen', 'Dessert'];
      const stationAccent: Record<string, string> = { 'Grill': 'var(--color-danger)', 'Fry': 'var(--color-warning)', 'Cold & Salad': 'var(--color-info)', 'Pizza & Oven': 'var(--color-accent)', 'Main Kitchen': 'var(--color-primary)', 'Dessert': 'var(--color-text-tertiary)' };
      const activeVisible = filteredTickets.filter(t => t.isActive);

      const sliceFor = (t: any, st: string) => {
        const items = t.items.filter((it: any) => it.station === st);
        if (items.length === 0) return null;
        const stationCount = new Set(t.items.map((it: any) => it.station)).size;
        const doneCount = items.filter((it: any) => it.isStageComplete).length;
        const totalCount = items.length;
        const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
        const stDone = doneCount === totalCount;
        return {
          ...t, items, station: st, isSlice: true,
          progLabel: doneCount + ' / ' + totalCount + ' items',
          progPctText: pct + '%',
          progFillStyle: { ...t.progFillStyle, width: pct + '%', background: stDone ? 'var(--color-success)' : '#FCA311' },
          progValStyle: { ...t.progValStyle, color: stDone ? 'var(--color-success)' : 'var(--color-text-secondary)' },
          stationComplete: stDone,
          showSliceNote: stationCount > 1,
          sliceNote: 'Part of ' + t.no + ' · ' + stationCount + ' stations',
          showReadyBanner: false,
        };
      };

      return order.filter(st => station === 'All' || st === station).map(st => {
        let arr = activeVisible.map(t => sliceFor(t, st)).filter(Boolean) as any[];
        arr = arr.sort((a, b) => a.submittedAt - b.submittedAt);
        return makeColumn('st-' + st, st, stationAccent[st] || 'var(--color-text-tertiary)', arr, false);
      });
    } else if (isExpedite) {
      const exp = filteredTickets.filter(t => t.isActive && (t.lane === 'ready' || t.vip || t.urgency === 'critical' || t.allergy || t.special));
      const arr = exp.slice().sort((a, b) => b.rank - a.rank || b.elapsed - a.elapsed);
      return [makeColumn('expedite', 'Final assembly & delivery', 'var(--color-danger)', arr, true)];
    } else {
      const laneDefs = [
        { key: 'new' as const, title: 'New Orders', accent: 'var(--color-info)' },
        { key: 'preparing' as const, title: 'Preparing', accent: 'var(--color-warning)' },
        { key: 'ready' as const, title: 'Ready', accent: 'var(--color-success)' },
        { key: 'completed' as const, title: 'Completed', accent: 'var(--color-text-tertiary)' },
      ].filter(l => l.key !== 'completed' || showCompleted);

      return laneDefs.map(l => {
        let arr = filteredTickets.filter(t => t.lane === l.key);
        if (l.key === 'completed') {
          arr = arr.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
        } else if (l.key === 'ready') {
          arr = arr.slice().sort((a, b) => (a.readyAt || a.submittedAt) - (b.readyAt || b.submittedAt));
        } else if (l.key === 'preparing') {
          arr = arr.slice().sort((a, b) => (a.preparingAt || a.submittedAt) - (b.preparingAt || b.submittedAt));
        } else {
          arr = arr.slice().sort((a, b) => a.submittedAt - b.submittedAt);
        }
        return makeColumn(l.key, l.title, l.accent, arr, false);
      });
    }
  }, [filteredTickets, station, viewMode, autoSort, comfy, showCompleted, itemPS]);

  // ── Styles ──────────────────────────────────────────────────────────────────

  const selectStyle = useMemo(() => {
    return { height: '38px', padding: '0 11px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (selectMode ? 'var(--color-primary)' : 'var(--color-border)'), background: selectMode ? 'var(--color-primary-subtle)' : 'var(--color-surface)', color: selectMode ? 'var(--green-700)' : 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600 };
  }, [selectMode]);

  const focusStyle = useMemo(() => {
    return { height: '38px', padding: '0 11px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (focus ? 'var(--color-primary)' : 'var(--color-border)'), background: focus ? 'var(--color-primary-subtle)' : 'var(--color-surface)', color: focus ? 'var(--green-700)' : 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600 };
  }, [focus]);

  const autoSortStyle = useMemo(() => {
    return { height: '38px', padding: '0 11px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (autoSort ? 'var(--color-primary)' : 'var(--color-border)'), background: autoSort ? 'var(--color-primary-subtle)' : 'var(--color-surface)', color: autoSort ? 'var(--green-700)' : 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600 };
  }, [autoSort]);

  const densityComfyStyle = useMemo(() => {
    return { width: '34px', height: '32px', border: 'none', borderRadius: 'var(--radius-sm)', background: comfy ? 'var(--color-surface)' : 'transparent', color: comfy ? 'var(--color-primary)' : 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: comfy ? 'var(--shadow-xs)' : 'none' };
  }, [comfy]);

  const densityCompactStyle = useMemo(() => {
    return { width: '34px', height: '32px', border: 'none', borderRadius: 'var(--radius-sm)', background: !comfy ? 'var(--color-surface)' : 'transparent', color: !comfy ? 'var(--color-primary)' : 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: !comfy ? 'var(--shadow-xs)' : 'none' };
  }, [comfy]);

  const tabStyle = useCallback((active: boolean) => {
    return { height: '34px', padding: '0 16px', border: 'none', borderRadius: 'var(--radius-sm)', background: active ? 'var(--color-surface)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, boxShadow: active ? 'var(--shadow-xs)' : 'none', letterSpacing: '-0.005em' };
  }, []);

  const segStyle = useCallback((active: boolean) => {
    return { height: '30px', padding: '0 12px', border: 'none', borderRadius: 'var(--radius-sm)', background: active ? 'var(--color-surface)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, boxShadow: active ? 'var(--shadow-xs)' : 'none' };
  }, []);

  const laneRowStyle: CSSProperties = useMemo(() => {
    return { display: 'flex', gap: '14px', padding: '14px 18px', overflowX: 'auto', overflowY: 'hidden', flex: 1, minHeight: 0, position: 'relative' };
  }, []);

  const containerStyle: CSSProperties = useMemo(() => {
    if (focus) {
      return { position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden' };
    }
    return { display: 'flex', flexDirection: 'column', flex: '1 1 0%', minHeight: 0, overflow: 'hidden' };
  }, [focus]);

  const showBulkBar = selectMode && Object.values(selected).some(Boolean);
  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div style={containerStyle}>
      {/* workspace operational toolbar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '10px 18px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
        
        {/* LEFT: kitchen context + station selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--color-text)' }}>Main Kitchen</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: isError ? 'var(--color-danger)' : isRealtimeConnected ? 'var(--color-success)' : 'var(--color-warning)', display: 'inline-block' }}></span>
              {isError ? 'Failed to load orders' : isLoading ? 'Loading orders…' : isRealtimeConnected ? 'Live · Dinner · Shift 2' : 'Reconnecting · Live orders unavailable'}
            </span>
          </div>
          {isError && (
            <button
              type="button"
              onClick={() => void refetch()}
              style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-danger)', background: 'transparent', border: '1px solid var(--color-danger)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}
            >
              Retry
            </button>
          )}
          <div style={{ width: '1px', height: '30px', background: 'var(--color-border)', margin: '0 2px' }}></div>
          <div style={{ display: 'flex', gap: '3px', background: 'var(--color-surface-3)', padding: '3px', borderRadius: 'var(--radius-md)' }}>
            {MODES.map(m => (
              <button key={m.key} type="button" onClick={() => { setViewMode(m.key); setQuery(''); }} style={tabStyle(viewMode === m.key)}>{m.label}</button>
            ))}
          </div>
        </div>

        {/* CENTER: operational metrics */}
        {!focus && (
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', minWidth: '100px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Active Orders</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={metrics.activeStyle}>{metrics.active}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{metrics.activeHint}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', minWidth: '100px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Delayed</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={metrics.delayedStyle}>{metrics.delayed}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{metrics.delayedHint}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', minWidth: '100px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Avg Prep</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={metrics.avgStyle}>{metrics.avg}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>target 12:00</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', minWidth: '100px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>SLA</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={metrics.slaStyle}>{metrics.sla}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>goal ≥95%</span>
              </div>
            </div>
          </div>
        )}

        {/* RIGHT: workspace controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexShrink: 0 }}>
          {/* Filter query search bar */}
          {!isHistory && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: '10px', display: 'inline-flex', alignItems: 'center' }}><IcoSearch /></span>
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter tickets…" style={{ height: '38px', width: '150px', padding: '0 12px 0 32px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontFamily: 'var(--font-sans)', color: 'var(--color-text)', background: 'var(--color-surface)', outline: 'none' }} />
            </div>
          )}
          
          {!isHistory && (
            <button type="button" onClick={() => setAutoSort(prev => !prev)} style={autoSortStyle} title="Auto-sort lanes by SLA urgency">
              <IcoSort />
              Auto-sort
            </button>
          )}

          <div style={{ display: 'flex', gap: '3px', background: 'var(--color-surface-3)', padding: '3px', borderRadius: 'var(--radius-md)' }}>
            <button type="button" onClick={() => setDensity('comfortable')} style={densityComfyStyle} title="Comfortable density"><IcoComfy /></button>
            <button type="button" onClick={() => setDensity('compact')} style={densityCompactStyle} title="Compact density"><IcoCompact /></button>
          </div>

          {!isHistory && (
            <button type="button" onClick={() => { setSelectMode(prev => !prev); clearSel(); }} style={selectStyle} title="Bulk select"><IcoSelect />Select</button>
          )}

          <button type="button" onClick={() => setFocus(prev => !prev)} style={focusStyle} title="Focus mode — hide chrome, maximize tickets"><IcoFocus />Focus</button>
        </div>
      </div>

      {/* LEVEL 2: STATION FILTER (board / station / expedite views) */}
      {isStation && !focus && (
        <div className="kds-scroll" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 18px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', overflowX: 'auto' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>Station</span>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-3)', padding: '3px', borderRadius: 'var(--radius-md)', flexShrink: 0 }}>
            {STATION_LIST.map(s => (
              <button key={s} type="button" onClick={() => setStation(s)} style={segStyle(station === s)}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* LEVEL 2: HISTORY FILTER BAR */}
      {isHistory && (
        <div className="kds-scroll" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '14px', padding: '9px 18px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '3px', background: 'var(--color-surface-3)', padding: '3px', borderRadius: 'var(--radius-md)', flexShrink: 0 }}>
            <button type="button" onClick={() => setHistTime('today')} style={segStyle(histTime === 'today')}>Today</button>
            <button type="button" onClick={() => setHistTime('hour')} style={segStyle(histTime === 'hour')}>Last Hour</button>
          </div>
          <span style={{ width: '1px', height: '26px', background: 'var(--color-border)', flexShrink: 0 }}></span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Station</span>
            <select value={histStation} onChange={(e) => setHistStation(e.target.value)} style={{ height: '36px', padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontFamily: 'var(--font-sans)', color: 'var(--color-text)', background: 'var(--color-surface)', cursor: 'pointer', outline: 'none' }}>
              {STATION_LIST.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Order type</span>
            <select value={histType} onChange={(e) => setHistType(e.target.value)} style={{ height: '36px', padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontFamily: 'var(--font-sans)', color: 'var(--color-text)', background: 'var(--color-surface)', cursor: 'pointer', outline: 'none' }}>
              <option value="All">All</option>
              <option value="T">Dine-in (T)</option>
              <option value="DEL">Delivery (DEL)</option>
              <option value="PUP">Pickup (PUP)</option>
            </select>
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ position: 'absolute', left: '10px', display: 'inline-flex', alignItems: 'center' }}><IcoSearch /></span>
            <input type="text" value={histQuery} onChange={(e) => setHistQuery(e.target.value)} placeholder="Search ticket…" style={{ height: '36px', width: '170px', padding: '0 12px 0 32px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontFamily: 'var(--font-sans)', color: 'var(--color-text)', background: 'var(--color-surface)', outline: 'none' }} />
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-tertiary)', flexShrink: 0, whiteSpace: 'nowrap' }}>{historyTickets.length} tickets</span>
        </div>
      )}

      {/* EXPEDITE RAIL */}
      {expediteShow && (
        <div className="kds-scroll" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 18px', background: 'var(--color-danger-bg)', borderBottom: '1px solid var(--color-danger-border)', overflowX: 'auto' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-danger)' }}>
            <IcoFlame />
            Expedite Queue
            <span style={{ minWidth: '20px', height: '18px', padding: '0 6px', borderRadius: 'var(--radius-full)', background: 'var(--color-danger)', color: '#fff', fontSize: '11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)' }}>{expediteTickets.length}</span>
          </span>
          {expediteTickets.map(e => (
            <div key={e.id} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '9px', padding: '6px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-danger-border)', borderLeft: '4px solid ' + e.accent, borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xs)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '14px', color: 'var(--color-text)' }}>{e.no}</span>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{e.station}</span>
              {e.vip && <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 'var(--radius-xs)', background: 'var(--amber-100)', color: 'var(--amber-700)' }}>VIP</span>}
              <span style={e.timerStyle}>
                <span>{e.timer}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* WORKFLOW LANES / STATION COLUMNS / EXPEDITE GRID */}
      {!isHistory && (
        <div style={laneRowStyle}>
          {lanes.map(lane => (
            <section key={lane.key} data-screen-label={lane.title} style={lane.laneStyle}>
              <div style={lane.headStyle}>
                <span style={lane.dotStyle}></span>
                <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text)' }}>{lane.title}</span>
                <span style={lane.countStyle}>{lane.count}</span>
              </div>
              <div className="kds-scroll" style={lane.bodyStyle}>
                {lane.tickets.map(t => (
                  <article key={t.id} style={t.cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      {selectMode && t.lane !== 'completed' && (
                        <button type="button" onClick={t.onSelectToggle} style={t.checkboxStyle}>
                          {t.selected && <IcoCheckMini />}
                        </button>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                          <span style={orderNoStyle}>{t.no}</span>
                          <span style={t.otPrimaryStyle}>{t.otPrimary}</span>
                          {t.otHasFulfill && <span style={t.otFulfillStyle}>{t.otFulfill}</span>}
                          {t.vip && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 'var(--radius-xs)', background: 'var(--amber-500)', color: '#fff' }}>EXPEDITE</span>}
                          {t.isFireTogether && <span style={t.fireTogetherStyle}><IcoFlame size={12} />Fire Together</span>}
                          {t.isHold && <span style={t.holdBadgeStyle}><IcoPause size={11} />Hold</span>}
                        </div>
                        <span style={metaStyle}>{t.metaLine}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                        <span style={t.timerStyle}>
                          {t.uClock && <IcoClock size={16} />}
                          {t.uWarn && <IcoWarn size={16} />}
                          {t.uCrit && <IcoCrit size={16} />}
                          {t.uDone && <IcoDone size={16} />}
                          <span>{t.timer}</span>
                        </span>
                        <span style={t.pillStyle}>{t.pillText}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={t.progWrapStyle}>
                        <div style={t.progHeadStyle}>
                          <span style={t.progValStyle}>{t.progLabel}</span>
                          <span style={{ color: 'var(--color-text-tertiary)' }}>{t.progPctText}</span>
                        </div>
                        <div style={t.progTrackStyle}><div style={t.progFillStyle}></div></div>
                      </div>
                      {t.showSliceNote && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', alignSelf: 'flex-start', marginTop: '8px', padding: '2px 8px', background: 'var(--color-surface-3)', color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontWeight: 600 }}><IcoLink />{t.sliceNote}</span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', marginTop: '9px', background: 'var(--color-surface-3)', borderRadius: 'var(--radius-xs)' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Item</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Station</span>
                      </div>
                      {t.items.map((it: any) => (
                        <div key={it.idx} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '11px 2px', borderBottom: '1px solid var(--color-border)' }}>
                          <button type="button" onClick={it.onClick} style={it.indStyle} title="Tap to advance item" disabled={t.lane === 'completed'}>
                            {it.isReady && <IcoCheckItemReady />}
                            {it.isPreparing && <IcoCheckItemPrep />}
                          </button>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                            <span style={itemQnStyle}><span style={it.rowTextStyle}>{it.qn}</span></span>
                            {it.hasMods && <span style={modStyle}>{it.modsText}</span>}
                          </div>
                          <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', flexShrink: 0 }}>{it.station}</span>
                        </div>
                      ))}
                      {t.allergy && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', alignSelf: 'flex-start', marginTop: '9px', padding: '3px 8px', background: 'var(--color-danger-bg)', color: 'var(--color-danger)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 600 }}><IcoWarn size={13} />Allergy: {t.allergy}</span>
                      )}
                      {t.special && (
                        <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '5px', alignSelf: 'flex-start', marginTop: '9px', padding: '3px 8px', background: 'var(--color-info-bg)', color: 'var(--color-info)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 500 }}><IcoInfo size={13} style={{ flexShrink: 0, marginTop: '1px' }} />{t.special}</span>
                      )}
                    </div>

                    {t.showReadyBanner && (
                      <div style={t.readyBannerStyle}>
                        <IcoDone size={17} />
                        <span style={t.readyWaitStyle}>{t.readyWaitText}</span>
                      </div>
                    )}

                    {t.isActive && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        <button type="button" onClick={t.onPrimary} style={allBarStyle} className="hover:opacity-90">{t.barLabel}</button>
                      </div>
                    )}
                    {t.isActive && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                        <button type="button" onClick={t.onHold} style={holdBtnStyle} title="Hold / resume" className="hover:opacity-90">
                          {t.isHold ? <IcoPlay size={18} /> : <IcoPause size={18} />}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {lane.empty && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '32px 12px', textAlign: 'center' }}>
                    <IcoFolder />
                    <span style={{ fontSize: '13px', color: 'var(--color-text-tertiary)' }}>No tickets</span>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* HISTORY TABLE */}
      {isHistory && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '14px 18px', overflow: 'hidden' }}>
          <div className="kds-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '12px 18px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>Ticket</th>
                  <th style={{ position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '12px 18px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>Completed</th>
                  <th style={{ position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '12px 18px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>Prep time</th>
                  <th style={{ position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '12px 18px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>Station</th>
                  <th style={{ position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '12px 18px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>Order type</th>
                  <th style={{ position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '12px 18px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>Staff</th>
                </tr>
              </thead>
              <tbody>
                {historyTickets.map(h => (
                  <tr key={h.id} style={h.rowStyle}>
                    <td style={{ padding: '13px 18px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '14px', color: 'var(--color-text)' }}>{h.no}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>{h.id}</span>
                      </div>
                    </td>
                    <td style={{ padding: '13px 18px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--color-text)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{h.completedClock}</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{h.agoText}</span>
                      </div>
                    </td>
                    <td style={{ padding: '13px 18px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '13px', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{h.prepDur}</span></td>
                    <td style={{ padding: '13px 18px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{h.station}</td>
                    <td style={{ padding: '13px 18px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={h.otPrimaryStyle}>{h.otPrimary}</span>
                        {h.otHasFulfill && <span style={h.otFulfillStyle}>{h.otFulfill}</span>}
                      </div>
                    </td>
                    <td style={{ padding: '13px 18px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap', fontSize: '13px', color: 'var(--color-text)' }}>{h.staff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {historyTickets.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '56px 16px', textAlign: 'center' }}>
                <IcoClock size={26} />
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>No completed tickets</span>
                <span style={{ fontSize: '13px', color: 'var(--color-text-tertiary)' }}>Tickets you complete will appear here with prep times and staff.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* BULK ACTION BAR */}
      {showBulkBar && (
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '22px', display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px 10px 18px', background: 'var(--color-text)', color: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', zIndex: 20 }}>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>{selectedCount} selected</span>
          <span style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.2)' }}></span>
          <button type="button" onClick={advanceSelected} style={{ height: '38px', padding: '0 16px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--color-primary)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
            Advance stage
          </button>
          <button type="button" onClick={completeSelected} style={{ height: '38px', padding: '0 16px', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Complete all</button>
          <button type="button" onClick={clearSel} style={{ height: '38px', padding: '0 12px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'rgba(255,255,255,0.65)', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>Clear</button>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'absolute', right: '22px', bottom: '22px', padding: '11px 16px', background: 'var(--color-text)', color: '#fff', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', fontSize: '13px', fontWeight: 500, zIndex: 30 }}>{toast}</div>
      )}
    </div>
  );
}

const MODES = [
  { key: 'live' as const, label: 'Live Board' },
  { key: 'expedite' as const, label: 'Expedite View' },
  { key: 'station' as const, label: 'Station View' },
  { key: 'history' as const, label: 'History' },
];

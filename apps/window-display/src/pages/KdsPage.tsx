import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compareMenuItemsAlphabetically } from '../../../../shared/menu/menuData.mjs';
import { useKdsDeviceAuthStore } from '../store/kdsDeviceAuth.store';

const VENUE_ID = import.meta.env['VITE_VENUE_ID'] || '';
const API_BASE = import.meta.env['VITE_API_URL'] || '';

function authHeaders(): Record<string, string> {
  const token = useKdsDeviceAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Design tokens — matches KitchenDisplay.html palette
const C = {
  bg:           '#0D1117',
  surface:      '#161B27',
  elevated:     '#1F2637',
  border:       '#252B3D',
  brand:        '#16A34A',
  brandBg:      'rgba(22,163,74,0.15)',
  brandBorder:  'rgba(22,163,74,0.3)',
  teal:         '#1DB8B8',
  tealBg:       'rgba(29,184,184,0.15)',
  tealBorder:   'rgba(29,184,184,0.3)',
  amber:        '#F59E0B',
  amberBg:      'rgba(245,158,11,0.12)',
  amberBorder:  'rgba(245,158,11,0.3)',
  danger:       '#EF4444',
  dangerBg:     'rgba(239,68,68,0.12)',
  dangerBorder: 'rgba(239,68,68,0.3)',
  blue:         '#3B82F6',
  blueBg:       'rgba(59,130,246,0.15)',
  blueBorder:   'rgba(59,130,246,0.3)',
  emerald:      '#10B981',
  emeraldBg:    'rgba(16,185,129,0.15)',
  emeraldBorder:'rgba(16,185,129,0.3)',
  text:         '#F0F1F8',
  textSec:      '#8890A8',
  textMuted:    '#5A6080',
  mono:         "'ui-monospace','SFMono-Regular','Cascadia Code',monospace",
} as const;

type StatusConfig = { label: string; color: string; bg: string; border: string; action: string };

const STATUS_CONFIRMED: StatusConfig = { label: 'CONFIRMED', color: C.blue,    bg: C.blueBg,    border: C.blueBorder,    action: 'START PREPARING' };
const STATUS_PREPARING: StatusConfig = { label: 'PREPARING', color: C.emerald, bg: C.emeraldBg, border: C.emeraldBorder, action: 'MARK READY'       };
const STATUS_READY:     StatusConfig = { label: 'READY',     color: C.teal,    bg: C.tealBg,    border: C.tealBorder,    action: 'COMPLETE ORDER'   };

const STATUS: Record<string, StatusConfig> = {
  confirmed: STATUS_CONFIRMED,
  preparing: STATUS_PREPARING,
  ready:     STATUS_READY,
};

function getStatus(s: string): StatusConfig {
  return STATUS[s] ?? STATUS_CONFIRMED;
}

interface OrderItem {
  id: string;
  menuItemTitle: string;
  menuItemCategory: string;
  quantity: number;
  selectedModifiers: { name: string; priceDeltaCents: number }[];
  notes: string | null;
}

interface Order {
  id: string;
  venueId: string;
  tableNumber: string | null;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  totalCents: number;
  notes: string | null;
  submittedAt: string;
  items: OrderItem[];
}

// ── Elapsed helpers ──────────────────────────────────────────────────────────

function elapsedMs(submittedAt: string, now: Date): number {
  return now.getTime() - new Date(submittedAt).getTime();
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function elapsedColor(ms: number): string {
  const mins = ms / 60000;
  if (mins >= 15) return C.danger;
  if (mins >= 8)  return C.amber;
  return C.textMuted;
}

function elapsedBorder(ms: number, status: string): string {
  const mins = ms / 60000;
  if (mins >= 15) return C.dangerBorder;
  const s = STATUS[status];
  return s ? s.border : C.border;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatPill({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
      <span style={{ fontSize: 26, fontWeight: 900, color: C.text, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11, color: C.textSec, fontWeight: 600, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      {sub && <span style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>{sub}</span>}
    </div>
  );
}

function Badge({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10, fontWeight: 800, letterSpacing: '0.07em',
      color, background: bg, border: `1px solid ${border}`,
      borderRadius: 20, padding: '2px 9px',
    }}>{label}</span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function KdsPage() {
  const queryClient  = useQueryClient();
  const [wsConnected, setWsConnected] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Tick every second for live elapsed timers + clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // 1. REST fetch on mount
  const { data: orders = [], isLoading, isError, refetch } = useQuery<Order[]>({
    queryKey: ['kds', 'orders', VENUE_ID],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/orders?venueId=${VENUE_ID}&activeOnly=true`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to load active kitchen orders');
      return res.json();
    },
    enabled: Boolean(VENUE_ID),
  });

  // 2. WebSocket for live pushes
  useEffect(() => {
    if (!VENUE_ID) return;

    const socket = io(API_BASE, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      auth: { token: useKdsDeviceAuthStore.getState().accessToken },
    });

    socket.on('connect', () => {
      setWsConnected(true);
      socket.emit('joinVenue', { venueId: VENUE_ID });
      void refetch();
    });

    socket.on('disconnect', () => setWsConnected(false));

    socket.on('orderUpdate', (updated: Order) => {
      queryClient.setQueryData(['kds', 'orders', VENUE_ID], (old: Order[] | undefined) => {
        if (!old) return [updated];
        const active = ['confirmed', 'preparing', 'ready'].includes(updated.status);
        const exists = old.some(o => o.id === updated.id);
        if (active) {
          return exists ? old.map(o => o.id === updated.id ? updated : o) : [updated, ...old];
        }
        return old.filter(o => o.id !== updated.id);
      });
    });

    return () => { socket.disconnect(); };
  }, [queryClient, refetch]);

  // 3. Status mutation
  const mutate = useMutation({
    mutationFn: async ({ orderId, nextStatus }: { orderId: string; nextStatus: string }) => {
      const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error('Failed to update order status');
      return res.json() as Promise<Order>;
    },
    onSuccess: (updated: Order) => {
      queryClient.setQueryData(['kds', 'orders', VENUE_ID], (old: Order[] | undefined) => {
        if (!old) return [];
        const active = ['confirmed', 'preparing', 'ready'].includes(updated.status);
        return active ? old.map(o => o.id === updated.id ? updated : o) : old.filter(o => o.id !== updated.id);
      });
    },
  });

  const [itemStatuses, setItemStatuses] = useState<Record<string, 'new' | 'preparing' | 'ready'>>({});

  const getItemStatus = (itemId: string, orderStatus: string): 'new' | 'preparing' | 'ready' => {
    if (itemStatuses[itemId]) return itemStatuses[itemId]!;
    if (orderStatus === 'confirmed') return 'new';
    if (orderStatus === 'preparing') return 'preparing';
    return 'ready';
  };

  const startPrepItem = (order: Order, itemIdx: number) => {
    const item = order.items[itemIdx];
    if (!item) return;

    setItemStatuses(prev => ({ ...prev, [item.id]: 'preparing' }));

    if (order.status === 'confirmed') {
      mutate.mutate({ orderId: order.id, nextStatus: 'preparing' });
    }
  };

  const markReadyItem = (order: Order, itemIdx: number) => {
    const item = order.items[itemIdx];
    if (!item) return;

    setItemStatuses(prev => {
      const nextMap = { ...prev, [item.id]: 'ready' as const };
      
      const allReady = order.items.every((it, idx) => {
        const status = idx === itemIdx ? 'ready' : (nextMap[it.id] || (order.status === 'preparing' ? 'preparing' : order.status === 'confirmed' ? 'new' : 'ready'));
        return status === 'ready';
      });

      if (allReady) {
        if (order.status === 'preparing' || order.status === 'confirmed') {
          mutate.mutate({ orderId: order.id, nextStatus: 'ready' });
        }
      }

      return nextMap;
    });
  };

  const advance = (orderId: string, current: string) => {
    const next: Record<string, string> = { confirmed: 'preparing', preparing: 'ready', ready: 'completed' };
    if (next[current]) mutate.mutate({ orderId, nextStatus: next[current] });
  };

  const cancel = (orderId: string) => mutate.mutate({ orderId, nextStatus: 'cancelled' });

  // ── Derived stats ──────────────────────────────────────────────────────────
  const filteredOrders = orders.filter(
    order => !order.tableNumber || (parseInt(order.tableNumber, 10) >= 1 && parseInt(order.tableNumber, 10) <= 18)
  );

  const sorted = [...filteredOrders].sort((a, b) =>
    new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
  );

  const byStatus = (s: string) => filteredOrders.filter(o => o.status === s).length;

  const maxElapsedMs = filteredOrders.length
    ? Math.max(...filteredOrders.map(o => elapsedMs(o.submittedAt, now)))
    : 0;

  // ── Early returns ──────────────────────────────────────────────────────────
  if (!VENUE_ID) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: C.danger, fontWeight: 700 }}>VITE_VENUE_ID is not configured.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${C.brand}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'kds-spin 0.8s linear infinite' }} />
        <p style={{ color: C.textSec, fontSize: 15 }}>Loading KDS feed…</p>
        <style>{`@keyframes kds-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: C.danger, fontWeight: 700, fontSize: 16 }}>Failed to load KDS feed — reconnecting…</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, display: 'flex', flexDirection: 'column', fontFamily: "'Inter','Helvetica Neue',system-ui,sans-serif", userSelect: 'none' }}>
      <style>{`
        @keyframes kds-spin { to { transform: rotate(360deg); } }
        @keyframes kds-pulse-border { 0%,100% { border-color: rgba(239,68,68,0.6); } 50% { border-color: rgba(239,68,68,0.15); } }
        .kds-urgent { animation: kds-pulse-border 1.8s ease-in-out infinite; }
        .kds-btn:active { transform: scale(0.97); }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #252B3D; border-radius: 3px; }
      `}</style>

      {/* ── Header ── */}
      <header style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 30 }}>
        {/* Branding + connection row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: C.brand, fontWeight: 900, fontSize: 20, letterSpacing: '0.06em', lineHeight: 1 }}>
              VERDURA KDS
            </span>
            <span style={{ color: C.brand, background: C.brandBg, border: `1px solid ${C.brandBorder}`, borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.07em' }}>
              KITCHEN QUEUE
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Live clock */}
            <span style={{ fontFamily: C.mono, fontSize: 14, color: C.textSec, letterSpacing: '0.04em' }}>
              {now.toLocaleTimeString()}
            </span>

            <div style={{ width: 1, height: 20, background: C.border }} />

            {/* WS status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: wsConnected ? C.brand : C.danger,
                display: 'inline-block',
                boxShadow: wsConnected ? `0 0 8px ${C.brand}` : 'none',
              }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: wsConnected ? C.brand : C.danger }}>
                {wsConnected ? 'Live' : 'Reconnecting…'}
              </span>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderTop: `1px solid ${C.border}`, background: C.elevated }}>
          {[
            { value: orders.length,         label: 'Active Orders',  sub: 'in queue'          },
            { value: byStatus('confirmed'),  label: 'Confirmed',      sub: 'not yet started'   },
            { value: byStatus('preparing'),  label: 'Preparing',      sub: 'on the line'       },
            { value: byStatus('ready'),      label: 'Ready',          sub: 'awaiting pickup'   },
            { value: formatElapsed(maxElapsedMs), label: 'Oldest Ticket', sub: 'elapsed time'  },
          ].map((s, i) => (
            <div key={i} style={{
              flex: 1, padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: i < 4 ? `1px solid ${C.border}` : 'none',
            }}>
              <StatPill value={s.value} label={s.label} sub={s.sub} />
            </div>
          ))}
        </div>
      </header>

      {/* ── Offline banner ── */}
      {!wsConnected && (
        <div style={{
          background: C.dangerBg, borderBottom: `1px solid ${C.dangerBorder}`,
          color: '#FCA5A5', padding: '10px 24px',
          textAlign: 'center', fontSize: 13, fontWeight: 700, letterSpacing: '0.03em',
        }}>
          ⚠ KDS OFFLINE — Active tickets may be stale. Attempting to reconnect…
        </div>
      )}

      {/* ── Ticket grid ── */}
      <main style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {sorted.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 }}>
            <span style={{ fontSize: 64, lineHeight: 1 }}>🍽</span>
            <span style={{ fontSize: 28, fontWeight: 900 }}>All Clear</span>
            <span style={{ color: C.textSec, fontSize: 15, maxWidth: 360, textAlign: 'center' }}>
              No active orders in the kitchen. New tickets will appear here in real time.
            </span>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}>
            {sorted.map(order => {
              const ms     = elapsedMs(order.submittedAt, now);
              const isUrgent = ms / 60000 >= 15;
              const sc     = getStatus(order.status);
              const shortId = order.id.substring(0, 8).toUpperCase();
              const tableLabel = order.tableNumber ? `T${order.tableNumber}` : 'Takeaway';
              const displayOrderId = order.id.startsWith('ORD-') ? order.id : `#${shortId}`;

              return (
                <div
                  key={order.id}
                  className={isUrgent ? 'kds-urgent' : ''}
                  style={{
                    background: C.surface,
                    border: `2px solid ${elapsedBorder(ms, order.status)}`,
                    borderRadius: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    opacity: !wsConnected ? 0.82 : 1,
                    transition: 'opacity 0.3s',
                  }}
                >
                  {/* Card header */}
                  <div style={{
                    padding: '16px 20px 14px',
                    background: C.elevated,
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}>
                    <div>
                      <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{tableLabel}</div>
                      <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                        {displayOrderId}
                        {!wsConnected && (
                          <span style={{ marginLeft: 6, color: C.danger, fontSize: 9, fontWeight: 800, background: C.dangerBg, border: `1px solid ${C.dangerBorder}`, borderRadius: 4, padding: '1px 5px' }}>STALE</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                      <Badge label={sc.label} color={sc.color} bg={sc.bg} border={sc.border} />
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        fontFamily: C.mono, fontSize: 13, fontWeight: 700,
                        color: elapsedColor(ms),
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        {formatElapsed(ms)}
                      </div>
                    </div>
                  </div>

                  {/* Items */}
                  <div style={{ flex: 1, padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[...order.items].sort(compareMenuItemsAlphabetically).map((item, idx, sortedItems) => (
                      <div
                        key={item.id}
                        style={{
                          paddingBottom: 12,
                          borderBottom: idx < sortedItems.length - 1 ? `1px solid ${C.border}` : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{
                            color: C.brand, fontFamily: C.mono, fontSize: 13, fontWeight: 800,
                            background: C.brandBg, border: `1px solid ${C.brandBorder}`,
                            borderRadius: 6, padding: '1px 7px', flexShrink: 0,
                          }}>{item.quantity}×</span>
                          <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{item.menuItemTitle}</span>
                        </div>

                        {item.selectedModifiers.length > 0 && (
                          <div style={{ fontSize: 12, color: C.teal, fontWeight: 600, marginTop: 5, marginLeft: 36 }}>
                            + {item.selectedModifiers.map(m => m.name).join(', ')}
                          </div>
                        )}

                        {item.notes && (
                          <div style={{
                            fontSize: 11, color: '#FCA5A5', fontStyle: 'italic',
                            background: C.dangerBg, border: `1px solid ${C.dangerBorder}`,
                            borderRadius: 6, padding: '4px 9px', marginTop: 5, marginLeft: 36,
                          }}>"{item.notes}"</div>
                        )}

                        {/* Item prep status controls */}
                        <div style={{ marginLeft: 36, marginTop: 8 }}>
                          {getItemStatus(item.id, order.status) === 'new' && (
                            <button
                              type="button"
                              className="kds-btn"
                              onClick={() => startPrepItem(order, idx)}
                              style={{
                                padding: '4px 10px',
                                background: C.blueBg, border: `1px solid ${C.blueBorder}`,
                                borderRadius: 6, color: C.blue,
                                fontSize: 11, fontWeight: 800, cursor: 'pointer',
                              }}
                            >
                              Start Prep
                            </button>
                          )}
                          {getItemStatus(item.id, order.status) === 'preparing' && (
                            <button
                              type="button"
                              className="kds-btn"
                              onClick={() => markReadyItem(order, idx)}
                              style={{
                                padding: '4px 10px',
                                background: C.emeraldBg, border: `1px solid ${C.emeraldBorder}`,
                                borderRadius: 6, color: C.emerald,
                                fontSize: 11, fontWeight: 800, cursor: 'pointer',
                              }}
                            >
                              Mark Ready
                            </button>
                          )}
                          {getItemStatus(item.id, order.status) === 'ready' && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 12, fontWeight: 700, color: C.emerald,
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Ready
                            </span>
                          )}
                        </div>
                      </div>
                    ))}

                    {order.notes && (
                      <div style={{
                        padding: '10px 13px', background: C.bg,
                        border: `1px solid ${C.border}`, borderRadius: 8,
                        fontSize: 12, color: C.textSec, fontFamily: C.mono,
                      }}>
                        <span style={{ color: C.text, fontWeight: 700 }}>Notes: </span>{order.notes}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{
                    padding: '14px 20px',
                    background: C.elevated,
                    borderTop: `1px solid ${C.border}`,
                    display: 'flex', gap: 9,
                  }}>
                    <button
                      className="kds-btn"
                      onClick={() => cancel(order.id)}
                      style={{
                        padding: '10px 14px',
                        background: C.dangerBg, border: `1px solid ${C.dangerBorder}`,
                        borderRadius: 10, color: '#FCA5A5',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        transition: 'background 0.15s',
                        flexShrink: 0,
                      }}
                    >
                      Cancel
                    </button>
                    {order.status === 'ready' && (
                      <button
                        className="kds-btn"
                        onClick={() => advance(order.id, order.status)}
                        disabled={mutate.isPending}
                        style={{
                          flex: 1, padding: '11px 14px',
                          background: sc.color, border: 'none',
                          borderRadius: 10, color: '#fff',
                          fontSize: 13, fontWeight: 900, letterSpacing: '0.05em',
                          cursor: mutate.isPending ? 'not-allowed' : 'pointer',
                          opacity: mutate.isPending ? 0.7 : 1,
                          transition: 'opacity 0.15s, transform 0.1s',
                        }}
                      >
                        {sc.action}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

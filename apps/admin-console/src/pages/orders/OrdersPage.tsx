import { useState, useEffect, useMemo, useRef } from 'react';
import {
  mapLiveOrderToAdminOrder,
  useLiveOrders,
  type AdminOrder as Order,
  type PaymentStatus,
} from '../../shared/orders';
import { compareMenuItemsAlphabetically } from '../../shared/menu/menuData';

// ── Icons (SVG components matching Verdura design) ───────────────────────────

const IconImport = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

const IconExport = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 9l5-5 5 5M12 4v12" />
  </svg>
);

const IconPrint = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </svg>
);

const IconDuplicate = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const IconDelete = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
  </svg>
);

const IconMore = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </svg>
);

const IconClose = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const IconCheck = ({ className = "w-3 h-3" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const IconChevronDown = ({ className = "" }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const IconFunnel = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
);

// Dish glyph render helpers
const getDishGlyph = (dish: string) => {
  const stroke = "currentColor";
  const path = {
    pizza: '<circle cx="12" cy="12" r="9"></circle><circle cx="9" cy="10" r="1"></circle><circle cx="14" cy="9" r="1"></circle><circle cx="13" cy="14" r="1"></circle>',
    salad: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-9 10Z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6"></path>',
    burger: '<path d="M3 11h18M4 15h16a2 2 0 0 1 0 4H4a2 2 0 0 1 0-4ZM5 11a7 7 0 0 1 14 0"></path>',
    pasta: '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path>',
    drink: '<path d="M9 2h6M10 2v3.5L8 8v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8l-2-2.5V2"></path>',
    dessert: '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path>'
  }[dish] || '<circle cx="12" cy="12" r="9"></circle>';
  
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: path }} />
  );
};

const getDishColors = (dish: string) => {
  return {
    pizza: { bg: 'bg-amber-100', text: 'text-amber-700' },
    salad: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    burger: { bg: 'bg-amber-100', text: 'text-amber-700' },
    pasta: { bg: 'bg-violet-100', text: 'text-violet-600' },
    drink: { bg: 'bg-blue-100', text: 'text-blue-700' },
    dessert: { bg: 'bg-violet-100', text: 'text-violet-600' }
  }[dish] || { bg: 'bg-gray-100', text: 'text-gray-700' };
};

const getTypeIcon = (type: string) => {
  const path = {
    'Delivery': '<path d="M5 18H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11M14 9h4l3 3v5a1 1 0 0 1-1 1h-1"></path><circle cx="7.5" cy="18.5" r="2"></circle><circle cx="17.5" cy="18.5" r="2"></circle>',
    'Takeaway': '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0"></path>',
    'Dine-in': '<path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2M5 2v20M21 15V2a5 5 0 0 0-2 4v6c0 1.66 2 3 2 3Z"></path>'
  }[type] || '<circle cx="12" cy="12" r="9"></circle>';
  
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-405" dangerouslySetInnerHTML={{ __html: path }} />
  );
};

// ── Types ──────────────────────────────────────────────────────────────────────

type DetailTab = 'items' | 'delivery' | 'docs';

// Avatars colors array
const AVATAR_PALETTES = [
  { bg: 'bg-emerald-100 text-emerald-700' },
  { bg: 'bg-blue-100 text-blue-700' },
  { bg: 'bg-amber-100 text-amber-700' },
  { bg: 'bg-violet-100 text-violet-600' },
];

export function OrdersPage() {
  const { data: liveOrders = [], isLoading, isError, refetch } = useLiveOrders();
  const orders = useMemo(() => liveOrders.map(mapLiveOrderToAdminOrder), [liveOrders]);

  // Interactive UI state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('items');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Dropdown states
  const [openDropdown, setOpenDropdown] = useState<'type' | 'status' | 'date' | null>(null);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<PaymentStatus[]>([]);
  const [filterDate, setFilterDate] = useState<string>('all');
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Show dynamic toast notifications
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2200);
  };

  // Sync with global topbar search input in AdminLayout
  useEffect(() => {
    const handleSearchInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      setSearchQuery(target.value || '');
    };
    
    const searchInput = document.querySelector('header input[type="search"]');
    if (searchInput) {
      searchInput.addEventListener('input', handleSearchInput);
      setSearchQuery((searchInput as HTMLInputElement).value || '');
    }
    
    return () => {
      if (searchInput) {
        searchInput.removeEventListener('input', handleSearchInput);
      }
    };
  }, []);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Format currency
  const formatMoney = (n: number) => {
    return '$' + n.toFixed(2);
  };

  // ── Dynamic statistics matching Verdura Order Page.html ───────────────────────
  
  const stats = useMemo(() => {
    // Derived entirely from real orders — no fabricated baseline. Reflects
    // whatever window useLiveOrders currently returns (all non-terminal-swept
    // orders for the venue), not a historical report.
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const totalOrders = orders.length;
    const totalItems = orders.reduce((sum, o) => sum + o.items, 0);

    const averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const averageItems = totalOrders > 0 ? totalItems / totalOrders : 0;

    const cancelledCount = orders.filter(o => o.orderStatus === 'delivered' && o.paymentStatus === 'refunded').length;
    const pendingCount = orders.filter(o => o.orderStatus === 'pending').length;
    const cancelledRate = totalOrders > 0 ? (cancelledCount / totalOrders) * 100 : 0;
    const pendingRate = totalOrders > 0 ? (pendingCount / totalOrders) * 100 : 0;

    // Average time from submission to service completion, for orders that
    // have actually reached a served/delivered state — real timestamps only.
    const completedDurationsMin = liveOrders
      .filter(o => (o.status === 'completed') && o.completedAt)
      .map(o => (new Date(o.completedAt!).getTime() - new Date(o.submittedAt).getTime()) / 60000)
      .filter(minutes => Number.isFinite(minutes) && minutes >= 0);
    const averageProcessingMinutes = completedDurationsMin.length > 0
      ? completedDurationsMin.reduce((a, b) => a + b, 0) / completedDurationsMin.length
      : null;

    return {
      totalRevenue,
      totalOrders,
      averageOrder,
      averageItems,
      cancelledRate,
      pendingRate,
      averageProcessingMinutes,
    };
  }, [orders, liveOrders]);

  // Real order-type mix (Dine-in / Takeaway / Delivery) derived from actual
  // orders — no fabricated channel percentages.
  const salesChannels = useMemo(() => {
    const types: Order['type'][] = ['Dine-in', 'Takeaway', 'Delivery'];
    const colors: Record<Order['type'], string> = { 'Dine-in': 'bg-emerald-600', 'Takeaway': 'bg-blue-500', 'Delivery': 'bg-violet-600' };
    const total = orders.length;
    return types.map(type => {
      const matching = orders.filter(o => o.type === type);
      const revenue = matching.reduce((sum, o) => sum + o.total, 0);
      const pct = total > 0 ? (matching.length / total) * 100 : 0;
      return { label: type, orders: matching.length, revenue, pct, color: colors[type] };
    }).filter(ch => ch.orders > 0);
  }, [orders]);

  // Real order-lifecycle status mix (not payment status, since payment
  // state isn't tracked by the backend yet — see PaymentStatus 'unknown').
  const orderStatusMix = useMemo(() => {
    const total = orders.length;
    const buckets: Array<{ label: string; color: string; count: number }> = [
      { label: 'Preparing', color: 'bg-emerald-600', count: orders.filter(o => o.orderStatus === 'preparing' || o.orderStatus === 'ready_to_serve').length },
      { label: 'Served', color: 'bg-blue-500', count: orders.filter(o => o.orderStatus === 'served').length },
      { label: 'Pending', color: 'bg-amber-500', count: orders.filter(o => o.orderStatus === 'pending').length },
      { label: 'Cancelled', color: 'bg-red-500', count: orders.filter(o => o.orderStatus === 'delivered' && o.paymentStatus === 'refunded').length },
    ].filter(b => b.count > 0);
    return buckets.map(b => ({ ...b, pct: total > 0 ? (b.count / total) * 100 : 0 }));
  }, [orders]);

  // ── Filters & Search ────────────────────────────────────────────────────────
  
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      // Search Box filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchId = o.id.toLowerCase().includes(q);
        const matchCustomer = o.customer.toLowerCase().includes(q);
        const matchEmail = o.email.toLowerCase().includes(q);
        const matchPhone = o.phone.toLowerCase().includes(q);
        if (!matchId && !matchCustomer && !matchEmail && !matchPhone) return false;
      }
      
      // Type filter
      if (filterTypes.length > 0 && !filterTypes.includes(o.type)) return false;
      
      // Status filter
      if (filterStatuses.length > 0 && !filterStatuses.includes(o.paymentStatus)) return false;
      
      // Date filter
      if (filterDate !== 'all' && o.date !== filterDate) return false;
      
      return true;
    });
  }, [orders, searchQuery, filterTypes, filterStatuses, filterDate]);

  // Handlers for Row/Header Checkboxes
  const isAllChecked = filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.includes(o.id));
  const hasSelection = selectedIds.length > 0;
  
  const handleToggleAll = () => {
    if (isAllChecked) {
      // Uncheck all in current view
      const viewIds = filteredOrders.map(o => o.id);
      setSelectedIds(prev => prev.filter(id => !viewIds.includes(id)));
    } else {
      // Check all in current view
      const viewIds = filteredOrders.map(o => o.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...viewIds])));
    }
  };

  const handleToggleRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleClearFilters = () => {
    setFilterTypes([]);
    setFilterStatuses([]);
    setFilterDate('all');
    setOpenDropdown(null);
  };

  const anyFilterActive = filterTypes.length > 0 || filterStatuses.length > 0 || filterDate !== 'all';

  // ── Actions ──────────────────────────────────────────────────────────────────

  // Bulk Actions
  const handleBulkDuplicate = () => {
    setSelectedIds([]);
    triggerToast('Order duplication is unavailable for live kitchen orders');
  };

  const handleBulkDelete = () => {
    setSelectedIds([]);
    setDetailId(null);
    triggerToast('Live orders cannot be deleted from the Orders view');
  };

  // Selected Order Detail Pane Object
  const selectedOrder = useMemo(() => {
    if (!detailId) return null;
    const o = orders.find(ord => ord.id === detailId);
    if (!o) return null;
    const initials = o.customer.split(' ').map(w => w[0]).slice(0, 2).join('');
    const palette = (AVATAR_PALETTES[parseInt(o.id.slice(-2), 10) % AVATAR_PALETTES.length] || AVATAR_PALETTES[0])!;
    
    return {
      ...o,
      initials,
      avBg: palette.bg,
    };
  }, [orders, detailId]);

  // Status visual attributes mapper
  const getStatusBadgeStyle = (status: PaymentStatus) => {
    const classes = {
      paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      unpaid: 'bg-red-50 text-red-700 border-red-200',
      partially_paid: 'bg-amber-50 text-amber-700 border-amber-200',
      refunded: 'bg-violet-50 text-violet-600 border-violet-200',
      pending_payment: 'bg-blue-50 text-blue-600 border-blue-200',
      // The backend doesn't persist a payment status, so most real orders
      // land here — kept visually neutral rather than implying "paid".
      unknown: 'bg-gray-50 text-gray-500 border-gray-200',
    }[status] || 'bg-gray-50 text-gray-700 border-gray-200';

    return `inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${classes}`;
  };

  const getStatusLabel = (status: PaymentStatus) => {
    return {
      paid: 'Paid',
      unpaid: 'Cancelled',
      partially_paid: 'Partially Paid',
      refunded: 'Refunded',
      pending_payment: 'Pending Payment',
      unknown: 'Not tracked',
    }[status] || status;
  };

  const getStatusIcon = (status: PaymentStatus) => {
    if (status === 'paid') return <IconCheck className="w-[10px] h-[10px]" />;
    if (status === 'unpaid') return <IconClose />;
    if (status === 'refunded') {
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
        </svg>
      );
    }
    return null;
  };

  const getOperationalStatus = (order: Order) => {
    if (order.paymentStatus === 'refunded' || order.paymentStatus === 'unpaid') return 'Cancelled';
    if (order.orderStatus === 'served' || order.orderStatus === 'delivered') {
      if (order.type === 'Dine-in') return 'Served';
      if (order.type === 'Delivery') return 'Delivered';
      return 'Picked Up';
    }
    return 'Preparing';
  };

  const getOperationalStatusStyle = (status: string) => {
    if (status === 'Preparing') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (status === 'Cancelled') return 'bg-red-50 text-red-600 border-red-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 text-gray-900 overflow-hidden h-full">
      <div className="flex-1 flex min-h-0 flex-col xl:flex-row">
        
        {/* ==================== LEFT SIDE: ORDERS TABLE ==================== */}
        <section className="flex-1 flex flex-col min-w-0 p-6 relative overflow-hidden h-full">
          <div className="flex-1 flex flex-col min-h-0">
            
            {/* Header: Title + Actions */}
            <div className="flex items-center justify-between gap-4 mb-5 shrink-0">
              <h2 className="text-[26px] font-semibold tracking-tight text-gray-950">Orders</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => triggerToast('Import orders from CSV')}
                  className="inline-flex items-center gap-2 h-9 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white border border-transparent shadow-sm transition-colors cursor-pointer select-none"
                >
                  <IconImport />Import
                </button>
                <button
                  onClick={() => triggerToast('Exporting all orders…')}
                  className="inline-flex items-center gap-2 h-9 px-4 text-sm font-semibold rounded-lg bg-white hover:bg-gray-50 text-gray-705 border border-gray-200 shadow-sm transition-colors cursor-pointer select-none"
                >
                  <IconExport />Export
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div ref={dropdownRef} className="flex items-center gap-2 mb-4 flex-wrap relative z-20 shrink-0 select-none">
              
              {/* Type Filter */}
              <div className="relative">
                <button
                  onClick={() => setOpenDropdown(prev => prev === 'type' ? null : 'type')}
                  className={`inline-flex items-center gap-1.5 h-[34px] px-3.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    filterTypes.length > 0 || openDropdown === 'type'
                      ? 'bg-gray-950 text-white border-gray-955'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Type
                  {filterTypes.length > 0 && (
                    <span className={`inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded text-[10px] font-bold ${
                      openDropdown === 'type' || filterTypes.length > 0
                        ? 'bg-white/20 text-white'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {filterTypes.length}
                    </span>
                  )}
                  <IconChevronDown className={`transition-transform duration-150 ${openDropdown === 'type' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'type' && (
                  <div className="absolute top-[38px] left-0 z-40 min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-lg p-1 flex flex-col gap-[2px] animate-[vd-rise_130ms_ease-out]">
                    {['Dine-in', 'Takeaway', 'Delivery'].map(type => {
                      const checked = filterTypes.includes(type);
                      return (
                        <button
                          key={type}
                          onClick={() => setFilterTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])}
                          className="flex items-center gap-3 w-full px-3 py-2 border-0 bg-transparent hover:bg-gray-50 rounded-md cursor-pointer text-left text-xs font-semibold text-gray-800"
                        >
                          <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                            checked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300 bg-white'
                          }`}>
                            {checked && <IconCheck className="w-[10px] h-[10px]" />}
                          </span>
                          <span className="flex-1 truncate">{type}</span>
                          <span className="font-mono text-[10px] text-gray-400">
                            {orders.filter(o => o.type === type).length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Payment Filter */}
              <div className="relative">
                <button
                  onClick={() => setOpenDropdown(prev => prev === 'status' ? null : 'status')}
                  className={`inline-flex items-center gap-1.5 h-[34px] px-3.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    filterStatuses.length > 0 || openDropdown === 'status'
                      ? 'bg-gray-955 text-white border-gray-955'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-55'
                  }`}
                >
                  Payment
                  {filterStatuses.length > 0 && (
                    <span className={`inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded text-[10px] font-bold ${
                      openDropdown === 'status' || filterStatuses.length > 0
                        ? 'bg-white/20 text-white'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {filterStatuses.length}
                    </span>
                  )}
                  <IconChevronDown className={`transition-transform duration-150 ${openDropdown === 'status' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'status' && (
                  <div className="absolute top-[38px] left-0 z-40 min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-lg p-1 flex flex-col gap-[2px] animate-[vd-rise_130ms_ease-out]">
                    {(['pending_payment', 'refunded', 'unknown'] as PaymentStatus[]).map(status => {
                      const checked = filterStatuses.includes(status);
                      return (
                        <button
                          key={status}
                          onClick={() => setFilterStatuses(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status])}
                          className="flex items-center gap-3 w-full px-3 py-2 border-0 bg-transparent hover:bg-gray-50 rounded-md cursor-pointer text-left text-xs font-semibold text-gray-800"
                        >
                          <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                            checked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300 bg-white'
                          }`}>
                            {checked && <IconCheck className="w-[10px] h-[10px]" />}
                          </span>
                          <span className="flex-1 truncate">{getStatusLabel(status)}</span>
                          <span className="font-mono text-[10px] text-gray-400">
                            {orders.filter(o => o.paymentStatus === status).length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Date Filter */}
              <div className="relative">
                <button
                  onClick={() => setOpenDropdown(prev => prev === 'date' ? null : 'date')}
                  className={`inline-flex items-center gap-1.5 h-[34px] px-3.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    filterDate !== 'all' || openDropdown === 'date'
                      ? 'bg-gray-955 text-white border-gray-955'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {filterDate === 'all' ? 'Order date' : filterDate}
                  <IconChevronDown className={`transition-transform duration-150 ${openDropdown === 'date' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'date' && (
                  <div className="absolute top-[38px] left-0 z-40 min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-lg p-1 flex flex-col gap-[2px] animate-[vd-rise_130ms_ease-out]">
                    {[
                      { value: 'all', label: 'All dates' },
                      { value: 'Jun 19', label: 'Jun 19' },
                      { value: 'Jun 18', label: 'Jun 18' }
                    ].map(opt => {
                      const checked = filterDate === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => { setFilterDate(opt.value); setOpenDropdown(null); }}
                          className="flex items-center gap-3 w-full px-3 py-2 border-0 bg-transparent hover:bg-gray-50 rounded-md cursor-pointer text-left text-xs font-semibold text-gray-800"
                        >
                          <span className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
                            checked ? 'border-emerald-600 bg-white' : 'border-gray-300 bg-white'
                          }`}>
                            {checked && <span className="w-2 h-2 rounded-full bg-emerald-600" />}
                          </span>
                          <span className="flex-1 truncate">{opt.label}</span>
                          <span className="font-mono text-[10px] text-gray-400">
                            {opt.value === 'all' ? orders.length : orders.filter(o => o.date === opt.value).length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Clear filters */}
              <button
                onClick={handleClearFilters}
                className={`inline-flex items-center gap-1.5 h-[34px] px-3 text-xs font-semibold rounded-lg bg-transparent border shadow-sm transition-colors cursor-pointer select-none ${
                  anyFilterActive
                    ? 'text-red-600 border-red-200 hover:bg-red-50'
                    : 'text-gray-400 border-gray-200 cursor-not-allowed opacity-50'
                }`}
                disabled={!anyFilterActive}
              >
                {anyFilterActive ? <IconClose /> : <IconFunnel />}
                {anyFilterActive ? 'Clear filters' : 'All filters'}
              </button>
            </div>

            {/* Orders Table Panel */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col min-h-0 mb-6">
              <div className="flex-1 flex flex-col min-h-0 overflow-x-auto">
                
                {/* Header Grid */}
                <div className="grid grid-cols-[42px_108px_1fr_94px_110px_96px_78px_82px_62px_38px] items-center px-3 h-10 border-b border-gray-200 bg-gray-50/80 select-none shrink-0 min-w-[876px]">
                  <div className="flex items-center justify-center">
                    <button
                      onClick={handleToggleAll}
                      aria-label="Select all"
                      className={`w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors cursor-pointer ${
                        isAllChecked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300 bg-white'
                      }`}
                    >
                      {isAllChecked && <IconCheck className="w-[10px] h-[10px]" />}
                    </button>
                  </div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                    Order
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m8 9 4-4 4 4M16 15l-4 4-4-4" /></svg>
                  </div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Customer</div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Type</div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Payment</div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Status</div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Items</div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide text-right pr-2">Total</div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Date</div>
                  <div></div>
                </div>
              
                {/* Scrollable rows */}
                <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-gray-100 min-w-[876px]">
                  {filteredOrders.map(o => {
                    const checked = selectedIds.includes(o.id);
                    const isOpenedDetail = detailId === o.id;
                    
                    // Initials and Palette
                    const initials = o.customer.split(' ').map(w => w[0]).slice(0, 2).join('');
                    const avIdx = parseInt(o.id.slice(-2), 10) % AVATAR_PALETTES.length || 0;
                    const avatarPalette = (AVATAR_PALETTES[avIdx] || AVATAR_PALETTES[0])!;
                    const dishColors = getDishColors(o.dish);
                    
                    return (
                      <div
                        key={o.id}
                        onClick={() => { setDetailId(o.id); setDetailTab('items'); }}
                        className={`grid grid-cols-[42px_108px_1fr_94px_110px_96px_78px_82px_62px_38px] items-center px-3 h-[54px] cursor-pointer transition-colors ${
                          isOpenedDetail || checked
                            ? 'bg-emerald-50/50'
                            : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => handleToggleRow(o.id, e)}
                            aria-label="Select order"
                            className={`w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors cursor-pointer ${
                              checked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300 bg-white'
                            }`}
                          >
                            {checked && <IconCheck className="w-[10px] h-[10px]" />}
                          </button>
                        </div>
                        
                        <div className="font-mono text-xs font-semibold text-gray-900 truncate">{o.id}</div>
                        
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <span className={`w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 select-none ${avatarPalette.bg}`}>
                            {initials}
                          </span>
                          <span className="text-sm font-semibold text-gray-900 truncate">{o.customer}</span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          {getTypeIcon(o.type)}
                          {o.type}
                        </div>
                        
                        <div>
                          <span className={getStatusBadgeStyle(o.paymentStatus)}>
                            {getStatusIcon(o.paymentStatus)}
                            {getStatusLabel(o.paymentStatus)}
                          </span>
                        </div>

                        <div>
                          {(() => {
                            const status = getOperationalStatus(o);
                            return (
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-semibold ${getOperationalStatusStyle(status)}`}>
                                {status}
                              </span>
                            );
                          })()}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${dishColors.bg} ${dishColors.text}`}>
                            {getDishGlyph(o.dish)}
                          </span>
                          <span className="text-xs text-gray-500 tabular-nums">×{o.items}</span>
                        </div>
                        
                        <div className="font-mono text-sm font-semibold text-gray-900 text-right pr-2 tabular-nums">
                          {formatMoney(o.total)}
                        </div>
                        
                        <div className="text-xs text-gray-500 whitespace-nowrap">{o.date}</div>
                        
                        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => triggerToast(`Actions for order ${o.id}`)}
                            className="w-7 h-7 flex items-center justify-center rounded bg-transparent border-0 text-gray-400 hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
                          >
                            <IconMore />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  
                  {isError && (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center select-none animate-[vd-rise_200ms_ease-out]">
                      <span className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-500">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                        </svg>
                      </span>
                      <div className="text-sm font-semibold text-gray-950">Couldn't load orders</div>
                      <div className="text-xs text-gray-400 max-w-[260px] leading-relaxed">The backend didn't return order data. Check your connection and try again.</div>
                      <button
                        onClick={() => void refetch()}
                        className="mt-2 inline-flex items-center h-8 px-3.5 text-xs font-semibold rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-sm transition-colors cursor-pointer select-none"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {!isError && isLoading && (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center select-none">
                      <div className="text-sm font-semibold text-gray-500">Loading orders…</div>
                    </div>
                  )}
                  {!isError && !isLoading && filteredOrders.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center select-none animate-[vd-rise_200ms_ease-out]">
                      <span className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="7" />
                          <path d="m21 21-4.3-4.3" />
                        </svg>
                      </span>
                      <div className="text-sm font-semibold text-gray-950">
                        {anyFilterActive || searchQuery ? 'No orders match your filters' : 'No orders yet'}
                      </div>
                      <div className="text-xs text-gray-400 max-w-[260px] leading-relaxed">
                        {anyFilterActive || searchQuery
                          ? 'Try adjusting or clearing the active filters to see more orders.'
                          : 'Orders placed via Kiosk or Order Tablet will appear here in real time.'}
                      </div>
                      {(anyFilterActive || searchQuery) && (
                        <button
                          onClick={handleClearFilters}
                          className="mt-2 inline-flex items-center h-8 px-3.5 text-xs font-semibold rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-sm transition-colors cursor-pointer select-none"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
            
          {/* Bulk Actions Toolbar Popup */}
          {hasSelection && (
            <div className="absolute left-0 right-0 bottom-6 flex justify-center pointer-events-none z-30 select-none">
              <div className="pointer-events-auto flex items-center gap-1 p-[6px] bg-gray-900 text-white rounded-xl shadow-lg border border-gray-800 animate-[vd-rise_160ms_ease-out]">
                <span className="text-xs font-semibold px-2 pr-3 border-r border-gray-800">
                  Selected {selectedIds.length}
                </span>
                
                <button
                  onClick={handleBulkDuplicate}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-transparent hover:bg-white/10 text-inherit border-0 cursor-pointer"
                >
                  <IconDuplicate />Duplicate
                </button>
                
                <button
                  onClick={() => triggerToast(`Exporting ${selectedIds.length} orders…`)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-transparent hover:bg-white/10 text-inherit border-0 cursor-pointer"
                >
                  <IconExport />Export
                </button>
                
                <button
                  onClick={() => triggerToast(`Printing ${selectedIds.length} tickets…`)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-transparent hover:bg-white/10 text-inherit border-0 cursor-pointer"
                >
                  <IconPrint />Print
                </button>
                
                <button
                  onClick={handleBulkDelete}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-transparent hover:bg-red-500/20 text-red-500 border-0 cursor-pointer"
                >
                  <IconDelete />Delete
                </button>

                <button
                  onClick={() => setSelectedIds([])}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-inherit border-0 cursor-pointer ml-1"
                >
                  <IconClose />
                </button>
              </div>
            </div>
          )}
          
          {/* Detail Popover Panel Overlay */}
          {selectedOrder && (
            <div className="absolute top-[120px] right-6 z-30 w-[330px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden animate-[vd-pop_150ms_ease-out] flex flex-col max-h-[calc(100%-140px)]">
              
              {/* Detail Panel Head */}
              <div className="flex items-center justify-between gap-4 p-3.5 border-b border-gray-200 bg-gray-50/50 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-[26px] h-[26px] rounded-lg bg-gray-100 flex items-center justify-center text-gray-550 flex-shrink-0">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
                  </span>
                  <span className="font-mono text-sm font-bold text-gray-950 truncate">{selectedOrder.id}</span>
                </div>
                
                <div className="flex items-center gap-1 select-none">
                  <button
                    onClick={() => triggerToast(`Expanded order ${selectedOrder.id}`)}
                    aria-label="Open full details"
                    className="w-[28px] h-[28px] inline-flex items-center justify-center bg-transparent border-0 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 cursor-pointer"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
                  </button>
                  <button
                    onClick={() => setDetailId(null)}
                    aria-label="Close"
                    className="w-[28px] h-[28px] inline-flex items-center justify-center bg-transparent border-0 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 cursor-pointer"
                  >
                    <IconClose />
                  </button>
                </div>
              </div>

              {/* Detail Customer Meta */}
              <div className="p-3.5 border-b border-gray-200 flex flex-col gap-2 shrink-0">
                <div className="flex items-center gap-2.5">
                  <span className={`w-[30px] h-[30px] rounded-full flex items-center justify-center text-xs font-bold ${selectedOrder.avBg}`}>
                    {selectedOrder.initials}
                  </span>
                  <span className="text-sm font-bold text-gray-950">{selectedOrder.customer}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-gray-400"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
                  <span className="truncate">{selectedOrder.email}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-gray-400"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>
                  <span>{selectedOrder.phone}</span>
                </div>
              </div>

              {/* Tabs Bar */}
              <div className="flex gap-1 px-3 border-b border-gray-200 bg-gray-50/20 select-none shrink-0">
                {([
                  { key: 'items', label: 'Order items' },
                  { key: 'delivery', label: 'Delivery' },
                  { key: 'docs', label: 'Docs' }
                ] as { key: DetailTab, label: string }[]).map(tab => {
                  const active = detailTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setDetailTab(tab.key)}
                      className={`py-2.5 px-3 border-0 bg-transparent cursor-pointer text-xs font-semibold -mb-px transition-colors ${
                        active
                          ? 'border-b-2 border-emerald-605 text-gray-900 font-bold'
                          : 'border-b-2 border-transparent text-gray-400 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content Panel */}
              <div className="flex-1 overflow-y-auto p-4 min-h-0">
                
                {/* Tab: Items */}
                {detailTab === 'items' && (
                  <div className="flex flex-col">
                    <div className="divide-y divide-gray-100">
                      {[...selectedOrder.itemsList].sort(compareMenuItemsAlphabetically).map((item, idx) => {
                        const dishColors = getDishColors(item.dish);
                        return (
                          <div key={idx} className="flex items-center gap-3 py-2.5">
                            <span className={`w-[34px] h-[34px] rounded-lg flex items-center justify-center flex-shrink-0 ${dishColors.bg} ${dishColors.text}`}>
                              {getDishGlyph(item.dish)}
                            </span>
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="text-xs font-semibold text-gray-900 truncate">{item.name}</div>
                              <div className="text-[11px] text-gray-400 mt-[2px] tabular-nums">
                                {item.qty} · {formatMoney(item.price)}
                              </div>
                            </div>
                            <span className="font-mono text-xs font-semibold text-gray-950 tabular-nums">
                              {formatMoney(item.line)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    
                    <div className="flex items-center justify-between pt-3.5 pb-1 border-t border-gray-100 select-none">
                      <span className="text-xs font-bold text-gray-900">Total</span>
                      <span className="font-mono text-base font-bold text-emerald-600 tabular-nums">
                        {formatMoney(selectedOrder.total)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Tab: Delivery */}
                {detailTab === 'delivery' && (
                  <div className="flex flex-col gap-3">
                    <div className="text-center py-6 text-gray-400 select-none">
                      <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 11v11M16 2v2a4 4 0 004 4v9a2 2 0 01-2 2h-4a2 2 0 01-2-2V8a4 4 0 004-4V2" />
                      </svg>
                      <div className="text-xs font-semibold">{selectedOrder.type} order</div>
                      <p className="text-[11px] mt-1 max-w-[220px] mx-auto leading-relaxed">
                        {selectedOrder.type === 'Delivery'
                          ? 'Driver, ETA, and address aren’t tracked by the backend yet.'
                          : `No delivery details for ${selectedOrder.type.toLowerCase()} orders.`}
                      </p>
                    </div>
                  </div>
                )}

                {/* Tab: Docs */}
                {detailTab === 'docs' && (
                  <div className="flex flex-col items-center justify-center text-center gap-2 py-8 select-none">
                    <span className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                    </span>
                    <div className="text-xs font-bold text-gray-900">No documents yet</div>
                    <p className="text-[11px] text-gray-400 max-w-[190px] leading-relaxed">Receipts and invoices for this order will appear here once generated.</p>
                  </div>
                )}

              </div>

              {/* Detail Panel Actions Footer */}
              <div className="p-3 border-t border-gray-200 bg-gray-50 flex items-center gap-2 shrink-0 select-none">
                <button
                  onClick={() => triggerToast(`Receipt exported · ${selectedOrder.id}`)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 border border-gray-200 hover:bg-gray-100 rounded-lg bg-white text-xs font-semibold text-gray-700 cursor-pointer shadow-sm transition-colors"
                >
                  <IconExport />Export
                </button>
                <button
                  onClick={() => handleDuplicateSingle(selectedOrder)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 border border-gray-200 hover:bg-gray-100 rounded-lg bg-white text-xs font-semibold text-gray-700 cursor-pointer shadow-sm transition-colors"
                >
                  <IconDuplicate />Duplicate
                </button>
                <button
                  onClick={() => handleDeleteSingle(selectedOrder.id)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 bg-red-600 hover:bg-red-700 text-white rounded-lg border border-transparent text-xs font-semibold cursor-pointer shadow-sm transition-colors"
                >
                  <IconDelete />Delete
                </button>
              </div>

            </div>
          )}

        </section>

        {/* ==================== RIGHT SIDE: ANALYTICS RAIL ==================== */}
        <aside className="w-full xl:w-[312px] xl:min-w-[312px] shrink-0 overflow-y-auto border-t xl:border-t-0 xl:border-l border-gray-200 bg-white p-5 flex flex-col gap-6 select-none xl:h-full">
          
          {/* Section: Order Value Gauge */}
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Order value</div>
            <div className="relative flex justify-center">
              <svg width="220" height="124" viewBox="0 0 220 124">
                <path d="M18 112 A92 92 0 0 1 202 112" fill="none" className="stroke-gray-100 dark:stroke-gray-800" strokeWidth="14" strokeLinecap="round"></path>
                <path d="M18 112 A92 92 0 0 1 202 112" fill="none" className="stroke-emerald-600 dark:stroke-emerald-500" strokeWidth="14" strokeLinecap="round" strokeDasharray="257 289" strokeDashoffset="0"></path>
              </svg>
              <div className="absolute top-[52px] left-0 right-0 text-center">
                <div className="font-mono text-[26px] font-semibold tracking-tight text-gray-950 dark:text-gray-50 leading-tight">
                  {stats.totalRevenue >= 10000 ? `$${(stats.totalRevenue / 1000).toFixed(1)}k` : formatMoney(stats.totalRevenue)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{stats.totalOrders} orders</div>
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Section: Sales Channels — derived from real order.type, not fabricated */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Sales channels</span>
            </div>
            {salesChannels.length === 0 ? (
              <div className="text-xs text-gray-400">No orders yet.</div>
            ) : (
              <>
                <div className="flex h-[7px] rounded-full overflow-hidden mb-3.5 select-none">
                  {salesChannels.map(ch => (
                    <span key={ch.label} style={{ width: `${ch.pct}%` }} className={ch.color}></span>
                  ))}
                </div>
                <div className="flex flex-col">
                  {salesChannels.map(ch => (
                    <div key={ch.label} className="flex items-center gap-2.5 py-2 border-b border-gray-100 last:border-b-0">
                      <span className={`w-[9px] h-[9px] rounded-[3px] shrink-0 ${ch.color}`}></span>
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="text-xs font-semibold text-gray-950 dark:text-gray-100 truncate block">{ch.label}</div>
                        <div className="text-[10px] text-gray-450 mt-[2px]">{ch.orders} orders · {ch.pct.toFixed(0)}%</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-xs font-semibold text-gray-955 dark:text-gray-200">{formatMoney(ch.revenue)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="h-px bg-gray-100" />

          {/* Section: Orders Status — real order lifecycle mix, not payment
              status (the backend doesn't track payment state on orders). */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Orders status</span>
            </div>
            {orderStatusMix.length === 0 ? (
              <div className="text-xs text-gray-400">No orders yet.</div>
            ) : (
              <>
                <div className="flex h-[7px] rounded-full overflow-hidden mb-3.5 select-none">
                  {orderStatusMix.map(b => (
                    <span key={b.label} style={{ width: `${b.pct}%` }} className={b.color}></span>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  {orderStatusMix.map(b => (
                    <div key={b.label} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                        <span className={`w-2 h-2 rounded-full ${b.color}`}></span>
                        {b.label}
                      </span>
                      <span className="font-mono text-xs font-semibold text-gray-955 dark:text-gray-200">{b.pct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="h-px bg-gray-100" />

          {/* Section: Overview */}
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Overview</span>
              <button 
                onClick={() => triggerToast('Overview range · Today')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-transparent border-0 cursor-pointer hover:text-gray-950 transition-colors"
              >
                Today
                <IconChevronDown className="w-3 h-3" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <div className="font-mono text-[18px] font-semibold text-gray-950 dark:text-gray-50 leading-tight">
                  {formatMoney(stats.averageOrder)}
                </div>
                <div className="text-xs text-gray-400 mt-1">Average order</div>
              </div>
              <div>
                <div className="font-mono text-[18px] font-semibold text-gray-950 dark:text-gray-50 leading-tight">
                  {stats.totalRevenue >= 10000 ? `$${(stats.totalRevenue / 1000).toFixed(1)}k` : formatMoney(stats.totalRevenue)}
                </div>
                <div className="text-xs text-gray-400 mt-1">Total revenue</div>
              </div>
              <div>
                <div className="font-mono text-[18px] font-semibold text-gray-950 dark:text-gray-50 leading-tight">
                  {stats.averageProcessingMinutes !== null ? `${Math.round(stats.averageProcessingMinutes)} min` : '—'}
                </div>
                <div className="text-xs text-gray-400 mt-1">Avg. processing time</div>
              </div>
              <div>
                <div className="font-mono text-[18px] font-semibold text-gray-950 dark:text-gray-50 leading-tight">
                  {stats.averageItems.toFixed(1)}
                </div>
                <div className="text-xs text-gray-400 mt-1">Avg. items/order</div>
              </div>
              <div>
                <div className="font-mono text-[18px] font-semibold text-gray-950 dark:text-gray-50 leading-tight">
                  {stats.pendingRate.toFixed(0)}%
                </div>
                <div className="text-xs text-gray-400 mt-1">Pending orders</div>
              </div>
              <div>
                <div className="font-mono text-[18px] font-semibold text-gray-950 dark:text-gray-50 leading-tight">
                  {stats.cancelledRate.toFixed(0)}%
                </div>
                <div className="text-xs text-gray-400 mt-1">Cancelled rate</div>
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Section: Top Customers — no backend equivalent exists yet
              (order creation doesn't capture customer identity), so this
              stays an honest placeholder rather than inventing names/spend. */}
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Top customers</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              Not available — orders don't capture customer identity yet.
            </p>
          </div>

        </aside>
      </div>

      {/* Floating Action Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 left-[calc(50%+124px)] -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-3 bg-gray-900 text-white rounded-lg shadow-xl font-semibold text-xs animate-[vd-rise_160ms_ease-out] select-none border border-gray-800">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--green-400)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {toastMessage}
        </div>
      )}
    </div>
  );
  
  // Logic for duplicating single order from detail view
  function handleDuplicateSingle(order: Order) {
    triggerToast(`Order ${order.id} is live and cannot be duplicated`);
  }

  // Logic for deleting single order from detail view
  function handleDeleteSingle(id: string) {
    triggerToast(`Order ${id} is live and cannot be deleted`);
  }
}

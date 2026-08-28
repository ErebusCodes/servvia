import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

// ── Icon factory ──────────────────────────────────────────────────────────────
import type { FC } from 'react';

const si = (d: string, d2?: string): FC =>
  function NavIcon() {
    return (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d} />
        {d2 && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d2} />}
      </svg>
    );
  };

const IconKitchenDisplay: FC = () => (
  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="13" rx="2" />
    <path d="M9 16v4M5 20h14M7 7h10M7 10h5" />
  </svg>
);

const IconKiosks: FC = () => (
  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="14" rx="2" />
    <path d="M12 17v4M8 21h8" />
  </svg>
);

const IconInventory: FC = () => (
  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
  </svg>
);

const IconArchitecture: FC = () => (
  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="3" y="15" width="6" height="6" rx="1" />
    <rect x="15" y="9" width="6" height="6" rx="1" />
    <path d="M9 6h3v12H9M12 12h3" />
  </svg>
);

const IconIntegrations: FC = () => (
  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 11-5.656-5.656l1.5-1.5" />
    <path d="M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 115.656 5.656l-1.5 1.5" />
  </svg>
);

const IconTables: FC = () => (
  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </svg>
);

const IconChevron: FC = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

const NI = {
  Dashboard:    si('M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z'),
  Reservations: si('M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'),
  Orders:       si('M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z'),
  Menu:         si('M4 6h16M4 10h16M4 14h16M4 18h16'),
  Payments:     si('M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'),
  Staff:        si('M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z'),
  Venues:       si('M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'),
  Printers:     si('M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z'),
  POSSync:      si('M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'),
  Audit:        si('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'),
  Reports:      si('M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'),
  Settings:     si('M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'),
  KitchenDisplay: IconKitchenDisplay,
  Kiosks:         IconKiosks,
  Inventory:      IconInventory,
  Architecture:   IconArchitecture,
  Integrations:   IconIntegrations,
  Tables:         IconTables,
};

// ── Nav structure ─────────────────────────────────────────────────────────────
// NavLeaf: a routable sidebar link. NavParent: a collapsible group of NavLeafs
// (e.g. "Integration Tools"), used to nest related pages without changing their routes.
interface NavLeaf { label: string; path: string; Icon: FC; badge?: string }
interface NavParent { label: string; Icon: FC; children: NavLeaf[] }
type NavEntry = NavLeaf | NavParent;
interface NavGroup { title: string; items: NavEntry[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Dashboard',          path: '/dashboard',        Icon: NI.Dashboard },
      { label: 'Reservations',       path: '/reservations',     Icon: NI.Reservations, badge: '24' },
      { label: 'Table Management',   path: '/table-management', Icon: NI.Tables },
      { label: 'Orders',             path: '/orders',           Icon: NI.Orders, badge: '11' },
      { label: 'Menu Management',    path: '/menu-management',  Icon: NI.Menu },
      { label: 'POS Catalog Review', path: '/pos-catalog-review', Icon: NI.POSSync },
    ],
  },
  {
    title: 'Service Channels',
    items: [
      { label: 'Kitchen Display',    path: '/kitchen-display', Icon: NI.KitchenDisplay },
      { label: 'Kiosk Window',       path: '/kiosk-window',    Icon: NI.Kiosks },
      { label: 'Order Tablet',       path: '/order-tablet',    Icon: NI.Kiosks },
      { label: 'Tablet Devices',     path: '/settings/tablet-devices', Icon: NI.Kiosks },
    ],
  },
  {
    title: 'Business',
    items: [
      { label: 'Payments',  path: '/payments',        Icon: NI.Payments },
      { label: 'Inventory', path: '/inventory',       Icon: NI.Inventory },
      { label: 'Staff',     path: '/staff',           Icon: NI.Staff },
      { label: 'Venues',    path: '/venue',  Icon: NI.Venues },
      { label: 'Reports',   path: '/reports',         Icon: NI.Reports },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Integration Tools', path: '/IntegrationTools', Icon: NI.Integrations },
      { label: 'Audit Logs',        path: '/audit',            Icon: NI.Audit },
      { label: 'Settings',          path: '/settings',         Icon: NI.Settings },
    ],
  },
];

// Key used to persist which sidebar groups are expanded across navigation/reloads.
const NAV_EXPANDED_STORAGE_KEY = 'verdura-admin-nav-expanded';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':        'Dashboard',
  '/reservations':     'Reservations',
  '/table-management': 'Table Management',
  '/orders':           'Orders',
  '/menu-management':  'Menu Management',
  '/pos-catalog-review': 'POS Catalog Review',
  '/kitchen-display':  'Kitchen Display',
  '/kiosks':           'Kiosk Window',
  '/kiosk-window':     'Kiosk Window',
  '/order-tablet':     'Order Tablet',
  '/settings/tablet-devices': 'Tablet Devices',
  '/payments':         'Payments',
  '/inventory':        'Inventory',
  '/staff':            'Staff',
  '/venue':            'Venues',
  '/settings/tables':  'Tables',
  '/printers':         'Printers',
  '/pos-sync':         'POS Sync',
  '/IntegrationTools': 'Integrations',
  '/audit':            'Audit Logs',
  '/reports':          'Reports',
  '/settings':         'Settings',
};

const PAGE_BREADCRUMBS: Record<string, string> = {
  '/dashboard':        'Operations',
  '/reservations':     'Operations / Reservations',
  '/table-management': 'Operations / Table Management',
  '/orders':           'Operations / Orders',
  '/menu-management':  'Operations / Menu',
  '/pos-catalog-review': 'Operations / Menu / POS Catalog Review',
  '/kitchen-display':  'Service Channels / Kitchen Display',
  '/kiosks':           'Service Channels / Kiosk Window',
  '/kiosk-window':     'Service Channels / Kiosk Window',
  '/order-tablet':     'Service Channels / Order Tablet',
  '/settings/tablet-devices': 'Service Channels / Tablet Devices',
  '/payments':         'Business / Payments',
  '/inventory':        'Business / Inventory',
  '/staff':            'Business / Staff',
  '/venue':            'Business / Venues',
  '/settings/tables':  'Business / Tables',
  '/printers':         'System / Integration Tools / Printers',
  '/pos-sync':         'System / Integration Tools / POS Sync',
  '/IntegrationTools': 'System / Integrations',
  '/audit':            'System / Audit',
  '/reports':          'Business / Reports',
  '/settings':         'System / Settings',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function userInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase()
      : (parts[0] ?? '').slice(0, 2).toUpperCase();
  }
  return (email?.[0] ?? 'U').toUpperCase();
}

function VerduraLeaf() {
  return (
    <span className="w-7 h-7 rounded-[8px] bg-emerald-600 inline-flex items-center justify-center flex-shrink-0 select-none">
      <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
        <path
          d="M20 28.5c-5.1-1.7-9.5-6.8-9.5-14.4a.9.9 0 0 1 .9-.9c3.1 0 6.1.8 8.6 3.1 2.5-2.3 5.5-3.1 8.6-3.1a.9.9 0 0 1 .9.9c0 7.6-4.4 12.7-9.5 14.4Z"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M20 17.4V29" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────
export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);


  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    let stored: Record<string, boolean> = {};
    try {
      const raw = localStorage.getItem(NAV_EXPANDED_STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as Record<string, boolean>;
    } catch {
      // ignore malformed/unavailable storage
    }
    const withActiveChild = { ...stored };
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if ('children' in item && item.children.some((c) => location.pathname.startsWith(c.path))) {
          withActiveChild[item.label] = true;
        }
      }
    }
    return withActiveChild;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    return () => { document.documentElement.removeAttribute('data-theme'); };
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_EXPANDED_STORAGE_KEY, JSON.stringify(expandedGroups));
    } catch {
      // ignore unavailable storage
    }
  }, [expandedGroups]);

  // Auto-expand a group whenever navigation lands on one of its children.
  useEffect(() => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if ('children' in item && item.children.some((c) => location.pathname.startsWith(c.path))) {
          setExpandedGroups((prev) => (prev[item.label] ? prev : { ...prev, [item.label]: true }));
        }
      }
    }
  }, [location.pathname]);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const renderNavLeaf = (item: NavLeaf, indent = false) => {
    const badge =
      item.label === 'Reservations' ? '14' : item.label === 'Orders' ? '25' : item.badge;
    const horizontalPad = indent && !collapsed ? 'pl-9 pr-2.5' : 'px-2.5';
    return (
      <NavLink
        key={item.label}
        to={item.path}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          `flex items-center gap-[11px] ${horizontalPad} py-2 rounded-lg text-sm font-medium transition-colors relative ${
            collapsed ? 'justify-center' : 'justify-start'
          } ${
            isActive
              ? 'bg-emerald-50 text-emerald-600 font-semibold'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          }`
        }
      >
        {({ isActive }) => (
          <>
            {isActive && !collapsed && (
              <span className="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-r-[3px] bg-emerald-600" />
            )}
            <item.Icon />
            {!collapsed && (
              <>
                <span className="flex-1 truncate">{item.label}</span>
                {badge && (
                  <span
                    title={item.label === 'Reservations' ? 'Total Reservations' : undefined}
                    className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-semibold rounded-full bg-emerald-100 text-emerald-700"
                  >
                    {badge}
                  </span>
                )}
              </>
            )}
          </>
        )}
      </NavLink>
    );
  };

  // Collapsible group (e.g. "Integration Tools"): in the rail (collapsed sidebar)
  // view there's no room for a label/chevron, so its children are shown flat instead.
  const renderNavGroup = (item: NavParent) => {
    if (collapsed) {
      return item.children.map((child) => renderNavLeaf(child));
    }

    const isExpanded = !!expandedGroups[item.label];
    const isChildActive = item.children.some((c) => location.pathname.startsWith(c.path));
    const groupId = `nav-group-${item.label.replace(/\s+/g, '-').toLowerCase()}`;

    return (
      <div key={item.label}>
        <button
          type="button"
          onClick={() => toggleGroup(item.label)}
          aria-expanded={isExpanded}
          aria-controls={groupId}
          className={`w-full flex items-center gap-[11px] px-2.5 py-2 rounded-lg text-sm font-medium transition-colors relative justify-start ${
            isChildActive
              ? 'text-emerald-600 font-semibold'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          {isChildActive && (
            <span className="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-r-[3px] bg-emerald-600" />
          )}
          <item.Icon />
          <span className="flex-1 truncate text-left">{item.label}</span>
          <span className={`text-gray-400 transition-transform duration-200 ease-in-out ${isExpanded ? 'rotate-180' : ''}`}>
            <IconChevron />
          </span>
        </button>
        <div
          id={groupId}
          className={`grid transition-all duration-200 ease-in-out ${
            isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden flex flex-col gap-1 mt-1">
            {item.children.map((child) => renderNavLeaf(child, true))}
          </div>
        </div>
      </div>
    );
  };

  const { mutate: logout, isPending } = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: () => {
      clearAuth();
      void navigate('/dashboard', { replace: true });
    },
  });

  const pageTitle = PAGE_TITLES[location.pathname] ?? 'Dashboard';
  const pageBreadcrumb = PAGE_BREADCRUMBS[location.pathname] ?? null;
  const initials = userInitials(user?.name, user?.email);
  const displayName = user?.name ?? user?.email ?? 'User';
  const displayRole = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1).replace(/_/g, ' ')
    : 'Manager';

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-50 flex">

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        style={{
          width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)',
          minWidth: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)',
        }}
        className="bg-white border-r border-gray-200 flex flex-col shrink-0 h-full transition-all duration-200 ease-in-out overflow-hidden"
      >
        {/* Logo */}
        <div className="h-[60px] border-b border-gray-200 flex items-center shrink-0 gap-2.5 transition-all px-[18px]">
          <VerduraLeaf />
          {!collapsed && (
            <span className="text-base font-semibold text-gray-900 tracking-tight select-none">
              Verdura
            </span>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-1">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="mb-2 last:mb-0">
              {!collapsed && group.title && (
                <p className="px-2.5 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider select-none">
                  {group.title}
                </p>
              )}
              <div className="flex flex-col gap-1">
                {group.items.map((item) =>
                  'children' in item
                    ? renderNavGroup(item)
                    : renderNavLeaf(item)
                )}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="border-t border-gray-200 px-3 py-3 shrink-0 flex flex-col gap-2">
          <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'justify-between'}`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                {initials}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900 truncate leading-tight">{displayName}</p>
                  <p className="text-[11px] text-gray-400 truncate leading-tight mt-0.5">{displayRole}</p>
                </div>
              )}
            </div>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={collapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">

        {/* Top bar */}
        {location.pathname === '/venue' ? (
          <header className="bg-white border-b border-gray-200 shrink-0 flex flex-col px-[18px] py-[14px]">
            {/* Top row */}
            <div className="flex items-center justify-between gap-4">
              {/* Breadcrumb */}
              <div className="min-w-0 shrink-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none">
                  BUSINESS / VENUES
                </p>
              </div>

              {/* Search */}
              <div className="flex-1 max-w-2xl relative mx-6">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-[15px] h-[15px] text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="search"
                  id="venue-global-search"
                  placeholder="Search venues, locations, or managers..."
                  onChange={(e) => {
                    window.dispatchEvent(new CustomEvent('venue-search', { detail: e.target.value }));
                  }}
                  className="w-full h-9 pl-9 pr-10 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-400 focus:bg-white transition-colors"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-[10px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono font-medium">⌘K</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3 shrink-0">
                {/* Live status */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs cursor-pointer hover:bg-gray-50 transition-colors select-none shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-semibold text-gray-700">Live</span>
                  <span className="text-gray-400 text-[10px] hidden sm:inline">Updated 1 min ago</span>
                  <svg className="w-3 h-3 text-gray-400 ml-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Dark mode */}
                <button
                  onClick={() => setDarkMode((d) => !d)}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  title={darkMode ? 'Light mode' : 'Dark mode'}
                >
                  {darkMode ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="4"/>
                      <path d="M12 2v2M12 20v2M5 5l1.5 1.5M17.5 17.5 19 19M2 12h2M20 12h2M5 19l1.5-1.5M17.5 6.5 19 5"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>
                    </svg>
                  )}
                </button>

                {/* Notifications */}
                <span className="relative inline-flex">
                  <button className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </button>
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                    3
                  </span>
                </span>

                <div className="w-px h-[22px] bg-gray-200 mx-1" />

                {/* User profile */}
                <button
                  onClick={() => logout()}
                  disabled={isPending}
                  title="Click to sign out"
                  className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors select-none text-left disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[11px] font-bold">
                    {initials}
                  </div>
                  <div className="flex flex-col text-left shrink-0">
                    <span className="text-xs font-bold text-gray-800 leading-tight">User</span>
                    <span className="text-[10px] text-gray-400 leading-tight">Manager</span>
                  </div>
                  <svg className="w-3 h-3 text-gray-400 ml-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Bottom row */}
            <div className="flex items-end justify-between mt-3">
              <div>
                <h1 className="text-[22px] font-bold text-gray-900 tracking-tight leading-none">Venues</h1>
                <p className="text-[12px] text-gray-400 leading-none mt-1.5">Manage your venues and their configurations</p>
              </div>
              <button
                id="add-venue-btn"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('venue-add-click'));
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-xs font-semibold shadow-sm transition-colors"
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Venue
              </button>
            </div>
          </header>
        ) : (
          <header className="h-[60px] bg-white border-b border-gray-200 px-[18px] flex items-center shrink-0 justify-between">
            <div className="flex flex-col gap-[1px] min-w-0 shrink-0">
              {pageBreadcrumb && (
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none">{pageBreadcrumb}</p>
              )}
              <div className="flex items-center gap-3.5 mt-1.5">
                <h1 className="text-[22px] font-bold text-gray-900 tracking-tight leading-none">{pageTitle}</h1>
                {location.pathname === '/table-management' && (
                  <>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#f0fdf4] border border-[#bbf7d0] text-[10px] font-bold text-[#16a34a] select-none">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
                      Live
                    </span>
                    <span className="text-[11px] text-gray-400 font-medium">Updated just now</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center flex-1 max-w-2xl gap-3 mx-6">
              {/* Search */}
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-[15px] h-[15px] text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="search"
                  placeholder={
                    location.pathname === '/IntegrationTools'
                      ? "Search integrations, services, devices, logs..."
                      : location.pathname === '/inventory'
                      ? "Search items, SKU, suppliers, PO, batches..."
                      : location.pathname === '/payments'
                      ? "Search transactions, customers, orders..."
                      : location.pathname === '/staff'
                      ? "Search staff, roles, venues..."
                      : location.pathname === '/table-management'
                      ? "Search tables, areas, reservations, or guests..."
                      : location.pathname === '/settings'
                      ? "Search settings..."
                      : "Search venues, guests, orders, tables, staff..."
                  }
                  onChange={(e) => {
                    if (location.pathname === '/settings') {
                      window.dispatchEvent(new CustomEvent('settings-search', { detail: e.target.value }));
                    } else if (location.pathname === '/table-management') {
                      window.dispatchEvent(new CustomEvent('table-search', { detail: e.target.value }));
                    }
                  }}
                  className="w-full h-9 pl-9 pr-10 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-400 focus:bg-white transition-colors"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-[10px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono font-medium">⌘K</span>
                </div>
              </div>

              {/* Live status */}
              {location.pathname !== '/table-management' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs cursor-pointer hover:bg-gray-50 transition-colors select-none shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-semibold text-gray-700">Live</span>
                  <span className="text-gray-400 text-[10px] hidden sm:inline">{location.pathname === '/IntegrationTools' ? 'Updated 18 sec ago' : location.pathname === '/inventory' ? 'Updated 2 min ago' : 'Updated 1 min ago'}</span>
                  <svg className="w-3 h-3 text-gray-400 ml-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 ml-auto">
              {/* Dark mode */}
              <button
                onClick={() => setDarkMode((d) => !d)}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                title={darkMode ? 'Light mode' : 'Dark mode'}
              >
                {darkMode ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4"/>
                    <path d="M12 2v2M12 20v2M5 5l1.5 1.5M17.5 17.5 19 19M2 12h2M20 12h2M5 19l1.5-1.5M17.5 6.5 19 5"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>
                  </svg>
                )}
              </button>

              {/* Notifications */}
              <span className="relative inline-flex">
                <button className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </button>
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {location.pathname === '/settings' ? '2' : '3'}
                </span>
              </span>

              <div className="w-px h-[22px] bg-gray-200 mx-1" />

              {/* User profile with initials dropdown */}
              <button
                onClick={() => logout()}
                disabled={isPending}
                title="Click to sign out"
                className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors select-none text-left disabled:opacity-50"
              >
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[11px] font-bold">
                  {initials}
                </div>
                <div className="flex flex-col text-left shrink-0">
                  <span className="text-xs font-bold text-gray-800 leading-tight">User</span>
                  <span className="text-[10px] text-gray-400 leading-tight">Manager</span>
                </div>
                <svg className="w-3 h-3 text-gray-400 ml-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </header>
        )}

        <main className={`flex-1 bg-gray-50 min-h-0 ${location.pathname.startsWith('/reservations') || location.pathname.startsWith('/orders') || location.pathname.startsWith('/menu') || location.pathname.startsWith('/kitchen-display') || location.pathname.startsWith('/kiosk-window') || location.pathname.startsWith('/order-tablet') || location.pathname.startsWith('/table-management') ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

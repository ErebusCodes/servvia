import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface SettingRow {
  name: string;
  icon: string;
  desc: string;
  badge: string;
  tone: 'success' | 'info' | 'warning';
  extra?: string;
  updated: string;
  by: string;
}

interface SettingSection {
  id: string;
  title: string;
  icon: string;
  subtitle: string;
  rows: SettingRow[];
}

export function SettingsPage() {
  const navigate = useNavigate();

  // State matching design logic
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All categories');
  const [status, setStatus] = useState('All status');
  
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    general: true,
    operations: true,
    people: true,
    customers: true,
    finance: true,
    system: true,
  });

  const [tipVisible, setTipVisible] = useState(true);

  // Listen to the top-bar global search event from AdminLayout
  useEffect(() => {
    const handleGlobalSearch = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setQuery(detail || '');
    };
    window.addEventListener('settings-search', handleGlobalSearch);
    return () => {
      window.removeEventListener('settings-search', handleGlobalSearch);
    };
  }, []);

  // Icon mapping helper
  const getIcon = (name: string, size = 18) => {
    const icons: Record<string, [string, Record<string, any>][]> = {
      home: [['path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }], ['path', { d: 'M9 22V12h6v10' }]],
      calendar: [['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }], ['path', { d: 'M16 2v4' }], ['path', { d: 'M8 2v4' }], ['path', { d: 'M3 10h18' }]],
      grid: [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }]],
      bag: [['path', { d: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z' }], ['path', { d: 'M3 6h18' }], ['path', { d: 'M16 10a4 4 0 0 1-8 0' }]],
      utensils: [['path', { d: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2' }], ['path', { d: 'M7 2v20' }], ['path', { d: 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7' }]],
      monitor: [['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ['path', { d: 'M8 21h8' }], ['path', { d: 'M12 17v4' }]],
      appwindow: [['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }], ['path', { d: 'M10 4v4' }], ['path', { d: 'M2 8h20' }], ['path', { d: 'M6 4v4' }]],
      tablet: [['rect', { x: 4, y: 2, width: 16, height: 20, rx: 2 }], ['path', { d: 'M12 18h.01' }]],
      card: [['rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }], ['path', { d: 'M2 10h20' }]],
      pkg: [['path', { d: 'M16.5 9.4 7.55 4.24' }], ['path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }], ['path', { d: 'M3.29 7 12 12l8.71-5' }], ['path', { d: 'M12 22V12' }]],
      users: [['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }], ['circle', { cx: 9, cy: 7, r: 4 }], ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }], ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]],
      mappin: [['path', { d: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z' }], ['circle', { cx: 12, cy: 10, r: 3 }]],
      chart: [['path', { d: 'M3 3v18h18' }], ['path', { d: 'M18 17V9' }], ['path', { d: 'M13 17V5' }], ['path', { d: 'M8 17v-3' }]],
      branch: [['path', { d: 'M6 3v12' }], ['circle', { cx: 18, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['path', { d: 'M18 9a9 9 0 0 1-9 9' }]],
      filetext: [['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 2v6h6' }], ['path', { d: 'M16 13H8' }], ['path', { d: 'M16 17H8' }], ['path', { d: 'M10 9H8' }]],
      gear: [['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
      building: [['path', { d: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z' }], ['path', { d: 'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2' }], ['path', { d: 'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2' }], ['path', { d: 'M10 6h4' }], ['path', { d: 'M10 10h4' }], ['path', { d: 'M10 14h4' }], ['path', { d: 'M10 18h4' }]],
      globe: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }], ['path', { d: 'M2 12h20' }]],
      pencil: [['path', { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' }]],
      receipt: [['path', { d: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z' }], ['path', { d: 'M14 8H8' }], ['path', { d: 'M16 12H8' }], ['path', { d: 'M13 16H8' }]],
      leaf: [['path', { d: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z' }], ['path', { d: 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12' }]],
      shield: [['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }]],
      bell: [['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }], ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }]],
      download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'M7 10l5 5 5-5' }], ['path', { d: 'M12 15V3' }]],
      upload: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'M17 8l-5-5-5 5' }], ['path', { d: 'M12 3v12' }]],
      history: [['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }], ['path', { d: 'M3 3v5h5' }], ['path', { d: 'M12 7v5l4 2' }]],
      restore: [['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }], ['path', { d: 'M21 3v5h-5' }]],
      message: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]],
      gift: [['rect', { x: 3, y: 8, width: 18, height: 4, rx: 1 }], ['path', { d: 'M12 8v13' }], ['path', { d: 'M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7' }], ['path', { d: 'M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5' }]],
      dollar: [['path', { d: 'M12 2v20' }], ['path', { d: 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }]],
      trend: [['path', { d: 'M22 7l-8.5 8.5-5-5L2 17' }], ['path', { d: 'M16 7h6v6' }]],
      plug: [['path', { d: 'M12 22v-5' }], ['path', { d: 'M9 8V2' }], ['path', { d: 'M15 8V2' }], ['path', { d: 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z' }]],
      key: [['path', { d: 'm21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4' }]],
      database: [['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }], ['path', { d: 'M3 5v14a9 3 0 0 0 18 0V5' }], ['path', { d: 'M3 12a9 3 0 0 0 18 0' }]],
    };

    const shapes = icons[name] || icons.gear;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shapes.map((sh, i) => {
          const Tag = sh[0] as any;
          return <Tag key={i} {...sh[1]} />;
        })}
      </svg>
    );
  };

  // Section data from template.html
  const SECTIONS_DATA: SettingSection[] = [
    {
      id: 'general',
      title: 'General',
      icon: 'pkg',
      subtitle: 'Essential business settings',
      rows: [
        { name: 'Business Profile', icon: 'building', desc: 'Business name, contact info, logo, branding and legal details.', badge: 'Complete', tone: 'success', updated: 'Updated 2 hours ago', by: 'by John Doe' },
        { name: 'Venues', icon: 'mappin', desc: 'Manage your venues, locations and operating hours.', badge: 'Complete', tone: 'success', updated: 'Updated 5 hours ago', by: 'by Sarah Lee' },
        { name: 'Regional Settings', icon: 'globe', desc: 'Language, currency, time zone and regional preferences.', badge: 'Complete', tone: 'success', updated: 'Updated 1 day ago', by: 'by John Doe' },
        { name: 'Branding', icon: 'pencil', desc: 'Customize brand identity, colors, themes and typography.', badge: 'Draft', tone: 'info', updated: 'Updated 3 days ago', by: 'by Sarah Lee' },
      ],
    },
    {
      id: 'operations',
      title: 'Operations',
      icon: 'utensils',
      subtitle: 'Configure your operations',
      rows: [
        { name: 'Reservations', icon: 'calendar', desc: 'Reservation policies, limits, confirmations and waitlist settings.', badge: 'Active', tone: 'success', updated: 'Updated 1 hour ago', by: 'by Mike Ross' },
        { name: 'Tables', icon: 'grid', desc: 'Table layout, capacity, zones and availability rules.', badge: 'Active', tone: 'success', updated: 'Updated 4 hours ago', by: 'by Mike Ross' },
        { name: 'Orders', icon: 'bag', desc: 'Order types, prefixes, statuses and fulfillment settings.', badge: 'Active', tone: 'success', updated: 'Updated 2 hours ago', by: 'by Sarah Lee' },
        { name: 'Menu', icon: 'utensils', desc: 'Menu settings, categories, modifiers and availability rules.', badge: 'Active', tone: 'success', updated: 'Updated 6 hours ago', by: 'by John Doe' },
        { name: 'Kitchen', icon: 'monitor', desc: 'Kitchen stations, printers, routing and timing settings.', badge: 'Active', tone: 'success', extra: '3 devices online', updated: 'Updated 1 day ago', by: 'by Mike Ross' },
        { name: 'Inventory', icon: 'leaf', desc: 'Inventory tracking, alerts, recipes and stock adjustments.', badge: 'Active', tone: 'success', updated: 'Updated 2 days ago', by: 'by Sarah Lee' },
      ],
    },
    {
      id: 'people',
      title: 'People',
      icon: 'users',
      subtitle: 'Manage your team',
      rows: [
        { name: 'Staff', icon: 'users', desc: 'Staff profiles, invitations and account access.', badge: 'Active', tone: 'success', updated: 'Updated 1 day ago', by: 'by John Doe' },
        { name: 'Roles & Permissions', icon: 'shield', desc: 'Role definitions and permission levels per module.', badge: 'Active', tone: 'success', updated: 'Updated 3 days ago', by: 'by Mike Ross' },
        { name: 'Audit Logs', icon: 'filetext', desc: 'Activity trail, change history and log retention.', badge: 'Active', tone: 'success', updated: 'Updated 5 days ago', by: 'by Sarah Lee' },
      ],
    },
    {
      id: 'customers',
      title: 'Customers',
      icon: 'bell',
      subtitle: 'Guest engagement',
      rows: [
        { name: 'Notifications', icon: 'bell', desc: 'Guest alerts, confirmations and reminder preferences.', badge: 'Active', tone: 'success', updated: 'Updated 1 day ago', by: 'by Sarah Lee' },
        { name: 'Messaging', icon: 'message', desc: 'SMS and email templates, sender identity and channels.', badge: 'Draft', tone: 'info', updated: 'Updated 4 days ago', by: 'by John Doe' },
        { name: 'Loyalty', icon: 'gift', desc: 'Rewards program, points rules and member tiers.', badge: 'Draft', tone: 'info', updated: 'Updated 1 week ago', by: 'by Mike Ross' },
      ],
    },
    {
      id: 'finance',
      title: 'Finance',
      icon: 'card',
      subtitle: 'Payments and billing',
      rows: [
        { name: 'Payments', icon: 'card', desc: 'Payment methods, gateways, tipping and payout settings.', badge: 'Active', tone: 'success', updated: 'Updated 3 hours ago', by: 'by John Doe' },
        { name: 'Taxes', icon: 'dollar', desc: 'Tax rates, GST/VAT rules and tax-inclusive pricing.', badge: 'Attention needed', tone: 'warning', updated: 'Updated 2 weeks ago', by: 'by Mike Ross' },
        { name: 'Receipts', icon: 'receipt', desc: 'Receipt layout, legal footer and print settings.', badge: 'Complete', tone: 'success', updated: 'Updated 2 days ago', by: 'by Sarah Lee' },
        { name: 'Billing', icon: 'trend', desc: 'Subscription plan, invoices and payment history.', badge: 'Active', tone: 'success', updated: 'Updated 1 week ago', by: 'by John Doe' },
      ],
    },
    {
      id: 'system',
      title: 'System',
      icon: 'gear',
      subtitle: 'Platform and security',
      rows: [
        { name: 'Integrations', icon: 'plug', desc: 'POS sync, delivery platforms and third-party connections.', badge: 'Active', tone: 'success', extra: '4 connected', updated: 'Updated 6 hours ago', by: 'by Mike Ross' },
        { name: 'API Keys', icon: 'key', desc: 'API credentials, scopes and key rotation.', badge: 'Active', tone: 'success', updated: 'Updated 1 week ago', by: 'by John Doe' },
        { name: 'Webhooks', icon: 'branch', desc: 'Event subscriptions, endpoints and delivery logs.', badge: 'Draft', tone: 'info', updated: 'Updated 2 weeks ago', by: 'by Mike Ross' },
        { name: 'Security', icon: 'shield', desc: 'Two-factor auth, session policies and IP restrictions.', badge: 'Complete', tone: 'success', updated: 'Updated 3 days ago', by: 'by Sarah Lee' },
        { name: 'Backup', icon: 'database', desc: 'Automatic backups, retention and restore points.', badge: 'Active', tone: 'success', updated: 'Updated 12 hours ago', by: 'by John Doe' },
      ],
    },
  ];

  // Derive badge styling
  const getBadgeStyle = (tone: 'success' | 'info' | 'warning') => {
    const map = {
      success: { bg: 'var(--green-50)', fg: 'var(--green-700)' },
      info: { bg: 'var(--blue-50)', fg: 'var(--blue-700)' },
      warning: { bg: 'var(--amber-50)', fg: 'var(--amber-700)' },
    };
    return map[tone] || map.success;
  };

  // Pinned settings mapping
  const pinnedItems = [
    { name: 'Business Profile', icon: 'building', status: 'Complete', good: true },
    { name: 'Payments', icon: 'card', status: 'Connected', good: true },
    { name: 'Taxes', icon: 'receipt', status: 'Attention needed', good: false },
    { name: 'Receipts', icon: 'filetext', status: 'Published', good: true },
  ].map((p) => ({
    name: p.name,
    status: p.status,
    icon: getIcon(p.icon, 18),
    tileBg: p.good ? 'var(--green-50)' : 'var(--amber-50)',
    tileFg: p.good ? 'var(--green-600)' : 'var(--amber-600)',
    statusFg: p.good ? 'var(--green-700)' : 'var(--amber-600)',
    dot: p.good ? 'var(--green-500)' : 'var(--amber-500)',
  }));

  // Filtering states logic
  const q = query.trim().toLowerCase();
  const catFilter = category;
  const statusFilter = status;
  const isFiltering = q !== '' || catFilter !== 'All categories' || statusFilter !== 'All status';

  const filteredSections = SECTIONS_DATA
    .filter((sec) => catFilter === 'All categories' || sec.title === catFilter)
    .map((sec) => {
      const rows = sec.rows
        .filter((r) => statusFilter === 'All status' || r.badge === statusFilter)
        .filter((r) => !q || r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q));
      
      const open = isFiltering ? rows.length > 0 : !!openSections[sec.id];
      return {
        ...sec,
        rows,
        open,
        count: sec.rows.length,
        chev: open ? 0 : -90,
      };
    })
    .filter((sec) => !isFiltering || sec.rows.length > 0);

  // Health chart variables
  const healthScore = 92;
  const circ = 2 * Math.PI * 37;
  const ringDash = `${(circ * healthScore / 100).toFixed(1)} ${circ.toFixed(1)}`;

  // Issues under Needs Attention
  const issues = [
    { title: 'Taxes configuration incomplete', sub: 'Add GST and VAT rules', dot: 'var(--amber-500)' },
    { title: 'Kitchen printer offline', sub: 'Grill Station Printer', dot: 'var(--amber-500)' },
    { title: '2 users pending invitation', sub: 'Send invitations to activate', dot: 'var(--amber-500)' },
  ];

  // Recently changed activities
  const avatarTones = [
    { bg: 'var(--blue-100)', fg: 'var(--blue-700)' },
    { bg: 'var(--violet-100)', fg: 'var(--violet-600)' },
    { bg: 'var(--green-100)', fg: 'var(--green-700)' },
    { bg: 'var(--amber-100)', fg: 'var(--amber-700)' },
  ];
  const recentChanges = [
    { name: 'Mike Ross', action: 'Updated Taxes settings', when: '10 min ago' },
    { name: 'Sarah Lee', action: 'Updated Branding', when: '1 hour ago' },
    { name: 'John Doe', action: 'Added new venue', when: '3 hours ago' },
    { name: 'Mike Ross', action: 'Updated Kitchen settings', when: '5 hours ago' },
  ].map((r, i) => ({
    ...r,
    initials: r.name.split(' ').map((w) => w[0]).join(''),
    avatarBg: avatarTones[i % 4].bg,
    avatarFg: avatarTones[i % 4].fg,
  }));

  // Quick actions
  const quickActions = [
    { label: 'Import Settings', icon: 'download' },
    { label: 'Export Settings', icon: 'upload' },
    { label: 'Configuration History', icon: 'history' },
    { label: 'Restore Backup', icon: 'restore' },
  ].map((qa) => ({ label: qa.label, icon: getIcon(qa.icon, 14) }));

  // Dropdown list options
  const categoryOptions = ['All categories', 'General', 'Operations', 'People', 'Customers', 'Finance', 'System'];
  const statusOptions = ['All status', 'Complete', 'Active', 'Draft', 'Attention needed'];

  // Route click redirect mapper
  const handleRowClick = (name: string) => {
    const routeMap: Record<string, string> = {
      'Venues': '/venue',
      'Tables': '/settings/tables',
      'Reservations': '/reservations',
      'Orders': '/orders',
      'Kitchen': '/kitchen-display',
      'Menu': '/menu-management',
      'Inventory': '/inventory',
      'Staff': '/staff',
      'Audit Logs': '/audit',
      'Payments': '/payments',
      'Integrations': '/IntegrationTools',
    };
    const path = routeMap[name];
    if (path) {
      navigate(path);
    }
  };

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* CSS Hover rule definitions injected cleanly */}
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-hover-surface-2:hover {
          background-color: var(--color-surface-2) !important;
        }
        .custom-hover-surface-3:hover {
          background-color: var(--color-surface-3) !important;
        }
        .custom-hover-shadow-sm:hover {
          border-color: var(--color-border-strong) !important;
          box-shadow: var(--shadow-sm) !important;
        }
      `}} />

      {/* Main Grid Layout exactly matching template.html */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '24px', padding: '24px', alignItems: 'start' }}>
        
        {/* ======== LEFT COLUMN / MAIN CONTENT ======== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0 }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', lineHeight: '32px', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>Settings</h1>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>Manage every aspect of your restaurant</p>
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '256px', height: '36px', padding: '0 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }}><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search all settings..."
                style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: '13px', flex: 1, minWidth: 0, color: 'var(--color-text)' }}
              />
            </div>

            {/* Category Filter Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => {
                  setCatMenuOpen(!catMenuOpen);
                  setStatusMenuOpen(false);
                }}
                className="custom-hover-surface-2"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}
              >
                {category}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-tertiary)' }}><path d="m6 9 6 6 6-6"></path></svg>
              </button>
              {catMenuOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, minWidth: '170px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: '4px', display: 'flex', flexDirection: 'column' }}>
                  {categoryOptions.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        setCategory(opt);
                        setCatMenuOpen(false);
                      }}
                      className="custom-hover-surface-3"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', textAlign: 'left', color: 'var(--color-text)', fontWeight: opt === category ? 600 : 400 }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Status Filter Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => {
                  setStatusMenuOpen(!statusMenuOpen);
                  setCatMenuOpen(false);
                }}
                className="custom-hover-surface-2"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}
              >
                {status}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-tertiary)' }}><path d="m6 9 6 6 6-6"></path></svg>
              </button>
              {statusMenuOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, minWidth: '150px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: '4px', display: 'flex', flexDirection: 'column' }}>
                  {statusOptions.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        setStatus(opt);
                        setStatusMenuOpen(false);
                      }}
                      className="custom-hover-surface-3"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', textAlign: 'left', color: 'var(--color-text)', fontWeight: opt === status ? 600 : 400 }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}></div>

            {/* Import / Export */}
            <button
              className="custom-hover-surface-3"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>
              Import / Export
            </button>

            {/* Preferences */}
            <button
              className="custom-hover-surface-3"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              Preferences
            </button>
          </div>

          {/* Pinned Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-secondary)' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              Pinned
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              {pinnedItems.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleRowClick(p.name)}
                  className="custom-hover-shadow-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)', minWidth: 0, overflow: 'hidden', transition: 'box-shadow var(--duration-fast) var(--ease-in-out)' }}
                >
                  <span style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: p.tileBg, color: p.tileFg, flexShrink: 0 }}>
                    {p.icon}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: p.statusFg, whiteSpace: 'nowrap' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: p.dot, flexShrink: 0 }}></span>
                      {p.status}
                    </span>
                  </span>
                </button>
              ))}

              <button
                className="custom-hover-surface-2"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '13px 14px', background: 'transparent', border: '1px dashed var(--color-border-strong)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>
                Pin settings
              </button>
            </div>
          </div>

          {/* Collapsible Category Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filteredSections.map((sec) => (
              <div key={sec.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                {/* Section Header Button */}
                <button
                  onClick={() => toggleSection(sec.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '15px 20px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left' }}
                >
                  <span style={{ display: 'inline-flex', width: '20px', height: '20px', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
                    {getIcon(sec.icon, 18)}
                  </span>
                  <span style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--color-primary)' }}>{sec.title}</span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', background: 'var(--color-surface-3)', borderRadius: 'var(--radius-full)', padding: '1px 8px' }}>{sec.count}</span>
                  
                  <span style={{ flex: 1 }}></span>
                  
                  <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginRight: '4px' }}>{sec.subtitle}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-secondary)', transform: `rotate(${sec.chev}deg)`, transition: 'transform var(--duration-base) var(--ease-in-out)' }}><path d="m6 9 6 6 6-6"></path></svg>
                </button>

                {/* Section Content (open/closed) */}
                {sec.open && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {sec.rows.map((row, rIdx) => {
                      const bStyle = getBadgeStyle(row.tone);
                      return (
                        <button
                          key={rIdx}
                          onClick={() => handleRowClick(row.name)}
                          className="custom-hover-surface-2"
                          style={{ display: 'grid', gridTemplateColumns: '40px minmax(120px,150px) minmax(0,1fr) minmax(110px,190px) minmax(100px,170px) 20px', gap: '16px', alignItems: 'center', width: '100%', padding: '13px 20px', border: 'none', borderTop: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left', overflow: 'hidden', transition: 'background var(--duration-fast) var(--ease-in-out)' }}
                        >
                          {/* Row Icon */}
                          <span style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green-50)', color: 'var(--green-600)' }}>
                            {getIcon(row.icon, 18)}
                          </span>

                          {/* Row Name */}
                          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>{row.name}</span>

                          {/* Row Desc */}
                          <span style={{ fontSize: '13px', lineHeight: '18px', color: 'var(--color-text-secondary)' }}>{row.desc}</span>

                          {/* Badges */}
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: 500, padding: '3px 10px', borderRadius: 'var(--radius-full)', background: bStyle.bg, color: bStyle.fg }}>
                              {row.badge}
                            </span>
                            {row.extra && (
                              <span style={{ fontSize: '12px', fontWeight: 500, padding: '3px 10px', borderRadius: 'var(--radius-full)', background: 'var(--color-surface)', border: '1px solid var(--color-success-border)', color: 'var(--color-success)' }}>
                                {row.extra}
                              </span>
                            )}
                          </span>

                          {/* Last Updated */}
                          <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontSize: '13px', color: 'var(--gray-700)' }}>{row.updated}</span>
                            <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>{row.by}</span>
                          </span>

                          {/* Chevron Right */}
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-tertiary)' }}><path d="m9 18 6-6-6-6"></path></svg>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Bottom Tip Bar */}
          {tipVisible && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '11px 16px', background: 'var(--green-50)', border: '1px solid var(--color-success-border)', borderRadius: 'var(--radius-md)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--green-700)', flexShrink: 0 }}><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>
              <span style={{ fontSize: '13px', color: 'var(--green-800)' }}><strong style={{ fontWeight: 600 }}>Tip:</strong>&nbsp; Press ⌘K anytime to search settings quickly</span>
              
              <span style={{ flex: 1 }}></span>
              
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setTipVisible(false);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--green-700)', textDecoration: 'none' }}
              >
                Dismiss tip
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>
              </a>
            </div>
          )}

        </div>

        {/* ======== RIGHT COLUMN / RIGHT RAIL (aside) ======== */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Card 1: Configuration Health */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid ' + 'var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px 18px 0', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>Configuration Health</span>
              <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-link)', textDecoration: 'none' }}>View report</a>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 0 18px' }}>
              {/* Circular gauge */}
              <div style={{ position: 'relative', width: '88px', height: '88px', flexShrink: 0 }}>
                <svg width="88" height="88" viewBox="0 0 88 88">
                  <circle cx="44" cy="44" r="37" fill="none" stroke="var(--gray-100)" strokeWidth="8"></circle>
                  <circle cx="44" cy="44" r="37" fill="none" stroke="var(--color-primary)" strokeWidth="8" strokeLinecap="round" strokeDasharray={ringDash} transform="rotate(-90 44 44)"></circle>
                </svg>
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>{healthScore}%</span>
              </div>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: '19px', color: 'var(--color-text-secondary)' }}>Great job! Your configuration is almost perfect.</p>
            </div>
            <button
              className="custom-hover-green-100"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', margin: '0 -18px', padding: '12px 18px', border: 'none', borderTop: '1px solid var(--color-success-border)', background: 'var(--green-50)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 500, color: 'var(--green-800)', transition: 'background-color var(--duration-fast) var(--ease-in-out)' }}
            >
              3 recommendations to improve
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
            </button>
          </div>

          {/* Card 2: Needs Attention */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>Needs Attention</span>
              <span style={{ minWidth: '20px', height: '20px', borderRadius: 'var(--radius-full)', background: 'var(--amber-100)', color: 'var(--amber-700)', fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>3</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
              {issues.map((iss, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: iss.dot, marginTop: '5px', flexShrink: 0 }}></span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}>{iss.title}</span>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{iss.sub}</span>
                  </span>
                </div>
              ))}
            </div>
            <a href="#" onClick={(e) => e.preventDefault()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-link)', textDecoration: 'none' }}>
              View all issues
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
            </a>
          </div>

          {/* Card 3: Recently Changed */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>Recently Changed</span>
              <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-link)', textDecoration: 'none' }}>View all</a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {recentChanges.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ width: '30px', height: '30px', borderRadius: 'var(--radius-full)', background: r.avatarBg, color: r.avatarFg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600, flexShrink: 0 }}>{r.initials}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.action}</span>
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>{r.when}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 4: Quick Actions */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>Quick Actions</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {quickActions.map((qa, idx) => (
                <button
                  key={idx}
                  className="custom-hover-surface-3"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', height: '38px', padding: '0 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap', transition: 'background-color var(--duration-fast) var(--ease-in-out)' }}
                >
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>{qa.icon}</span>
                  {qa.label}
                </button>
              ))}
            </div>
          </div>

        </aside>

      </div>
    </div>
  );
}

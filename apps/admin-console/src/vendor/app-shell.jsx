// @ts-nocheck
/* AppShell — the Verdura admin shell: sidebar + top bar + routed content. */
function AppShell() {
  const { Sidebar, TopBar, Input, IconButton, Avatar, Button, EmptyState, Badge } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const [active, setActive] = React.useState('dashboard');
  const [collapsed, setCollapsed] = React.useState(false);
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const groups = [
    { title: 'Operations', items: [
      { key: 'dashboard', label: 'Dashboard', icon: <I.dashboard /> },
      { key: 'reservations', label: 'Reservations', icon: <I.calendar />, badge: '24' },
      { key: 'orders', label: 'Orders', icon: <I.orders />, badge: '11' },
      { key: 'kitchen', label: 'Kitchen Operations', icon: <I.kitchen /> },
      { key: 'menu', label: 'Menu Management', icon: <I.menu /> },
    ]},
    { title: 'Service Channels', items: [
      { key: 'kitchen_display', label: 'Kitchen Display', icon: <I.kitchen_display /> },
      { key: 'kiosk_window', label: 'Kiosk-Window', icon: <I.kiosks /> },
      { key: 'kiosk_table_window', label: 'Kiosk-Table Window', icon: <I.kiosks /> },
    ]},
    { title: 'Business', items: [
      { key: 'payments', label: 'Payments', icon: <I.payments /> },
      { key: 'inventory', label: 'Inventory', icon: <I.inventory /> },
      { key: 'staff', label: 'Staff', icon: <I.staff /> },
      { key: 'venues', label: 'Venues', icon: <I.venues /> },
    ]},
    { title: 'System', items: [
      { key: 'printers', label: 'Printers', icon: <I.printer /> },
      { key: 'pos', label: 'POS Sync', icon: <I.sync /> },
      { key: 'audit', label: 'Audit Logs', icon: <I.audit /> },
      { key: 'reports', label: 'Reports', icon: <I.reports /> },
      { key: 'settings', label: 'Settings', icon: <I.settings /> },
    ]},
  ];

  const meta = {
    dashboard: { title: 'Dashboard', crumb: 'Operations', sub: "Thursday, June 19 · Verdura — Downtown" },
    reservations: { title: 'Reservations', crumb: 'Operations / Reservations' },
    orders: { title: 'Orders', crumb: 'Operations / Orders' },
    kitchen: { title: 'Kitchen Operations', crumb: 'Operations / Kitchen' },
    kitchen_display: { title: 'Kitchen Display', crumb: 'Service Channels / Kitchen Display' },
    kiosk_window: { title: 'Kiosk-Window', crumb: 'Service Channels / Kiosk-Window' },
    kiosk_table_window: { title: 'Kiosk-Table Window', crumb: 'Service Channels / Kiosk-Table Window' },
    payments: { title: 'Payments', crumb: 'Business / Payments' },
    inventory: { title: 'Inventory', crumb: 'Business / Inventory' },
  };
  const m = meta[active] || { title: groups.flatMap(g => g.items).find(i => i.key === active)?.label, crumb: '' };

  const screens = {
    dashboard: window.DashboardScreen, reservations: window.ReservationsScreen,
    orders: window.OrdersScreen, kitchen: window.KitchenScreen, payments: window.PaymentsScreen,
    kitchen_display: window.KitchenDisplayScreen, kiosk_window: window.KiosksScreen, kiosks: window.KiosksScreen,
  };
  const Screen = screens[active];

  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '6px 0' : '6px 8px', justifyContent: collapsed ? 'center' : 'flex-start' }}>
      <Avatar name="Mohammed Chowdhury" size="sm" status="online" />
      {!collapsed && (
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Mohammed Chowdhury</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Executive Director</div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--color-bg)' }}>
      <Sidebar groups={groups} active={active} onNavigate={setActive} collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)} footer={footer} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar
          title={m.title} breadcrumb={m.crumb}
          search={<Input fullWidth={false} placeholder="Search venues, guests, orders…" leftIcon={<I.search size={15} />} containerStyle={{ width: 280 }} />}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconButton variant="ghost" aria-label="Toggle theme" onClick={() => setDark(!dark)}>
                {dark
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M5 5l1.5 1.5M17.5 17.5 19 19M2 12h2M20 12h2M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>}
              </IconButton>
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <IconButton variant="ghost" aria-label="Notifications"><I.bell /></IconButton>
                <span style={{ position: 'absolute', top: 6, right: 7, width: 7, height: 7, borderRadius: '50%', background: 'var(--color-danger)', border: '2px solid var(--color-surface)' }} />
              </span>
              <div style={{ width: 1, height: 22, background: 'var(--color-border)', margin: '0 2px' }} />
              <Avatar name="Mohammed Chowdhury" size="md" status="online" />
            </div>
          }
        />
        <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {Screen ? <Screen /> : (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
              <EmptyState
                icon={(I[active] ? React.createElement(I[active], { size: 22 }) : <I.dashboard size={22} />)}
                title={`${m.title} module`}
                description="This surface is part of the Verdura platform. Dashboard, Reservations, Orders, Kitchen Operations, and Payments are wired as interactive demos in this kit."
                action={<Button variant="secondary" onClick={() => setActive('dashboard')} iconLeft={<I.arrowRight size={15} />}>Back to dashboard</Button>}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
window.AppShell = AppShell;

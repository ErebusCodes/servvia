import React, { useState, useEffect, useMemo, useCallback } from 'react';

// Expose React globally for the design-system bundle
(window as any).React = React;

import '../../vendor/design-system.js';

import { FilterState, ComparisonState, SavedReportView, CustomReportConfig, ScheduledExportConfig, UserRole } from './types';
import { getReportData, getLiveUpdateTick, formatValueForRole } from './mockData';
import { DrillDownDrawer } from './DrillDownDrawer';
import { ReportBuilder } from './ReportBuilder';
import { InsightsPanel } from './InsightsPanel';

// ---- Icon set (Lucide-style path data) ----
const PATHS = {
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  calendar: ['M3 4h18v18H3z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  orders: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
  menu: ['M3 11h18', 'M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4', 'M5 11l1 9h12l1-9', 'M9 16h6'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  tablet: ['M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z', 'M12 18h.01'],
  payments: ['M2 5h20v14H2z', 'M2 10h20'],
  package: ['M12 2 21 7v10l-9 5-9-5V7l9-5Z', 'M3 7l9 5 9-5', 'M12 12v10'],
  staff: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  venues: ['M3 21h18', 'M5 21V7l8-4v18', 'M19 21V11l-6-3', 'M9 9v.01', 'M9 13v.01', 'M9 17v.01'],
  printer: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z'],
  sync: ['M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', 'M21 21v-5h-5'],
  audit: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  reports: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm21 21-4.3-4.3'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  dollar: ['M12 2v20', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  check: ['M20 6 9 17l-5-5'],
  checkCircle: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm8.5 12 2.5 2.5 4.5-5'],
  xCircle: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm15 9-6 6', 'm9 9 6 6'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z'],
  receipt: ['M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z', 'M8 7h8', 'M8 11h8', 'M8 15h5'],
  trend: ['M22 7 13.5 15.5l-5-5L2 17', 'M16 7h6v6'],
  chevDown: ['M6 9l6 6 6-6'],
  chevLeft: ['M15 6l-6 6 6 6'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  arrowRight: ['M5 12h14', 'M13 6l6 6-6 6'],
  timer: ['M10 2h4', 'M12 14l3-3', 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  truck: ['M1 3h15v13H1z', 'M16 8h4l3 3v5h-7', 'M5.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M18.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  percent: ['M19 5 5 19', 'M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  wallet: ['M3 6h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z', 'M3 6V5a2 2 0 0 1 2-2h11', 'M18 12h.01'],
  refund: ['M3 7v6h6', 'M3.5 13a9 9 0 1 0 2-9.5L3 8'],
  zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8Z'],
  layers: ['M12 2 2 7l10 5 10-5-10-5Z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
  star: ['M12 2 15 8.5 22 9.5 17 14.5 18.5 21.5 12 18 5.5 21.5 7 14.5 2 9.5 9 8.5Z'],
  trophy: ['M6 9a6 6 0 0 0 12 0V3H6Z', 'M6 5H3a2 2 0 0 0 0 4h1.5', 'M18 5h3a2 2 0 0 1 0 4h-1.5', 'M9 21h6', 'M12 15v6'],
  bag: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
};

function Ic({ name, size = 18, sw = 2, style = {} }: { name: string; size?: number; sw?: number; style?: React.CSSProperties }) {
  const paths = PATHS[name as keyof typeof PATHS] || PATHS.reports;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {paths.map((d, i) => (
        <path d={d} key={i} />
      ))}
    </svg>
  );
}

const INITIAL_SAVED_VIEWS: SavedReportView[] = [
  { id: 'view-1', name: 'Owner Dashboard', tab: 'sales', filters: { venue: 'all', service: 'all' }, comparison: { enabled: false, type: 'prev_period' } },
  { id: 'view-2', name: 'Kitchen Performance Focus', tab: 'kitchen', filters: { kitchenStation: 'main' }, comparison: { enabled: false, type: 'prev_period' } },
  { id: 'view-3', name: 'Friday Dinner Review', tab: 'sales', filters: { shift: 'evening' }, comparison: { enabled: true, type: 'prev_period' } }
];

export function ReportsPage() {
  const [tab, setTab] = useState('sales');
  const [filters, setFilters] = useState<FilterState>({
    dateRange: 'last7',
    venue: 'all',
    service: 'all',
    orderType: 'all',
    shift: 'all',
    kitchenStation: 'all',
    staff: 'all',
    category: 'all',
    menuItem: 'all',
    paymentMethod: 'all',
    customerType: 'all',
    discount: 'all',
    promotion: 'all',
    supplier: 'all',
    reservationSource: 'all',
    posTerminal: 'all',
    device: 'all',
    orderStatus: 'all',
    table: 'all',
    channel: 'all',
    deliveryPartner: 'all',
    taxClass: 'all',
    searchQuery: '',
  });

  const [comparison, setComparison] = useState<ComparisonState>({
    enabled: false,
    type: 'prev_period',
  });

  const [savedViews, setSavedViews] = useState<SavedReportView[]>(INITIAL_SAVED_VIEWS);
  const [activeViewId, setActiveViewId] = useState('view-1');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewRenameId, setViewRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  
  // Custom Saved Views lists
  const [customViews, setCustomViews] = useState<string[]>([]);
  const [favoriteViews, setFavoriteViews] = useState<string[]>(['view-1']);
  
  const [customReports, setCustomReports] = useState<CustomReportConfig[]>([]);

  // Enterprise Control States
  const [role, setRole] = useState<UserRole>('owner');
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [liveInterval, setLiveInterval] = useState(5); // in seconds
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toLocaleTimeString());
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Simulation switches
  const [simulateSlowLoad, setSimulateSlowLoad] = useState(false);
  const [simulateError, setSimulateError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Drilldown side drawer states
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillType, setDrillType] = useState('item');
  const [drillName, setDrillName] = useState('');

  // Custom KPI layout preferences
  const [hiddenKpis, setHiddenKpis] = useState<Record<string, string[]>>({});
  const [showKpiConfig, setShowKpiConfig] = useState(false);

  // Export split dropdown properties
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'excel' | 'pdf'>('csv');
  const [exportScope, setExportScope] = useState<'view' | 'entire' | 'selected'>('view');
  
  // Scheduled Report lists
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleConfig, setScheduleConfig] = useState<Partial<ScheduledExportConfig>>({
    frequency: 'daily',
    format: 'pdf',
    recipients: '',
    subject: 'Scheduled Operations Report'
  });
  const [schedules, setSchedules] = useState<ScheduledExportConfig[]>([]);

  // Legend series visibility toggles
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);

  // Table view properties
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>('comfortable');

  // Advanced filters collapsible state
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  // Load baseline dynamic datasets
  const reportsData = useMemo(() => {
    return getReportData(filters, role);
  }, [filters, role]);

  const [liveData, setLiveData] = useState(reportsData);

  // Sync liveData on reportsData updates
  useEffect(() => {
    setLiveData(reportsData);
  }, [reportsData]);

  // Live Auto-Refresh simulation loop
  useEffect(() => {
    if (!isLiveMode) return;
    const interval = setInterval(() => {
      setIsSyncing(true);
      setLiveData(prev => getLiveUpdateTick(prev, tab));
      setLastUpdated(new Date().toLocaleTimeString());
      setTimeout(() => setIsSyncing(false), 600);
    }, liveInterval * 1000);

    return () => clearInterval(interval);
  }, [isLiveMode, liveInterval, tab]);

  // Handle manual refresh
  const triggerManualRefresh = () => {
    setIsLoading(true);
    setIsSyncing(true);
    setTimeout(() => {
      setLiveData(getReportData(filters, role));
      setLastUpdated(new Date().toLocaleTimeString());
      setIsLoading(false);
      setIsSyncing(false);
    }, simulateSlowLoad ? 1500 : 400);
  };

  // Expose Design System components
  const DS = (window as any).DesignSystem_7f3fe8 || {};
  const { Badge, Button, Card, CardHeader, DataTable, StatCard, Tabs } = DS;

  // Cross-Report Navigation resolution callback
  const handleResolveInsight = useCallback((targetTab: string, filtersToApply: any) => {
    setTab(targetTab);
    setFilters(prev => ({
      ...prev,
      ...filtersToApply
    }));
  }, []);

  const handleKPISelectToggle = (kpiLabel: string) => {
    const activeList = hiddenKpis[tab] || [];
    if (activeList.includes(kpiLabel)) {
      setHiddenKpis({ ...hiddenKpis, [tab]: activeList.filter(x => x !== kpiLabel) });
    } else {
      setHiddenKpis({ ...hiddenKpis, [tab]: [...activeList, kpiLabel] });
    }
  };

  const handleSelectView = (view: SavedReportView) => {
    setActiveViewId(view.id);
    setTab(view.tab);
    if (view.filters) {
      setFilters(prev => ({ ...prev, ...view.filters }));
    }
    if (view.comparison) setComparison(view.comparison);
  };

  const handleSaveReportConfig = (cfg: CustomReportConfig) => {
    setCustomReports([...customReports, cfg]);
    alert(`Custom Report "${cfg.name}" saved successfully!`);
  };

  // Saved Views Controls
  const handleSaveViewPreset = (name: string) => {
    const newView: SavedReportView = {
      id: 'custom-' + Date.now().toString(),
      name,
      tab,
      filters: { ...filters },
      comparison: { ...comparison }
    };
    setSavedViews([...savedViews, newView]);
    setCustomViews([...customViews, newView.id]);
    setActiveViewId(newView.id);
  };

  const handleDuplicateView = (id: string) => {
    const base = savedViews.find(x => x.id === id);
    if (!base) return;
    const newView: SavedReportView = {
      ...base,
      id: 'custom-' + Date.now().toString(),
      name: `${base.name} Copy`
    };
    setSavedViews([...savedViews, newView]);
    setCustomViews([...customViews, newView.id]);
    setActiveViewId(newView.id);
  };

  const handleRenameView = (id: string, newName: string) => {
    setSavedViews(savedViews.map(v => v.id === id ? { ...v, name: newName } : v));
    setViewRenameId(null);
    setRenameValue('');
  };

  const toggleFavoriteView = (id: string) => {
    if (favoriteViews.includes(id)) {
      setFavoriteViews(favoriteViews.filter(x => x !== id));
    } else {
      setFavoriteViews([...favoriteViews, id]);
    }
  };

  const handleSetDefaultView = (id: string) => {
    localStorage.setItem('verdura_default_report_view', id);
    setSavedViews(savedViews.map(v => ({ ...v, isDefault: v.id === id })));
    alert(`Set "${savedViews.find(x => x.id === id)?.name}" as your default report view.`);
  };

  const handleDeleteViewPreset = (id: string) => {
    setSavedViews(savedViews.filter(x => x.id !== id));
    setCustomViews(customViews.filter(x => x !== id));
    if (activeViewId === id) {
      setActiveViewId('view-1');
    }
  };

  // Export split dropdown handler
  const handleTriggerExportOption = (format: 'csv' | 'excel' | 'pdf' | 'print' | 'raw') => {
    setExportMenuOpen(false);
    if (format === 'print') {
      window.print();
      return;
    }
    setExportFormat(format === 'raw' ? 'csv' : format);
    setShowExportModal(true);
  };

  const handleTriggerExport = () => {
    setShowExportModal(false);
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      const csvContent = "data:text/csv;charset=utf-8,Report Export\nTimestamp," + new Date().toLocaleString() + "\nTab," + tab;
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `verdura_${tab}_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, 600);
  };

  // Add scheduled export presets
  const handleAddSchedule = () => {
    if (!scheduleConfig.recipients) return;
    const newSched: ScheduledExportConfig = {
      id: Date.now().toString(),
      reportName: tab.toUpperCase() + ' Report Summary',
      frequency: scheduleConfig.frequency || 'daily',
      format: scheduleConfig.format || 'pdf',
      recipients: scheduleConfig.recipients,
      deliveryTime: scheduleConfig.deliveryTime || '09:00 AM',
      subject: scheduleConfig.subject || 'Scheduled Report',
      created: new Date().toLocaleDateString()
    };
    setSchedules([...schedules, newSched]);
    setShowScheduleModal(false);
    setScheduleConfig({ frequency: 'daily', format: 'pdf', recipients: '', subject: 'Scheduled Operations Report' });
    alert(`Report delivery scheduled successfully for ${scheduleConfig.recipients}`);
  };

  // KPI Grid Customizer
  const kpiGrid = (cards: any[]) => {
    const list = hiddenKpis[tab] || [];
    const visibleCards = cards.filter(c => !list.includes(c.label));

    if (visibleCards.length === 0) {
      return (
        <div style={{ padding: 20, textAlign: 'center', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--color-text-tertiary)' }}>
          All KPI Cards hidden. Click Config to re-enable.
        </div>
      );
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {visibleCards.map((c, i) =>
          StatCard ? (
            <div key={i} onClick={() => {
              setDrillType('kpi');
              setDrillName(c.label);
              setDrillOpen(true);
            }} style={{ cursor: 'pointer' }}>
              <StatCard
                label={c.label}
                value={c.value}
                delta={c.delta}
                trend={c.trend || 'flat'}
                positiveIsGood={c.positiveIsGood !== false}
                icon={<Ic name={c.icon} size={17} />}
                hint={c.hint}
              />
            </div>
          ) : null
        )}
      </div>
    );
  };

  const card = (title: string, subtitle: string, body: React.ReactNode, action?: React.ReactNode) => (
    <Card padding="none">
      <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <CardHeader title={title} subtitle={subtitle} style={{ marginBottom: 0 }} />
        {action || null}
      </div>
      <div style={{ padding: '4px 20px 20px' }}>{body}</div>
    </Card>
  );

  const tableCard = (title: string, subtitle: string, columns: any[], rows: any[], action?: React.ReactNode) => (
    <Card padding="none">
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <CardHeader title={title} subtitle={subtitle} style={{ marginBottom: 0 }} />
        {action || null}
      </div>
      <div style={{ borderTop: '1px solid var(--color-border)' }}>
        <DataTable
          columns={columns}
          rows={rows}
          density={tableDensity}
          style={{ border: 'none', borderRadius: 0 }}
        />
      </div>
    </Card>
  );

  // SVG Chart Components with Hover/Interactive handlers
  const barsV = (data: { l: string; v: number }[], opts: any = {}) => {
    const max = Math.max(...data.map((d) => d.v)) || 1;
    const fmt = opts.fmt || ((v: number) => v.toString());
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: data.length > 9 ? 6 : 12, height: opts.height || 180, padding: '8px 0 0', position: 'relative' }}>
        {data.map((t) => (
          <div
            key={t.l}
            onClick={() => {
              setDrillType('station');
              setDrillName(t.l);
              setDrillOpen(true);
            }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(t.v)}</span>
            <div
              style={{
                width: '100%',
                maxWidth: 34,
                minHeight: 2,
                height: `${(t.v / max) * 100}%`,
                background: t.v === max ? 'var(--color-primary)' : 'var(--color-primary-subtle)',
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                border: t.v === max ? 'none' : '1px solid var(--color-success-border)',
                borderBottom: 'none',
                transition: 'height .3s'
              }}
            />
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>{t.l}</span>
          </div>
        ))}
      </div>
    );
  };

  const barList = (rows: any[], opts: any = {}) => {
    const max = opts.max || Math.max(...rows.map((r) => r.v)) || 1;
    const fmt = opts.fmt || ((v: number) => v.toString());
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            onClick={() => {
              setDrillType(tab === 'staff' ? 'staff' : 'item');
              setDrillName(r.l);
              setDrillOpen(true);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, gap: 10 }}>
              <span style={{ color: 'var(--color-text)', display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                {r.badge || null}
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.l}</span>
              </span>
              <span style={{ fontWeight: 600, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {fmt(r.v)}
                {r.sub ? <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, marginLeft: 6 }}>{r.sub}</span> : null}
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--color-surface-3)', borderRadius: 'var(--radius-full)' }}>
              <div style={{ width: `${Math.max(2, (r.v / max) * 100)}%`, height: '100%', background: r.c || 'var(--color-primary)', borderRadius: 'var(--radius-full)', transition: 'width .3s' }} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const donut = (segs: any[], opts: any = {}) => {
    const size = opts.size || 168, sw = opts.sw || 26;
    const visibleSegs = segs.filter(s => !hiddenSeries.includes(s.l));
    const total = visibleSegs.reduce((s, x) => s + x.v, 0) || 1;
    const r = (size - sw) / 2, circ = 2 * Math.PI * r;
    let acc = 0;
    
    const circles = visibleSegs.map((s, i) => {
      const len = (s.v / total) * circ;
      const el = (
        <circle
          key={i}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={s.c}
          strokeWidth={sw}
          strokeDasharray={`${len} ${circ - len}`}
          strokeDashoffset={-acc}
          onClick={() => {
            setDrillType('payment');
            setDrillName(s.l);
            setDrillOpen(true);
          }}
          style={{ cursor: 'pointer', transition: 'stroke-width 0.15s' }}
        />
      );
      acc += len;
      return el;
    });

    const fmt = opts.fmt || ((v: number) => v.toString());
    const toggleSeries = (label: string) => {
      if (hiddenSeries.includes(label)) {
        setHiddenSeries(hiddenSeries.filter(x => x !== label));
      } else {
        setHiddenSeries([...hiddenSeries, label]);
      }
    };

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
            {circles}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {opts.centerLabel != null ? opts.centerLabel : fmt(total)}
            </span>
            {opts.centerSub && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{opts.centerSub}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 150 }}>
          {segs.map((s, i) => {
            const isHidden = hiddenSeries.includes(s.l);
            return (
              <div key={i} onClick={() => toggleSeries(s.l)} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer', opacity: isHidden ? 0.45 : 1 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.c, flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--color-text)' }}>{s.l}</span>
                <span style={{ fontWeight: 600, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.v)}</span>
                <span style={{ color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums', width: 42, textAlign: 'right' }}>
                  {total > 0 ? Math.round((s.v / total) * 100) : 0}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const line = (data: { l: string; v: number }[], opts: any = {}) => {
    const W = 640, H = opts.height || 180, padB = 26, padT = 14, padX = 12;
    const n = data.length;
    const max = Math.max(...data.map((d) => d.v)) * 1.18 || 1;
    const color = opts.color || 'var(--chart-1)';
    const xs = (i: number) => padX + (i / (n - 1)) * (W - padX * 2);
    const ys = (v: number) => H - padB - (v / max) * (H - padB - padT);
    const linePts = data.map((d, i) => xs(i) + ',' + ys(d.v)).join(' ');
    const areaD = 'M' + xs(0) + ',' + (H - padB) + ' L' + data.map((d, i) => xs(i) + ',' + ys(d.v)).join(' L') + ' L' + xs(n - 1) + ',' + (H - padB) + ' Z';
    
    return (
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
          {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
            <line
              key={i}
              x1={padX}
              x2={W - padX}
              y1={padT + g * (H - padB - padT)}
              y2={padT + g * (H - padB - padT)}
              stroke="var(--chart-grid)"
              strokeWidth={1}
              strokeDasharray={i === 4 ? '0' : '3 3'}
            />
          ))}
          <path d={areaD} fill={color} fillOpacity={0.1} />
          <polyline points={linePts} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {data.map((d, i) => (
            <circle
              key={i}
              cx={xs(i)}
              cy={ys(d.v)}
              r={3}
              fill="var(--color-surface)"
              stroke={color}
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setDrillType('kpi');
                setDrillName(`Trend for ${d.l}`);
                setDrillOpen(true);
              }}
            />
          ))}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, padding: '0 8px' }}>
          {data.map((d, i) => (
            <span key={i} style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{d.l}</span>
          ))}
        </div>
      </div>
    );
  };

  const splitComp = (a: { l: string; v: number; c: string }, b: { l: string; v: number; c: string }, opts: any = {}) => {
    const total = a.v + b.v || 1;
    const fmt = opts.fmt || ((v: number) => v.toString());
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', height: 36, borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <div style={{ width: (a.v / total * 100) + '%', background: a.c, display: 'flex', alignItems: 'center', paddingLeft: 12, color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {Math.round(a.v / total * 100)}%
          </div>
          <div style={{ width: (b.v / total * 100) + '%', background: b.c, display: 'flex', alignItems: 'center', paddingLeft: 12, color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {Math.round(b.v / total * 100)}%
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          {[a, b].map((x, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: x.c }} />
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{x.l}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(x.v)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const money = (v: number) => formatValueForRole(v, role, true);
  const mono = (t: string) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{t}</span>;

  // ---------- TABS RENDERERS ----------
  const tabSales = () => {
    const data = liveData.sales || {};
    const metrics = (data.kpi || []).slice(0, 5);
    const salesCard: React.CSSProperties = {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-xs)',
    };
    return (
      <div className="sales-report-spec">
        <style>{`
          .sales-report-spec{display:flex;flex-direction:column;gap:14px}
          .sales-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
          .sales-kpi{min-height:130px;padding:14px 16px;display:flex;flex-direction:column;justify-content:space-between}
          .sales-primary-grid{display:grid;grid-template-columns:minmax(190px,.72fr) minmax(300px,1.04fr) minmax(300px,1fr);gap:12px;align-items:stretch}
          .sales-bottom-grid{display:grid;grid-template-columns:1fr 1.08fr;gap:12px;align-items:start}
          @media(max-width:1300px){.sales-kpis{grid-template-columns:repeat(3,1fr)}.sales-primary-grid{grid-template-columns:1fr 1fr}.sales-primary-grid>*:last-child{grid-column:1/-1}}
          @media(max-width:900px){.sales-kpis{grid-template-columns:repeat(2,1fr)}.sales-primary-grid,.sales-bottom-grid{grid-template-columns:1fr}.sales-primary-grid>*:last-child{grid-column:auto}}
        `}</style>

        <div className="sales-kpis">
          {metrics.map((metric: any) => (
            <button
              key={metric.label}
              onClick={() => { setDrillType('kpi'); setDrillName(metric.label); setDrillOpen(true); }}
              className="sales-kpi"
              style={{ ...salesCard, textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 10, lineHeight: 1.2, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{metric.label}</span>
                <span style={{ width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center', color: 'var(--color-success)', background: 'var(--color-success-bg)' }}><Ic name={metric.icon} size={16}/></span>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><strong style={{ fontSize: 25, lineHeight: 1, letterSpacing: '-.025em', fontVariantNumeric: 'tabular-nums' }}>{metric.value}</strong><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-success)' }}>⌁ {metric.delta}</span></div>
                <div style={{ marginTop: 14, color: 'var(--color-text-secondary)', fontSize: 10 }}>{metric.hint}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="sales-primary-grid">
          <div style={{ ...salesCard, minHeight: 214, padding: 16, position: 'relative', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Top Selling Item</span><span style={{ width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center', color: 'var(--color-success)', background: 'var(--color-success-bg)' }}><Ic name="star" size={17}/></span></div>
            <div style={{ marginTop: 16, maxWidth: 120 }}><strong style={{ display: 'block', fontSize: 21, lineHeight: 1.05, letterSpacing: '-.02em' }}>Grilled<br/>Halloumi</strong><span style={{ display: 'block', marginTop: 18, color: 'var(--color-text-secondary)', fontSize: 12 }}>142 sold</span><span style={{ display: 'block', marginTop: 12, color: 'var(--color-text-secondary)', fontSize: 12 }}>$2,840 in sales</span></div>
            <div aria-hidden="true" style={{ position: 'absolute', right: -12, bottom: -16, width: 150, height: 112, borderRadius: '55% 45% 50% 45%', background: 'radial-gradient(ellipse at center, #e6f4e8 0 33%, #f5d489 34% 43%, #b96b27 44% 49%, #f4d17a 50% 57%, #eef2ec 58%)', transform: 'rotate(-8deg)', boxShadow: '0 7px 18px rgba(15,23,42,.14)' }}/>
          </div>

          <div style={{ ...salesCard, minHeight: 214, padding: '16px 16px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}><div><h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Sales Trend</h3><p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--color-text-secondary)' }}>Net sales · last 7 days</p></div><span style={{ padding: '5px 8px', borderRadius: 5, background: 'var(--color-success-bg)', color: 'var(--color-success)', fontSize: 10, fontWeight: 700 }}>⌁ 9.4%</span></div>
            <div style={{ marginTop: 2 }}>{line(data.trend || [], { color: 'var(--chart-1)', height: 145 })}</div>
          </div>

          <div style={{ ...salesCard, minHeight: 214, padding: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Sales by Service Type</h3><p style={{ margin: '4px 0 8px', fontSize: 10, color: 'var(--color-text-secondary)' }}>Share of net sales</p>
            {donut(data.service || [], { size: 142, sw: 22, fmt: (v: number) => money(v), centerLabel: money(21940), centerSub: 'Net sales' })}
          </div>
        </div>

        <div style={{ ...salesCard, padding: '16px 16px 10px' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Sales by Hour</h3><p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--color-text-secondary)' }}>Revenue distribution across the day</p>
          {barsV(data.hour || [], { fmt: (v: number) => '$' + (v / 1000).toFixed(2) + 'K', height: 128 })}
        </div>

        <div className="sales-bottom-grid">
          <div style={{ ...salesCard, padding: 16 }}><h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Top Menu Items</h3><p style={{ margin: '4px 0 12px', fontSize: 10, color: 'var(--color-text-secondary)' }}>By revenue</p>{barList(data.items || [], { fmt: (v: number) => money(v) })}</div>
          <div style={{ ...salesCard, padding: 16 }}><h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Sales by Category</h3><p style={{ margin: '4px 0 12px', fontSize: 10, color: 'var(--color-text-secondary)' }}>Net sales share</p>{barList(data.categories || [], { fmt: (v: number) => money(v) })}</div>
        </div>
      </div>
    );
  };

  const tabKitchen = () => {
    const data = liveData.kitchen || {};
    const slaCol = [
      { key: 'item', header: 'Menu Item', render: (r: any) => <span style={{ fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer' }} onClick={() => { setDrillType('item'); setDrillName(r.item); setDrillOpen(true); }}>{r.item}</span> },
      { key: 'station', header: 'Station', render: (r: any) => <span style={{ color: 'var(--color-text-secondary)' }}>{r.station}</span> },
      { key: 'count', header: 'Delayed', width: 100, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.count}</span> },
      { key: 'avg', header: 'Avg Over SLA', width: 130, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ color: 'var(--color-danger)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{'+' + r.avg}</span> },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {kpiGrid(data.kpi || [])}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {card('Prep Time by Station', 'Average minutes per ticket', barList((data.prep || []).map((p: any) => ({ l: p.l, v: p.v, c: p.v > 15 ? 'var(--color-warning)' : 'var(--color-primary)' })), { fmt: (v: number) => v.toFixed(1) + 'm' }))}
          {card('Delayed Orders by Station', 'Tickets over SLA', barList(data.delayed || []))}
        </div>
        {card('Average Ticket Time', 'End-to-end completion time by hour', line(data.ticket || [], { color: 'var(--chart-3)', height: 180 }))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {tableCard('Top Delayed Menu Items', 'Most frequent SLA breaches', slaCol, data.topDelayed || [])}
          {card('Station Throughput', 'Orders completed per hour', barList(data.throughput || [], { fmt: (v: number) => v + '/hr' }))}
        </div>
      </div>
    );
  };

  const tabOps = () => {
    const data = liveData.operations || {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {kpiGrid(data.kpi || [])}
        {card('Orders by Hour', 'Order volume across the day', barsV(data.hour || [], { fmt: (v: number) => v.toString(), height: 200 }))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {card('Orders by Type', 'Channel mix', donut(data.type || [], { centerLabel: '412', centerSub: 'Orders' }))}
          {card('Orders by Status', 'Current distribution', barList(data.status || []))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {card('Dine-in vs Take Away', 'Order split', splitComp(data.splitDine?.a, data.splitDine?.b))}
          {card('Delivery vs Pickup', 'Within Take Away', splitComp(data.splitDel?.a, data.splitDel?.b))}
        </div>
      </div>
    );
  };

  const tabInventory = () => {
    const data = liveData.inventory || {};
    const lowCols = [
      { key: 'item', header: 'Ingredient', render: (r: any) => <span style={{ fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer' }} onClick={() => { setDrillType('item'); setDrillName(r.item); setDrillOpen(true); }}>{r.item}</span> },
      { key: 'onhand', header: 'On Hand', width: 110, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.onhand}</span> },
      { key: 'par', header: 'Par Level', width: 110, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{r.par}</span> },
      { key: 'status', header: 'Status', width: 130, render: (r: any) => <Badge tone={r.status === 'critical' ? 'danger' : 'warning'}>{r.status === 'critical' ? 'Critical' : 'Low'}</Badge> },
    ];

    const reorderCols = [
      { key: 'item', header: 'Ingredient', render: (r: any) => <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.item}</span> },
      { key: 'supplier', header: 'Supplier', render: (r: any) => <span style={{ color: 'var(--color-text-secondary)' }}>{r.supplier}</span> },
      { key: 'qty', header: 'Reorder Qty', width: 130, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.qty}</span> },
      { key: 'eta', header: 'ETA', width: 100, align: 'right' as const, render: (r: any) => <span style={{ color: 'var(--color-text-secondary)' }}>{r.eta}</span> },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {kpiGrid(data.kpi || [])}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {tableCard('Low Stock List', 'Items below par level', lowCols, data.lowStock || [])}
          {card('Waste by Category', 'Cost of waste', barList(data.waste || [], { fmt: (v: number) => money(v) }))}
        </div>
        {card('Inventory Usage Trend', 'Total ingredient consumption · last 6 weeks ($k)', line(data.usage || [], { color: 'var(--chart-4)', height: 180 }))}
        {tableCard('Reorder Required Items', 'Below reorder threshold', reorderCols, data.reorder || [])}
      </div>
    );
  };

  const tabStaff = () => {
    const data = liveData.staff || {};
    const perfCols = [
      { key: 'name', header: 'Staff', render: (r: any) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }} onClick={() => { setDrillType('staff'); setDrillName(r.name); setDrillOpen(true); }}>
          <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
            {r.name.split(' ').map((x: string) => x[0]).join('')}
          </span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 13 }}>{r.name}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{r.role}</div>
          </div>
        </div>
      ) },
      { key: 'orders', header: 'Orders', width: 90, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.orders}</span> },
      { key: 'prep', header: 'Avg Time', width: 100, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>{r.prep}</span> },
      { key: 'late', header: 'Late', width: 80, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontVariantNumeric: 'tabular-nums', color: r.late > 2 ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>{r.late}</span> },
      { key: 'rating', header: 'Rating', width: 110, render: (r: any) => <Badge tone={r.rating >= 4.7 ? 'success' : r.rating >= 4.3 ? 'primary' : 'warning'}>{r.rating.toFixed(1) + ' ★'}</Badge> },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {kpiGrid(data.kpi || [])}
        {tableCard('Staff Performance', 'Individual metrics this period', perfCols, data.perf || [])}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {card('Orders Completed by Staff', 'Volume per team member', barList(data.volume || []))}
          {card('Prep Time by Staff', 'Average minutes per order', barList(data.time || [], { fmt: (v: number) => v.toFixed(1) + 'm' }))}
        </div>
        {card('Shift Coverage', 'Filled vs scheduled by shift', barList((data.shift || []).map((s: any) => ({ l: s.l, v: s.v, c: s.v >= 95 ? 'var(--color-success)' : 'var(--color-warning)' })), { max: 100, fmt: (v: number) => v + '%' }))}
      </div>
    );
  };

  const tabPayments = () => {
    const data = liveData.payments || {};
    const failCols = [
      { key: 'id', header: 'Transaction', width: 140, render: (r: any) => mono(r.id) },
      { key: 'method', header: 'Method', render: (r: any) => <span style={{ color: 'var(--color-text-secondary)' }}>{r.method}</span> },
      { key: 'amount', header: 'Amount', width: 110, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(r.amount)}</span> },
      { key: 'reason', header: 'Reason', width: 170, render: (r: any) => <Badge tone="danger">{r.reason}</Badge> },
      { key: 'time', header: 'Time', width: 90, align: 'right' as const, render: (r: any) => <span style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{r.time}</span> },
    ];

    const setCols = [
      { key: 'method', header: 'Method', render: (r: any) => <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.method}</span> },
      { key: 'gross', header: 'Gross', width: 120, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.gross)}</span> },
      { key: 'fees', header: 'Fees', width: 110, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{'−' + money(r.fees)}</span> },
      { key: 'net', header: 'Net Settled', width: 130, align: 'right' as const, numeric: true, render: (r: any) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(r.net)}</span> },
      { key: 'status', header: 'Status', width: 120, render: (r: any) => <Badge tone={r.status === 'Settled' ? 'success' : 'warning'} dot={true}>{r.status}</Badge> },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {kpiGrid(data.kpi || [])}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {card('Payments by Method', 'Share of gross volume', donut(data.method || [], { fmt: (v: number) => money(v), centerLabel: money(24580), centerSub: 'Gross' }))}
          {card('Refunds Trend', 'Daily refund value', line(data.refunds || [], { color: 'var(--chart-5)', height: 190, fmt: (v: number) => money(v) }))}
        </div>
        {tableCard('Failed Transactions', 'Declined or errored payments', failCols, data.failed || [])}
        {tableCard('Payment Settlement Summary', 'Settlement by method', setCols, data.settlements || [])}
      </div>
    );
  };

  const renderContent = () => {
    if (simulateError) {
      return (
        <Card padding="lg">
          <div style={{ textAlign: 'center', padding: 40, fontFamily: 'var(--font-sans)' }}>
            <div style={{ fontSize: 44, color: 'var(--color-danger)', marginBottom: 12 }}>⚠️</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>Failed to Load Reporting Data</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 6, marginBottom: 20 }}>
              The simulated server endpoint returned a Gateway Timeout (504). Please check connection settings and retry.
            </p>
            {Button && (
              <Button variant="primary" size="md" onClick={() => setSimulateError(false)}>
                Retry Connection
              </Button>
            )}
          </div>
        </Card>
      );
    }

    if (isLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="animate-pulse" style={{ height: 100, background: 'var(--color-surface-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="animate-pulse" style={{ height: 260, background: 'var(--color-surface-2)', borderRadius: 'var(--radius-lg)' }} />
            <div className="animate-pulse" style={{ height: 260, background: 'var(--color-surface-2)', borderRadius: 'var(--radius-lg)' }} />
          </div>
          <style dangerouslySetInnerHTML={{ __html: `
            .animate-pulse {
              animation: pulse 1.5s infinite ease-in-out;
            }
            @keyframes pulse {
              0%, 100% { opacity: 0.6; }
              50% { opacity: 1; }
            }
          `}} />
        </div>
      );
    }

    switch (tab) {
      case 'sales':
        return tabSales();
      case 'kitchen':
        return tabKitchen();
      case 'operations':
        return tabOps();
      case 'inventory':
        return tabInventory();
      case 'staff':
        return tabStaff();
      case 'payments':
        return tabPayments();
      case 'builder':
        return (
          <ReportBuilder
            onSaveReport={handleSaveReportConfig}
            savedReports={customReports}
            onLoadReport={(cfg) => {
              setTab(cfg.chartType !== 'none' ? 'sales' : 'kitchen');
              alert(`Loaded report template: ${cfg.name}`);
            }}
            onDeleteReport={(id) => setCustomReports(customReports.filter(x => x.id !== id))}
          />
        );
      default:
        return null;
    }
  };

  const handleApplyFilterChips = (key: keyof FilterState, val: string) => {
    setFilters({ ...filters, [key]: val });
  };

  const activeAdvancedKeys = (Object.keys(filters) as Array<keyof FilterState>).filter(k => k !== 'dateRange' && k !== 'venue' && k !== 'service' && k !== 'orderType' && filters[k] !== 'all' && filters[k] !== '');

  const select = (label: string, val: string, onChangeFn: (v: string) => void, opts: { v: string; l: string }[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 140 }}>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
        {label}
      </span>
      <select
        value={val}
        onChange={(e) => onChangeFn(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          height: 32,
          padding: '0 24px 0 10px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          color: 'var(--color-text)',
          cursor: 'pointer',
          outline: 'none',
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center'
        }}
      >
        {opts.map((o) => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 18, width: '100%', minWidth: 0 }}>
      
      {/* Visual media class styling overlay */}
      <style dangerouslySetInnerHTML={{ __html: `
        .reports-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          gap: 20px;
          align-items: start;
          width: 100%;
        }
        @media (max-width: 1120px) {
          .reports-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .toolbar-group-container {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          align-items: center;
          width: 100%;
        }
        .toolbar-group {
          display: flex;
          align-items: center;
          gap: 10px;
          border-right: 1px solid var(--color-border);
          padding-right: 16px;
        }
        .toolbar-group:last-child {
          border-right: none;
          padding-right: 0;
        }
        @media (max-width: 900px) {
          .toolbar-group {
            border-right: none;
            padding-right: 0;
          }
        }
        .dropdown-menu-item {
          padding: 8px 12px;
          font-size: 13px;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: background 0.1s, color 0.1s;
        }
        .dropdown-menu-item:hover {
          background: var(--color-surface-3);
          color: var(--color-text);
        }
      `}} />

      {/* 2. REORGANISED TOP TOOLBAR CARD */}
      <Card padding="md" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          
          {/* Row 1: Groups 1 (Workspace), 3 (Actions), 4 (Live Status) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
            
            {/* Group 1 — Workspace */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Workspace:</span>
              <select
                value={activeViewId}
                onChange={(e) => {
                  const view = savedViews.find(x => x.id === e.target.value);
                  if (view) handleSelectView(view);
                }}
                style={{
                  height: 30,
                  padding: '0 24px 0 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border-strong)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                {savedViews.map((v) => (
                  <option key={v.id} value={v.id}>
                    {favoriteViews.includes(v.id) ? '★ ' : ''}{v.name} {v.isDefault ? '(Default)' : ''}
                  </option>
                ))}
              </select>

              {/* Saved Views Context Menu (⋯) */}
              <button
                onClick={() => setViewMenuOpen(!viewMenuOpen)}
                style={{
                  border: 'none',
                  background: 'var(--color-surface-3)',
                  color: 'var(--color-text-secondary)',
                  width: 30,
                  height: 30,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ⋯
              </button>

              {viewMenuOpen && (
                <div style={{
                  position: 'absolute',
                  top: 36,
                  left: 70,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: 'var(--shadow-md)',
                  zIndex: 200,
                  width: 180,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '4px 0',
                }}>
                  <div className="dropdown-menu-item" onClick={() => { toggleFavoriteView(activeViewId); setViewMenuOpen(false); }}>
                    {favoriteViews.includes(activeViewId) ? 'Unfavourite View' : '★ Favourite View'}
                  </div>
                  <div className="dropdown-menu-item" onClick={() => { setViewRenameId(activeViewId); setRenameValue(savedViews.find(x => x.id === activeViewId)?.name || ''); setViewMenuOpen(false); }}>
                    ✏️ Rename View
                  </div>
                  <div className="dropdown-menu-item" onClick={() => { handleDuplicateView(activeViewId); setViewMenuOpen(false); }}>
                    📋 Duplicate View
                  </div>
                  <div className="dropdown-menu-item" onClick={() => { handleSetDefaultView(activeViewId); setViewMenuOpen(false); }}>
                    📌 Set as Default
                  </div>
                  <div className="dropdown-menu-item" onClick={() => { alert('View shared! Link copied to clipboard.'); setViewMenuOpen(false); }}>
                    🔗 Share View
                  </div>
                  {customViews.includes(activeViewId) && (
                    <div className="dropdown-menu-item" style={{ color: 'var(--color-danger)' }} onClick={() => { handleDeleteViewPreset(activeViewId); setViewMenuOpen(false); }}>
                      🗑️ Delete View
                    </div>
                  )}
                </div>
              )}

              {Button && (
                <Button variant="secondary" size="sm" onClick={() => setShowSaveViewModal(true)}>
                  Save Current View
                </Button>
              )}
            </div>

            {/* Group 3 — Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
              {Button && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setShowKpiConfig(!showKpiConfig)}>
                    ⚙️ KPI Customization
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setTableDensity(tableDensity === 'comfortable' ? 'compact' : 'comfortable')}>
                    {tableDensity === 'comfortable' ? 'Compact Grid' : 'Comfortable Grid'}
                  </Button>

                  {/* Split Dropdown Export button */}
                  <div style={{ display: 'inline-flex', height: 28 }}>
                    <button
                      onClick={() => handleTriggerExportOption('csv')}
                      style={{
                        padding: '0 10px',
                        border: '1px solid var(--color-border-strong)',
                        borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)',
                        background: 'var(--color-primary)',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                    >
                      <Ic name="download" size={13} /> Export
                    </button>
                    <button
                      onClick={() => setExportMenuOpen(!exportMenuOpen)}
                      style={{
                        padding: '0 6px',
                        border: '1px solid var(--color-border-strong)',
                        borderLeft: 'none',
                        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                        background: 'var(--color-primary)',
                        color: '#fff',
                        fontSize: 10,
                        cursor: 'pointer'
                      }}
                    >
                      ▼
                    </button>
                  </div>

                  {exportMenuOpen && (
                    <div style={{
                      position: 'absolute',
                      top: 32,
                      right: 120,
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      boxShadow: 'var(--shadow-md)',
                      zIndex: 200,
                      width: 170,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '4px 0',
                    }}>
                      <div className="dropdown-menu-item" onClick={() => handleTriggerExportOption('csv')}>Export CSV</div>
                      <div className="dropdown-menu-item" onClick={() => handleTriggerExportOption('excel')}>Export Excel</div>
                      <div className="dropdown-menu-item" onClick={() => handleTriggerExportOption('pdf')}>Export PDF</div>
                      <div className="dropdown-menu-item" onClick={() => handleTriggerExportOption('print')}>Print Report</div>
                    </div>
                  )}

                  <Button variant="secondary" size="sm" onClick={() => setShowScheduleModal(true)}>
                    Schedule Delivery
                  </Button>
                </>
              )}
            </div>

            {/* Group 4 — Live Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: isLiveMode ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                  display: 'inline-block'
                }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={isLiveMode}
                    onChange={(e) => setIsLiveMode(e.target.checked)}
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                  Live Update
                </label>
              </div>

              {isLiveMode && (
                <select
                  value={liveInterval}
                  onChange={(e) => setLiveInterval(Number(e.target.value))}
                  style={{
                    height: 24,
                    padding: '0 4px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border-strong)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                    fontSize: 11
                  }}
                >
                  <option value={5}>5s interval</option>
                  <option value={10}>10s interval</option>
                  <option value={30}>30s interval</option>
                </select>
              )}

              <span style={{ color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                Sync: {lastUpdated}
              </span>

              <button
                onClick={triggerManualRefresh}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--color-text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: isSyncing ? 'spin 0.6s linear infinite' : 'none'
                }}
              >
                <Ic name="sync" size={14} />
              </button>
            </div>

          </div>

          {/* Row 2: Group 2 — Filters */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
            {select('Date range', filters.dateRange, (v) => handleApplyFilterChips('dateRange', v), [
              { v: 'today', l: 'Today' },
              { v: 'yesterday', l: 'Yesterday' },
              { v: 'last7', l: 'Last 7 Days' },
              { v: 'last30', l: 'Last 30 Days' },
              { v: 'custom', l: 'Custom Range' }
            ])}

            {select('Venue', filters.venue, (v) => handleApplyFilterChips('venue', v), [
              { v: 'all', l: 'All Venues' },
              { v: 'verdura', l: 'Verdura — Downtown' },
              { v: 'v2', l: 'Verdura — Marina' },
              { v: 'v3', l: 'Verdura — Airport' }
            ])}

            {select('Service type', filters.service, (v) => {
              setFilters({ ...filters, service: v, orderType: 'all' });
            }, [
              { v: 'all', l: 'All' },
              { v: 'dinein', l: 'Dine-in' },
              { v: 'takeaway', l: 'Take Away' }
            ])}

            {select('Order type', filters.orderType, (v) => handleApplyFilterChips('orderType', v), [
              { v: 'all', l: 'All' },
              { v: 'delivery', l: 'Delivery' },
              { v: 'pickup', l: 'Pickup' }
            ])}

            {select('Compare Against', comparison.enabled ? comparison.type : 'none', (v) => {
              if (v === 'none') setComparison({ ...comparison, enabled: false });
              else setComparison({ enabled: true, type: v as any });
            }, [
              { v: 'none', l: 'No Comparison' },
              { v: 'prev_period', l: 'Previous Period' },
              { v: 'prev_year', l: 'Previous Year' }
            ])}

            {Button && (
              <Button variant="secondary" size="md" onClick={() => setFiltersCollapsed(!filtersCollapsed)} style={{ height: 32 }}>
                {filtersCollapsed ? 'More Filters' : 'Hide Filters'}
              </Button>
            )}
          </div>

          {/* More Filters collapsible grid */}
          {!filtersCollapsed && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, paddingTop: 14, borderTop: '1px dashed var(--color-border)' }}>
              {select('Shift', filters.shift, (v) => handleApplyFilterChips('shift', v), [
                { v: 'all', l: 'All Shifts' },
                { v: 'morning', l: 'Morning' },
                { v: 'afternoon', l: 'Afternoon' },
                { v: 'evening', l: 'Evening' }
              ])}

              {select('Kitchen Station', filters.kitchenStation, (v) => handleApplyFilterChips('kitchenStation', v), [
                { v: 'all', l: 'All Stations' },
                { v: 'main', l: 'Main Kitchen' },
                { v: 'pizza', l: 'Pizza & Oven' },
                { v: 'grill', l: 'Grill' }
              ])}

              {select('Employee', filters.staff, (v) => handleApplyFilterChips('staff', v), [
                { v: 'all', l: 'All Staff' },
                { v: 'maya', l: 'Maya Othman' },
                { v: 'diego', l: 'Diego Santos' },
                { v: 'aisha', l: 'Aisha Karim' }
              ])}

              {select('Category', filters.category, (v) => handleApplyFilterChips('category', v), [
                { v: 'all', l: 'All Categories' },
                { v: 'mains', l: 'Mains' },
                { v: 'pizza', l: 'Pizza & Oven' },
                { v: 'starters', l: 'Starters' }
              ])}

              {select('Menu Item', filters.menuItem, (v) => handleApplyFilterChips('menuItem', v), [
                { v: 'all', l: 'All Items' },
                { v: 'halloumi', l: 'Grilled Halloumi' },
                { v: 'shawarma', l: 'Lamb Shawarma' }
              ])}

              {select('Payment Method', filters.paymentMethod, (v) => handleApplyFilterChips('paymentMethod', v), [
                { v: 'all', l: 'All Methods' },
                { v: 'card', l: 'Card' },
                { v: 'cash', l: 'Cash' }
              ])}

              {select('POS Terminal', filters.posTerminal, (v) => handleApplyFilterChips('posTerminal', v), [
                { v: 'all', l: 'All Terminals' },
                { v: 'term_a', l: 'Terminal A' },
                { v: 'term_b', l: 'Terminal B' }
              ])}
            </div>
          )}

          {/* Active Chips row */}
          {activeAdvancedKeys.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
              {activeAdvancedKeys.map((key) => (
                <span
                  key={key}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'var(--color-surface-3)',
                    color: 'var(--color-text-secondary)',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    textTransform: 'uppercase',
                  }}
                >
                  {key.replace(/([A-Z])/g, ' $1')}: {filters[key]}
                  <button
                    onClick={() => handleApplyFilterChips(key, 'all')}
                    style={{ border: 'none', background: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

        </div>
      </Card>

      {/* Restored Report Navigation Tabs */}
      {Tabs && (
        <div style={{ marginBottom: 4 }}>
          <Tabs
            tabs={[
              { key: 'sales', label: 'Sales' },
              { key: 'kitchen', label: 'Kitchen Performance' },
              { key: 'operations', label: 'Operations' },
              { key: 'inventory', label: 'Inventory' },
              { key: 'staff', label: 'Staff' },
              { key: 'payments', label: 'Payments' },
              { key: 'builder', label: 'Custom Builder' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>
      )}

      {/* Main Content Grid — 1. RESOLVED HORIZONTAL SCROLLING via CSS reports-grid wrapper */}
      <div className="reports-grid">
        
        {/* Left Side: Report Tab Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {renderContent()}
        </div>

        {/* Right Side: Live Insights Panel */}
        {tab !== 'builder' && (
          <div style={{ position: 'sticky', top: 20 }}>
            <InsightsPanel tab={tab} onResolveAction={handleResolveInsight} onDrillDown={(t, n) => { setDrillType(t); setDrillName(n); setDrillOpen(true); }} />
          </div>
        )}

      </div>

      {/* Inline View Rename Dialog Modal */}
      {viewRenameId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontWeight: 600, color: 'var(--color-text)' }}>Rename Saved View</h4>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              style={{ height: 36, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {Button && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setViewRenameId(null)}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => handleRenameView(viewRenameId, renameValue)}>Save</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save View Modal overlay */}
      {showSaveViewModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontWeight: 600, color: 'var(--color-text)' }}>Save View Preset</h4>
            <input
              type="text"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder="e.g. My Weekend Sales"
              style={{ height: 36, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {Button && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { setShowSaveViewModal(false); setNewViewName(''); }}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => {
                    if (newViewName.trim()) {
                      handleSaveViewPreset(newViewName.trim());
                      setShowSaveViewModal(false);
                      setNewViewName('');
                    }
                  }}>Save</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Split Export Modal dialog */}
      {showExportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 24, width: 380, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h4 style={{ fontWeight: 600, color: 'var(--color-text)' }}>Export Data Scope</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Scope</span>
              <select
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value as any)}
                style={{ height: 32, padding: '0 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              >
                <option value="view">Current Tab View only</option>
                <option value="entire">Entire Consolidated Suite</option>
                <option value="selected">Filtered Rows only</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {Button && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setShowExportModal(false)}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleTriggerExport}>Export Now</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Schedule delivery modal dialog */}
      {showScheduleModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 24, width: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h4 style={{ fontWeight: 600, color: 'var(--color-text)' }}>Schedule Delivery Configuration</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Recipient Email(s)</span>
                <input
                  type="text"
                  value={scheduleConfig.recipients}
                  onChange={(e) => setScheduleConfig({ ...scheduleConfig, recipients: e.target.value })}
                  placeholder="e.g. controller@verdura.com"
                  style={{ height: 36, padding: '0 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Frequency</span>
                  <select
                    value={scheduleConfig.frequency}
                    onChange={(e) => setScheduleConfig({ ...scheduleConfig, frequency: e.target.value as any })}
                    style={{ height: 32, padding: '0 4px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
                    <option value="daily">Daily Summary</option>
                    <option value="weekly">Weekly Digest</option>
                    <option value="monthly">Monthly Audit</option>
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Format</span>
                  <select
                    value={scheduleConfig.format}
                    onChange={(e) => setScheduleConfig({ ...scheduleConfig, format: e.target.value as any })}
                    style={{ height: 32, padding: '0 4px', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
                    <option value="pdf">PDF Attachment</option>
                    <option value="csv">CSV Sheet</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {Button && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setShowScheduleModal(false)}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleAddSchedule}>Schedule Delivery</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. DEVELOPER CONTROLS PANEL AT BOTTOM */}
      <Card padding="md" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', marginTop: 24 }}>
        <details>
          <summary style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', outline: 'none' }}>
            Developer Debug Console
          </summary>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>View Role:</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                style={{ height: 28, padding: '0 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }}
              >
                <option value="owner">Owner / GM</option>
                <option value="admin">System Admin</option>
                <option value="finance">Finance Controller</option>
                <option value="operations">Operations Director</option>
                <option value="kitchen">Kitchen Manager</option>
                <option value="venueManager">Venue Manager</option>
                <option value="staff">Floor Staff</option>
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <input
                type="checkbox"
                checked={simulateSlowLoad}
                onChange={(e) => setSimulateSlowLoad(e.target.checked)}
                style={{ accentColor: 'var(--color-primary)' }}
              />
              Simulate Slow Network Load
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <input
                type="checkbox"
                checked={simulateError}
                onChange={(e) => setSimulateError(e.target.checked)}
                style={{ accentColor: 'var(--color-danger)' }}
              />
              Simulate Server Connection Error (504)
            </label>
          </div>
        </details>
      </Card>

      {/* KPI Customize Config Panel */}
      {showKpiConfig && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 24, width: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Visible KPI Cards ({tab.toUpperCase()})</h4>
              <button onClick={() => setShowKpiConfig(false)} style={{ border: 'none', background: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontWeight: 'bold' }}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxHeight: 300, overflowY: 'auto' }}>
              {['Total Sales', 'Net Sales', 'Orders', 'Average Order Value', 'Covers', 'Top Selling Item', 'Average Prep Time', 'SLA Compliance', 'Delayed Orders', 'Fastest Station', 'Slowest Station', 'Orders Completed', 'Stock Value', 'Low Stock Items', 'Waste Cost', 'Stock Variance', 'Most Used Ingredient', 'Reorder Alerts', 'Active Staff', 'Orders Handled', 'Average Service Time', 'Best Performer', 'Late Tasks', 'Shift Coverage', 'Gross Payments', 'Net Payments', 'Refunds', 'Failed Payments', 'Card Fees', 'Cash Collected'].map((kpiName) => {
                const list = hiddenKpis[tab] || [];
                const isVisible = !list.includes(kpiName);
                return (
                  <label key={kpiName} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--color-text)' }}>
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => handleKPISelectToggle(kpiName)}
                      style={{ accentColor: 'var(--color-primary)' }}
                    />
                    {kpiName}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Slide-in drill drawer panel */}
      <DrillDownDrawer
        isOpen={drillOpen}
        onClose={() => setDrillOpen(false)}
        targetType={drillType}
        targetName={drillName}
      />

    </div>
  );
}

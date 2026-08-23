import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface KpiStats {
  revenue: number; revenueYesterday: number; revenueDeltaPct: number;
  avgTicket: number;
}

const MOCK_KPI: KpiStats = {
  revenue: 18240, revenueYesterday: 16220, revenueDeltaPct: 12.4, avgTicket: 73.55,
};

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-2 shadow-xs flex flex-col ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex items-center justify-between mb-1">
      <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase">{title}</h3>
      {action && (
        <button className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5">
          {action}
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}

interface KpiCardProps {
  title: string; value: string; delta: string; subtext: string;
  sparklineColor: string; sparklinePoints: number[];
  icon: ReactNode; iconBg: string; iconColor: string;
}

function KpiCard({ title, value, delta, subtext, sparklineColor, sparklinePoints, icon, iconBg, iconColor }: KpiCardProps) {
  const gradId = `grad-${title.replace(/\W/g, '')}`;
  const path = sparklinePoints.map((v, i) => {
    const x = (i / (sparklinePoints.length - 1)) * 100;
    const y = 20 - v;
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-2.5 pt-2 pb-0 shadow-xs flex flex-col justify-between relative overflow-hidden h-[80px] hover:border-gray-300 transition-colors select-none">
      <div className="flex flex-col gap-0.5 z-10">
        <div className="flex items-center gap-1">
          <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>{icon}</span>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none">{title}</span>
        </div>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="text-lg font-black text-gray-900 tabular-nums leading-none">{value}</span>
          <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-emerald-600 leading-none">
            <svg className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
            {delta}
          </span>
        </div>
        <div className="text-[10px] text-gray-400 font-semibold leading-none mt-0.5">{subtext}</div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[24px] pointer-events-none">
        <svg className="w-full h-full" viewBox="0 0 100 20" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sparklineColor} stopOpacity="0.1" />
              <stop offset="100%" stopColor={sparklineColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${path} L 100 20 L 0 20 Z`} fill={`url(#${gradId})`} />
          <path d={path} fill="none" stroke={sparklineColor} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function LiveFloorPlan() {
  const t = (status: 'available' | 'occupied' | 'reserved' | 'cleaning' | 'waiting', circle = false) => {
    const base = "flex items-center justify-center font-bold text-xs shadow-xs cursor-pointer hover:scale-105 transition-all ";
    const shape = circle ? "w-7.5 h-7.5 rounded-full" : "w-9.5 h-7.5 rounded-lg";
    const styles = { available: 'border border-emerald-300 bg-emerald-50 text-emerald-700', occupied: 'border border-red-300 bg-red-100 text-red-700', reserved: 'border border-amber-300 bg-amber-100 text-amber-700', cleaning: 'border border-blue-300 bg-blue-100 text-blue-700', waiting: 'border border-purple-300 bg-purple-100 text-purple-700' };
    return `${base} ${shape} ${styles[status]}`;
  };
  return (
    <Card className="flex-1 justify-between h-full">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1">
            <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase">Live Floor Plan</h3>
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <button className="text-xs font-semibold text-emerald-600 flex items-center gap-0.5">View full plan <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg></button>
        </div>
        <div className="flex gap-3 items-center justify-center py-2">
          <div className="grid grid-cols-4 gap-x-2 gap-y-2">
            <div className={t('available')}>1</div><div className={t('occupied')}>2</div><div className={t('occupied')}>3</div><div className={t('reserved')}>4</div>
            <div className={t('available')}>5</div><div className={t('available')}>6</div><div className={t('reserved', true)}>7</div><div className={t('reserved', true)}>8</div>
            <div className={t('cleaning')}>9</div><div className={t('occupied')}>10</div><div className={t('reserved')}>11</div><div className={t('reserved')}>12</div>
          </div>
          <div className="w-px h-20 bg-gray-200" />
          <div className="flex flex-col gap-1.5">
            <div className={`${t('available')} !w-7.5 !h-7.5`}>13</div>
            <div className={`${t('occupied')} !w-7.5 !h-7.5`}>14</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1 mt-2 pt-2 border-t border-gray-100 text-[11px] font-semibold text-gray-500">
        {[['bg-emerald-500','Available','11'],['bg-red-500','Occupied','22'],['bg-amber-500','Reserved','8'],['bg-blue-500','Cleaning','2'],['bg-purple-500','Waiting','5']].map(([c,l,n]) => (
          <span key={l} className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${c}`} />{l} <strong className="text-gray-700">{n}</strong></span>
        ))}
      </div>
    </Card>
  );
}

function KitchenPerformance() {
  const capacity = 78;
  const statusText = 'NORMAL';
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setProgress(capacity), 100);
    return () => clearTimeout(timer);
  }, [capacity]);

  const strokeWidth = 4.2;
  const gapSize = 6.5; // Math gap size to ensure rounded caps don't overlap

  // Green progress values
  const greenOffset = -(gapSize / 2);
  const greenDash = Math.max(0.1, progress - gapSize);

  // Grey track values (the remaining part of the circle)
  const greyOffset = -(progress + gapSize / 2);
  const greyDash = Math.max(0.1, 100 - progress - gapSize);

  return (
    <Card className="flex-1 justify-between h-full">
      <div>
        <SectionHeader title="Kitchen Performance" action="Open KDS" />
        <div className="grid grid-cols-[1fr_1fr] gap-3 items-center">
          <div className="flex flex-col gap-1.5 text-[11px]">
            {[['bg-gray-400','Active Orders','18'],['bg-emerald-500','Ready','4'],['bg-amber-500','Cooking','5'],['bg-blue-500','Preparing','6'],['bg-red-500','Delayed','3']].map(([c,l,n]) => (
              <div key={l} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-gray-500"><span className={`w-1.5 h-1.5 rounded-full ${c} shrink-0`} />{l}</span>
                <span className="font-bold text-gray-800">{n}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center">
            <div className="relative w-[96px] h-[96px]">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
                {/* Background track circle with gap and rounded caps */}
                <circle
                  cx="20"
                  cy="20"
                  r="15.9155"
                  className="text-gray-100"
                  stroke="currentColor"
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${greyDash} 100`}
                  strokeDashoffset={greyOffset}
                  strokeLinecap="round"
                  fill="none"
                />
                {/* Foreground progress circle with gap and rounded caps */}
                <circle
                  cx="20"
                  cy="20"
                  r="15.9155"
                  className="text-emerald-500 transition-all duration-1000 ease-out"
                  stroke="currentColor"
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${greenDash} 100`}
                  strokeDashoffset={greenOffset}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="flex items-baseline justify-center">
                  <span className="text-[26px] font-black text-gray-800 leading-none">{progress}</span>
                  <span className="text-[14px] font-bold text-gray-800 ml-0.5">%</span>
                </div>
                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider mt-1.5">NORMAL</span>
              </div>
            </div>
            <span className="text-[12px] font-bold text-gray-500 mt-2">Kitchen Capacity</span>
          </div>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
        <div className="text-[11px] font-semibold text-gray-400">Longest Running Ticket</div>
        <div className="text-right">
          <div className="text-sm font-black text-red-600">23 min</div>
          <div className="text-[10px] text-gray-400 font-medium">Order #4832 • Table 14</div>
        </div>
      </div>
    </Card>
  );
}

function OrderChannels() {
  const [animationProgress, setAnimationProgress] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setAnimationProgress(1), 100);
    return () => clearTimeout(timer);
  }, []);

  const rawChannels = [
    { color: 'bg-emerald-500', stroke: '#10b981', label: 'Walk-in', count: 62, pctVal: 40, pct: '40%' },
    { color: 'bg-blue-500', stroke: '#3b82f6', label: 'Order Tablet', count: 38, pctVal: 24, pct: '24%' },
    { color: 'bg-amber-500', stroke: '#f59e0b', label: 'QR / Kiosk', count: 28, pctVal: 18, pct: '18%' },
    { color: 'bg-purple-500', stroke: '#8b5cf6', label: 'Website', count: 16, pctVal: 10, pct: '10%' },
    { color: 'bg-red-500', stroke: '#ef4444', label: 'Uber Eats', count: 6, pctVal: 4, pct: '4%' },
    { color: 'bg-pink-500', stroke: '#ec4899', label: 'DoorDash', count: 4, pctVal: 3, pct: '3%' },
    { color: 'bg-gray-400', stroke: '#9ca3af', label: 'Phone', count: 2, pctVal: 1, pct: '1%' },
  ];

  const strokeWidth = 5.0;
  const radius = 25.0;
  const circumference = 2 * Math.PI * radius;
  const gapPct = 1.0;

  let cumulative = 0;
  const channels = rawChannels.map(ch => {
    const offset = -((cumulative / 100) * circumference + strokeWidth / 2);
    const targetLength = ((ch.pctVal - gapPct) / 100) * circumference - strokeWidth;
    const dashLength = Math.max(0.1, targetLength) * animationProgress;
    cumulative += ch.pctVal;
    return {
      ...ch,
      dash: `${dashLength} 1000`,
      offset: `${offset}`,
    };
  });

  return (
    <Card className="flex-1 h-full justify-between">
      <SectionHeader title="Order Channels" action="View full report" />
      <div className="grid grid-cols-[1fr_1.3fr] gap-2 items-center">
        <div className="flex justify-center relative">
          <div className="relative w-[96px] h-[96px]">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 60 60" shapeRendering="geometricPrecision">
              {channels.map(ch => (
                <circle
                  key={ch.label}
                  cx="30"
                  cy="30"
                  r={radius}
                  fill="transparent"
                  stroke={ch.stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={ch.dash}
                  strokeDashoffset={ch.offset}
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-out"
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black text-gray-800 leading-none">156</span>
              <span className="text-[9px] font-bold text-gray-400 mt-1.5">Total Orders</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[11px] text-gray-500">
          {rawChannels.map(ch => (
            <div key={ch.label} className="flex items-center justify-between">
              <span className="flex items-center gap-1 font-semibold">
                <span className={`w-1.5 h-1.5 rounded-full ${ch.color} shrink-0`} />
                {ch.label}
              </span>
              <div className="flex items-center gap-3">
                <span className="w-5 font-bold text-gray-700 text-right">{ch.count}</span>
                <span className="w-7 text-gray-400 font-normal text-right">{ch.pct}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function TodaysStaff() {
  return (
    <Card className="flex-1 justify-between h-full">
      <div>
        <SectionHeader title="Today's Staff" action="View all" />
        <div className="flex flex-col gap-1.5">
          {[
            { label: 'Scheduled', value: '18', vc: 'text-gray-800', ib: 'bg-gray-100 text-gray-500', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> },
            { label: 'Clocked In', value: '16', vc: 'text-gray-800', ib: 'bg-emerald-50 text-emerald-600', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> },
            { label: 'On Break', value: '2', vc: 'text-amber-500', ib: 'bg-amber-50 text-amber-500', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
            { label: 'Missing', value: '1', vc: 'text-red-500', ib: 'bg-red-50 text-red-500', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> },
          ].map(({ label, value, vc, ib, icon }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                <span className={`w-4.5 h-4.5 rounded-md flex items-center justify-center ${ib}`}>{icon}</span>
                {label}
              </div>
              <span className={`text-[11px] font-bold ${vc}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 p-1.5 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Labour Cost</span>
          <span className="text-xs text-gray-800 font-extrabold">$1,248</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Labour %</span>
          <span className="text-xs text-gray-800 font-extrabold">28%</span>
        </div>
      </div>
    </Card>
  );
}

function InventoryAlerts() {
  const alerts = [
    { name: 'Truffle Oil (250ml)', qty: '2 left', crit: true },
    { name: 'Brioche Buns', qty: '5 left', crit: true },
    { name: 'Halloumi Cheese', qty: '3 left', crit: true },
    { name: 'Chicken Breast', qty: '4 kg left', crit: false },
    { name: 'Avocado', qty: '6 left', crit: false },
  ];
  return (
    <Card className="h-full justify-between">
      <SectionHeader title="Inventory Alerts" action="View all" />
      <div className="flex flex-col gap-1.5">
        {alerts.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-0.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
              <span className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 ${item.crit ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'}`}>
                <svg className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </span>
              {item.name}
            </span>
            <span className={`text-xs font-bold flex items-center gap-0.5 ${item.crit ? 'text-red-600' : 'text-amber-600'}`}>
              {item.qty}
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DeviceStatus() {
  const groups = {
    Kitchen: [
      { name: 'KDS Screen', online: true },
      { name: 'Printer - Kitchen-1', online: true },
      { name: 'Printer - Kitchen-2', online: false },
      { name: 'Expediter Tablet', online: true },
    ],
    'Front of House': [
      { name: 'Order Tablet', online: true },
      { name: 'Kiosk Window', online: true },
      { name: 'EFTPOS Terminal', online: true },
    ],
  };
  const getIcon = (name: string, online: boolean) => {
    const cls = `w-3 h-3 ${online ? 'text-emerald-500' : 'text-red-500'}`;
    if (name.includes('KDS') || name.includes('Kiosk')) return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M9 16v4M5 20h14" /></svg>;
    if (name.includes('Printer')) return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>;
    if (name.includes('Tablet')) return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="2" /><circle cx="12" cy="17" r="1" /></svg>;
    return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 6h8M8 10h8M8 14h2M12 18h4" /></svg>;
  };
  return (
    <Card className="h-full justify-between">
      <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase mb-1">Device Status</h3>
      <div className="flex flex-col gap-1">
        {Object.entries(groups).map(([gName, list]) => (
          <div key={gName}>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{gName}</span>
            <div className="mt-0.5 flex flex-col gap-0.5 py-0.5">
              {list.map((dev, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {getIcon(dev.name, dev.online)}
                    <span className="text-gray-600 font-semibold truncate">{dev.name}</span>
                  </div>
                  <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${dev.online ? 'text-emerald-600' : 'text-red-500'}`}>
                    <span className={`w-1 h-1 rounded-full ${dev.online ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {dev.online ? 'Online' : 'Offline'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function UpcomingTimeline() {
  const events = [
    { time: '5:30 PM', title: 'Reservation', detail: 'Table T12 • Party of 8', color: 'bg-emerald-50 text-emerald-600 border-emerald-200', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18" /></svg> },
    { time: '6:00 PM', title: 'Bus Tour Arrival', detail: '24 Guests • Pre-order', color: 'bg-blue-50 text-blue-500 border-blue-200', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" /></svg> },
    { time: '6:15 PM', title: 'Birthday Celebration', detail: 'Table T04 • Party of 6', color: 'bg-purple-50 text-purple-500 border-purple-200', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5a2 2 0 10-2 2h2zm0 0H4m8 0h8" /></svg> },
    { time: '6:30 PM', title: 'Kitchen Peak Expected', detail: 'High order volume forecast', color: 'bg-orange-50 text-orange-500 border-orange-200', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /></svg> },
  ];
  return (
    <Card className="h-full justify-between">
      <SectionHeader title="Upcoming Timeline" action="View all" />
      <div className="relative flex flex-col gap-2 py-0.5">
        <div className="absolute left-[68px] top-2 bottom-2 w-px bg-gray-200" />
        {events.map((ev, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="w-11 text-xs font-bold text-gray-400 text-right shrink-0 pt-1">{ev.time}</span>
            <div className="relative flex flex-col items-center shrink-0">
              <span className={`z-10 w-6 h-6 rounded-full flex items-center justify-center border border-white shadow-xs ${ev.color}`}>{ev.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-black text-gray-800 leading-none pt-0.5">{ev.title}</h4>
              <p className="text-[11px] text-gray-500 font-semibold leading-normal mt-1">{ev.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function WaitingList() {
  return (
    <Card className="h-full justify-between">
      <SectionHeader title="Waiting List" action="View all" />
      <div className="flex items-center gap-2 bg-gray-50/50 p-1.5 rounded-lg border border-gray-100 mb-1.5">
        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-black text-gray-900">7</span>
          <span className="text-[11px] font-bold text-gray-500">Parties Waiting</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-center mb-1.5">
        {[['Longest Wait','18 min'],['Average Wait','12 min']].map(([l,v]) => (
          <div key={l} className="bg-gray-50/50 rounded-lg p-1 border border-gray-100/70">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{l}</div>
            <div className="text-xs font-black text-gray-800 mt-0.5">{v}</div>
          </div>
        ))}
      </div>
      <button className="w-full py-1 bg-white text-emerald-600 text-xs font-bold rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors">
        Manage Waiting List
      </button>
    </Card>
  );
}

function WeatherWidget() {
  return (
    <Card className="h-full justify-between">
      <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase mb-1">Weather</h3>
      <div className="flex items-center gap-2 bg-blue-50/30 p-1.5 rounded-lg border border-blue-100/40 mb-1.5">
        <span className="w-7 h-7 text-blue-500 shrink-0">
          <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75v1.5m0-1.5h.008M12 21.75v.008m-3-4.508v1.5m0-1.5h.008m0 3v.008m6-4.508v1.5m0-1.5h.008m0 3v.008" />
          </svg>
        </span>
        <div>
          <div className="text-2xl font-black text-gray-900 leading-none">18°C</div>
          <div className="text-[11px] font-bold text-gray-500 mt-0.5">Light Rain</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center text-[10px] mb-1.5">
        {[['Wind','12 km/h'],['Humidity','78%'],['Chance of Rain','60%']].map(([l,v]) => (
          <div key={l} className="flex flex-col bg-gray-50 p-1 rounded border border-gray-100/70">
            <span className="font-bold text-gray-400 uppercase tracking-wider leading-tight">{l}</span>
            <span className="font-bold text-gray-700 text-[11px] mt-0.5">{v}</span>
          </div>
        ))}
      </div>
      <button className="w-full py-1 bg-white text-emerald-600 text-[11px] font-bold rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors flex items-center justify-center gap-1">
        <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        Busy dinner forecast
      </button>
    </Card>
  );
}

function AiInsights() {
  const items = [
    { text: 'Lunch revenue is up 12% vs yesterday.', c: 'bg-emerald-100 text-emerald-600', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg> },
    { text: 'Grill station is the current bottleneck.', c: 'bg-orange-100 text-orange-600', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /></svg> },
    { text: 'Seafood Pasta prep time increased by 4 min.', c: 'bg-amber-100 text-amber-600', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
    { text: 'Printer Kitchen-2 disconnected 3 times today.', c: 'bg-red-100 text-red-600', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> },
    { text: "Projected to exceed yesterday's revenue by 8%.", c: 'bg-purple-100 text-purple-600', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.286L13 21l-2.286-5.714L5 13l5.714-2.286L13 3z" /></svg> },
    { text: 'Average spend increased due to beverages.', c: 'bg-blue-100 text-blue-600', icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
  ];
  return (
    <Card className="h-full justify-between">
      <SectionHeader title="AI Insights" action="View all" />
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2 items-start">
            <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${item.c}`}>{item.icon}</span>
            <span className="text-xs text-gray-700 font-semibold leading-snug">{item.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentActivity() {
  const acts = [
    { title: 'Order #ORD-4817', desc: 'Ready for pickup', time: '2 min ago', c: 'bg-emerald-50 text-emerald-600', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg> },
    { title: 'Marcus O.', desc: 'Seated at table T12', time: '3 min ago', c: 'bg-emerald-50 text-emerald-600', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
    { title: 'Kitchen-2 Printer', desc: 'Went offline', time: '8 min ago', c: 'bg-red-50 text-red-500', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg> },
    { title: 'Payment $128.40', desc: 'Received', time: '11 min ago', c: 'bg-emerald-50 text-emerald-600', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg> },
    { title: 'Low Stock Alert', desc: 'Truffle Oil (2 left)', time: '15 min ago', c: 'bg-orange-50 text-orange-600', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> },
    { title: 'Lena Park', desc: 'Arriving in 8 min', time: '16 min ago', c: 'bg-purple-50 text-purple-600', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
  ];
  return (
    <Card className="h-[86px] justify-between">
      <SectionHeader title="Recent Activity" action="View all" />
      <div className="grid grid-cols-6 gap-2">
        {acts.map((act, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-1.5 flex items-center gap-2 hover:border-gray-300 transition-all cursor-pointer">
            <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${act.c}`}>{act.icon}</span>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-gray-800 truncate leading-snug">{act.title}</h4>
              <p className="text-[11px] text-gray-500 font-semibold truncate leading-snug mt-0.5">{act.desc}</p>
              <p className="text-[10px] text-gray-400 font-bold leading-snug mt-0.5">{act.time}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { data: kpi } = useQuery({
    queryKey: ['dashboard', 'kpi'],
    queryFn: (): Promise<KpiStats> => Promise.resolve(MOCK_KPI),
    staleTime: 30_000,
  });

  return (
    <div className="px-6 py-5 flex flex-col gap-4 select-none">

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2">
        {[
          { label: 'New Reservation', green: true, icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg> },
          { label: 'New Order', green: true, icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg> },
          { label: 'Open KDS', green: true, icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18" /></svg> },
          { label: 'View Reports', green: false, icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
          { label: 'Refresh', green: false, icon: <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> },
        ].map(({ label, green, icon }) => (
          <button key={label} className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg border transition-colors ${green ? 'text-emerald-600 bg-white border-emerald-200 hover:bg-emerald-50' : 'text-gray-700 bg-white border-gray-200 hover:bg-gray-50'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* Attention Required */}
      <div>
        <div className="text-[11px] font-bold text-red-600 tracking-wider uppercase mb-1">Attention Required</div>
        <div className="grid grid-cols-5 gap-2">
          {[
            { bg: 'bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300', ib: 'bg-red-100 text-red-500', ch: 'text-red-400 group-hover:text-red-600', title: '1 Printer offline', sub: 'Kitchen-2 • Offline 8m', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg> },
            { bg: 'bg-orange-50 border-orange-200 hover:bg-orange-100 hover:border-orange-300', ib: 'bg-orange-100 text-orange-500', ch: 'text-orange-400 group-hover:text-orange-600', title: 'Grill station overloaded', sub: '18 orders • 78% capacity', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /></svg> },
            { bg: 'bg-purple-50 border-purple-200 hover:bg-purple-100 hover:border-purple-300', ib: 'bg-purple-100 text-purple-600', ch: 'text-purple-400 group-hover:text-purple-600', title: '5 reservations arriving', sub: 'Within 15 minutes', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" /></svg> },
            { bg: 'bg-amber-50 border-amber-200 hover:bg-amber-100 hover:border-amber-300', ib: 'bg-amber-100 text-amber-600', ch: 'text-amber-400 group-hover:text-emerald-600', title: '3 low stock items', sub: 'Check inventory', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4" /></svg> },
            { bg: 'bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300', ib: 'bg-red-100 text-red-500', ch: 'text-red-400 group-hover:text-red-600', title: '2 failed payments', sub: 'Needs attention', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg> },
          ].map((item, i) => (
            <div key={i} className={`flex items-center justify-between py-1.5 px-2.5 border rounded-xl cursor-pointer group transition-all h-[65px] ${item.bg}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${item.ib}`}>{item.icon}</span>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-gray-900 leading-none">{item.title}</h4>
                  <p className="text-[11px] text-gray-500 font-semibold truncate mt-0.5 leading-none">{item.sub}</p>
                </div>
              </div>
              <svg className={`w-3 h-3 shrink-0 transition-colors ${item.ch}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </div>
          ))}
        </div>
      </div>

      {/* Restaurant Pulse — single unified card */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-600 tracking-wider uppercase">Restaurant Pulse</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              ALL SYSTEMS NORMAL
            </span>
          </div>
          <button className="text-xs font-semibold text-emerald-600 flex items-center gap-0.5">
            View full status <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl flex items-stretch overflow-hidden h-[80px]">
          {[
            { bg: 'bg-emerald-500', label: 'Service', val: 'Running Smoothly', sub: 'No issues detected', vc: 'text-emerald-600', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg> },
            { bg: 'bg-blue-500', label: 'Dining Room', val: '82%', sub: 'Occupied', vc: 'text-gray-900', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg> },
            { bg: 'bg-orange-500', label: 'Kitchen', val: '18', sub: 'Active Orders', vc: 'text-gray-900', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M6 18V10a6 6 0 0 1 12 0v8M3 18h18M9 21h6" /></svg> },
            { bg: 'bg-teal-500', label: 'Avg Wait Time', val: '14 min', sub: 'Estimated', vc: 'text-gray-900', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
            { bg: 'bg-emerald-500', label: 'Reservations', val: '5', sub: 'Arriving in 15 min', vc: 'text-gray-900', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> },
            { bg: 'bg-emerald-500', label: 'Payments', val: 'Healthy', sub: 'All systems normal', vc: 'text-emerald-600', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg> },
            { bg: 'bg-purple-500', label: 'Devices', val: '1', sub: 'Needs attention', vc: 'text-gray-900', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="14" rx="2" /><path d="M12 17v4M8 21h8" /></svg> },
          ].map((cell, i, arr) => (
            <div key={cell.label} className={`flex items-center gap-2 px-3 py-1.5 flex-1 min-w-0 ${i < arr.length - 1 ? 'border-r border-gray-100' : ''}`}>
              <span className={`w-7 h-7 rounded-full ${cell.bg} text-white flex items-center justify-center shrink-0`}>{cell.icon}</span>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{cell.label}</div>
                <div className={`text-xs font-bold truncate mt-0.5 ${cell.vc}`}>{cell.val}</div>
                <div className={`text-[10px] font-semibold truncate mt-0.5 text-gray-400`}>{cell.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-6 gap-2">
        {kpi && <>
          <KpiCard title="Today's Revenue" value={`$${kpi.revenue.toLocaleString()}`} delta={`+${kpi.revenueDeltaPct}%`} subtext={`vs. yesterday $${kpi.revenueYesterday.toLocaleString()}`} sparklineColor="#10b981" sparklinePoints={[3,8,5,12,7,14,10,16,11,17]} iconBg="bg-emerald-50" iconColor="text-emerald-600" icon={<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
          <KpiCard title="Orders Today" value="156" delta="+10.1%" subtext="vs. yesterday 142" sparklineColor="#3b82f6" sparklinePoints={[6,9,7,11,8,13,9,15,11,14]} iconBg="bg-blue-50" iconColor="text-blue-600" icon={<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>} />
          <KpiCard title="Covers Today" value="248" delta="+8.3%" subtext="vs. yesterday 229" sparklineColor="#f59e0b" sparklinePoints={[5,11,8,14,10,16,12,18,13,16]} iconBg="bg-orange-50" iconColor="text-orange-500" icon={<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} />
          <KpiCard title="Average Spend" value={`$${kpi.avgTicket.toFixed(2)}`} delta="+6.2%" subtext="vs. yesterday $69.24" sparklineColor="#8b5cf6" sparklinePoints={[8,6,11,9,13,10,14,11,15,12]} iconBg="bg-purple-50" iconColor="text-purple-600" icon={<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>} />
          <KpiCard title="Orders / Hour" value="26" delta="+3.6%" subtext="vs. yesterday 25" sparklineColor="#14b8a6" sparklinePoints={[4,8,6,10,7,12,9,14,10,13]} iconBg="bg-teal-50" iconColor="text-teal-600" icon={<svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 19h16M4 15l4-4 4 4 8-8" /></svg>} />
          <KpiCard title="Table Turnover" value="3.2" delta="+7.5%" subtext="vs. yesterday 3.0" sparklineColor="#ec4899" sparklinePoints={[3,7,5,10,8,12,9,13,11,14]} iconBg="bg-pink-50" iconColor="text-pink-500" icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14h12 M9 14v6 M15 14v6 M3 11h3v9 M18 11h3v9" /></svg>} />
        </>}
      </div>

      {/* Middle row: 4 equal columns */}
      <div className="grid grid-cols-4 gap-2 min-h-[221px]">
        <LiveFloorPlan />
        <KitchenPerformance />
        <OrderChannels />
        <TodaysStaff />
      </div>

      {/* Bottom row: 6 columns */}
      <div className="grid grid-cols-6 gap-2 min-h-[219px]">
        <InventoryAlerts />
        <DeviceStatus />
        <UpcomingTimeline />
        <WaitingList />
        <WeatherWidget />
        <AiInsights />
      </div>

      {/* Recent Activity */}
      <RecentActivity />

    </div>
  );
}

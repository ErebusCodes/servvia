import { useState } from 'react';

// ── Icons ────────────────────────────────────────────────────────────────────
function IconDocument() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function IconFilter() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
    </svg>
  );
}

function IconGridView() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconListView() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function IconThreeDots() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
    </svg>
  );
}

function IconPrinter() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0a2.25 2.25 0 0 1-2.25 2.25H8.59A2.25 2.25 0 0 1 6.34 18m11.318-4.171A2.25 2.25 0 0 0 15 11.25H9a2.25 2.25 0 0 0-2.25 2.25m11.318-4.171A2.25 2.25 0 0 0 21 11.25V9.75A2.25 2.25 0 0 0 18.75 7.5H5.25A2.25 2.25 0 0 0 3 9.75v1.5a2.25 2.25 0 0 0 2.25 2.25m11.318-4.171A22.58 22.58 0 0 0 12 7.5c-4.103 0-7.79 1.705-10.457 4.453M9 3h6" />
    </svg>
  );
}

function IconPos() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8M8 11h2M12 11h4M8 15h8" />
    </svg>
  );
}

// Inline custom SVG credit card
function IconCreditCard() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h2M12 15h4" />
    </svg>
  );
}

// Vespa icon for delivery platforms
function IconVespa() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M6 15h12M9 15l2-5h5l2 5M12 10V6a2 2 0 0 0-2-2H8" />
    </svg>
  );
}

// Delivery van icon for delivery integrations
function IconVan() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <rect x="3" y="6" width="12" height="11" rx="2" />
      <path d="M15 8h4l2 3v6h-6V8z" />
      <circle cx="7" cy="19" r="2.5" />
      <circle cx="17" cy="19" r="2.5" />
    </svg>
  );
}

// Accounting sheets icon
function IconBarChart() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125z" />
    </svg>
  );
}

// Link/Chain icon for miscellaneous integrations
function IconLink() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
  );
}

// Shield icon for certificate expiry
function IconShield() {
  return (
    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

// Key icon for token expiry
function IconLock() {
  return (
    <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25z" />
    </svg>
  );
}

// Operations icons
function IconUptime() {
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3v3.75a3 3 0 0 1-3 3zm-13.5 0v3.75a3 3 0 0 0 3 3h13.5a3 3 0 0 0 3-3v-3.75M6.75 12h.008v.008H6.75V12zm0-3h.008v.008H6.75V9zm3 3h.008v.008H9.75V12zm0-3h.008v.008H9.75V9z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
    </svg>
  );
}

function IconSyncCloud() {
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75z" />
    </svg>
  );
}

function IconErrorCloud() {
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.03L3.07 19.5h17.86L12 2.72zm0 12.78h.008v.008H12v-.008z" />
    </svg>
  );
}

function IconWebhookBranch() {
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18a.75.75 0 0 0 .75.75h14.25a.75.75 0 0 0 .75-.75V3.75m-15 15a.75.75 0 0 1-.75-.75V3.75m0 15H1.5M12 9.75a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 0v7.5M12 13.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

// ── Custom Sub-Components ──────────────────────────────────────────────────
function CircleGauge({ value, size = 56, strokeWidth = 5, color = '#10b981' }: { value: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="#f3f4f6"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
        <span className="text-[14px] font-black text-gray-800 leading-none">{value}</span>
        {size > 60 && <span className="text-[8px] font-bold text-gray-400 mt-0.5">%</span>}
      </div>
    </div>
  );
}

function Sparkline({ points, color = '#10b981', width = 64, height = 16 }: { points: number[]; color?: string; width?: number; height?: number }) {
  if (points.length === 0) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min === 0 ? 1 : max - min;
  
  const path = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p - min) / range) * (height - 2) - 1;
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible select-none">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActivityLineChart() {
  const pointsWebhooks = [30, 45, 20, 80, 40, 50, 75, 45, 85, 30];
  const pointsSuccess = [20, 30, 15, 60, 30, 35, 55, 30, 60, 20];
  const pointsFailed = [2, 3, 2, 4, 3, 2, 3, 2, 4, 2];

  const width = 280;
  const height = 90;
  const max = 100;
  
  const getPath = (pts: number[]) => {
    return pts.map((p, i) => {
      const x = (i / (pts.length - 1)) * width;
      const y = height - (p / max) * (height - 10) - 5;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  };

  const getAreaPath = (pts: number[]) => {
    const linePath = getPath(pts);
    return `${linePath} L ${width} ${height} L 0 ${height} Z`;
  };

  return (
    <div className="flex flex-col w-full h-full justify-between">
      <div className="relative w-full h-[90px]">
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible select-none">
          {/* Grids */}
          <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="#f3f4f6" strokeWidth={1} />
          <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="#f3f4f6" strokeWidth={1} />
          <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} stroke="#f3f4f6" strokeWidth={1} />
          
          {/* Areas */}
          <path d={getAreaPath(pointsWebhooks)} fill="url(#grad-blue)" fillOpacity="0.05" />
          <path d={getAreaPath(pointsSuccess)} fill="url(#grad-green)" fillOpacity="0.05" />
          
          {/* Gradients */}
          <defs>
            <linearGradient id="grad-blue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="grad-green" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Lines */}
          <path d={getPath(pointsWebhooks)} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d={getPath(pointsSuccess)} fill="none" stroke="#10b981" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d={getPath(pointsFailed)} fill="none" stroke="#ef4444" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="flex justify-between text-[9px] text-gray-400 font-semibold px-1 mt-1 select-none">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
    </div>
  );
}

// Custom inline logos to avoid external resource dependencies
const StripeLogo = () => (
  <span className="inline-flex items-center text-[#635bff] font-black text-xs tracking-tight select-none">
    stripe
  </span>
);

const EftposBadge = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-extrabold text-gray-500 tracking-wider">
    EFTPOS
  </span>
);

const UberEatsBadge = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#06c167] text-[8px] font-black text-white uppercase tracking-tight select-none">
    Uber Eats
  </span>
);

const DoorDashBadge = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#ff3008] text-[8px] font-black text-white tracking-tight select-none">
    DOORDASH
  </span>
);

const MenulogBadge = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#ff7a00] text-[8px] font-black text-white tracking-tight select-none">
    MENULOG
  </span>
);

const DeliverectBadge = () => (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-100 bg-emerald-50 text-[10px] font-bold text-emerald-800 tracking-tight select-none">
    <span className="w-1.5 h-1.5 rounded-full bg-[#00cd85]" />
    deliverect
  </span>
);

const XeroBadge = () => (
  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#13b5ea] text-white text-[9px] font-black tracking-tight select-none">
    x
  </span>
);

const MyobBadge = () => (
  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-[#6100a5] text-white text-[8px] font-black select-none leading-none">
    myob
  </span>
);

const QbBadge = () => (
  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#2ca01c] text-white text-[9px] font-black tracking-tight select-none">
    qb
  </span>
);

// ── Main Page Component ──────────────────────────────────────────────────────
export function IntegrationToolsPage() {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // KPI Data
  const kpiData = [
    {
      title: 'Integration Health Score',
      customBody: (
        <div className="flex items-center gap-3">
          <CircleGauge value={96} size={50} strokeWidth={4} color="#10b981" />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-1 select-none">
              <span className="text-lg font-black text-gray-900 leading-none">96</span>
              <span className="text-[10px] text-gray-400 font-semibold leading-none">/ 100</span>
            </div>
            <div className="inline-flex items-center w-fit px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-bold rounded">
              Excellent
            </div>
            <div className="text-[9px] text-emerald-600 font-semibold select-none leading-none mt-0.5">
              ↑ 3 pts vs yesterday
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'Total Integrations',
      value: '18',
      subtext: 'Across 7 categories',
      icon: (
        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      ),
      iconBg: 'bg-blue-50 text-blue-600'
    },
    {
      title: 'Connected',
      value: '14',
      subtext: '77.8% of total',
      icon: (
        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      iconBg: 'bg-emerald-50 text-emerald-600'
    },
    {
      title: 'Requires Attention',
      value: '2',
      subtext: 'Need your review',
      icon: (
        <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      ),
      iconBg: 'bg-amber-50 text-amber-600'
    },
    {
      title: 'Disconnected',
      value: '2',
      subtext: 'Not configured',
      icon: (
        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
      iconBg: 'bg-red-50 text-red-600'
    },
    {
      title: 'Connected Locations',
      value: '8',
      subtext: 'All locations online',
      icon: (
        <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
      ),
      iconBg: 'bg-indigo-50 text-indigo-600'
    },
    {
      title: 'Devices Online',
      value: '42',
      customValue: (
        <div className="flex items-baseline gap-1 select-none">
          <span className="text-lg font-black text-gray-900 leading-none">42</span>
          <span className="text-[10px] text-gray-400 font-semibold leading-none">/ 45</span>
        </div>
      ),
      subtext: '93.3% online',
      icon: (
        <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
        </svg>
      ),
      iconBg: 'bg-slate-100 text-slate-600'
    }
  ];

  // Table Data
  const categoriesData = [
    {
      id: 'printing',
      icon: <IconPrinter />,
      iconBg: 'bg-emerald-50 text-emerald-600',
      title: 'Printing',
      description: 'Manage printers and print services',
      statusElement: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-200 bg-white text-[10px] font-bold text-gray-700">
              <svg className="w-2.5 h-2.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12" />
              </svg>
              3 Services
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-200 bg-white text-[10px] font-bold text-gray-700">
              <svg className="w-2.5 h-2.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9" />
              </svg>
              8 Devices
            </span>
          </div>
        </div>
      ),
      healthDot: 'bg-emerald-500',
      healthLabel: 'Healthy',
      healthScore: '98%',
      successRate: '99.92%',
      sparklinePoints: [20, 22, 21, 23, 22, 24, 23, 25, 24, 25],
      lastSync: 'Last sync: 18 sec ago',
      details: [
        { label: 'Avg. Latency', value: '42 ms' },
        { label: 'Region', value: 'Auckland' }
      ],
      actionLabel: 'Configure'
    },
    {
      id: 'ideal-pos',
      icon: <IconPos />,
      iconBg: 'bg-blue-50 text-blue-600',
      title: 'Ideal POS',
      description: 'Point of Sale system connection',
      statusElement: (
        <div className="flex flex-col">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Connected
          </span>
          <span className="text-[10px] text-gray-400 font-semibold mt-0.5 leading-none">Production</span>
        </div>
      ),
      healthDot: 'bg-emerald-500',
      healthLabel: 'Healthy',
      healthScore: '99%',
      successRate: '99.97%',
      sparklinePoints: [30, 31, 30, 32, 31, 33, 32, 33, 32, 34],
      lastSync: 'Last sync: 45 sec ago',
      details: [
        { label: 'API Version', value: '2.4.1' },
        { label: 'Connected Since', value: '18 Apr 2025' }
      ],
      actionLabel: 'Sync Now'
    },
    {
      id: 'payment-integrations',
      icon: <IconCreditCard />,
      iconBg: 'bg-violet-50 text-violet-600',
      title: 'Payment Integrations',
      description: 'Payment gateways and terminals',
      statusElement: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <StripeLogo />
            <EftposBadge />
          </div>
          <span className="text-[10px] text-gray-400 font-semibold leading-none mt-0.5">2 Services</span>
        </div>
      ),
      healthDot: 'bg-emerald-500',
      healthLabel: 'Healthy',
      healthScore: '97%',
      successRate: '99.81%',
      sparklinePoints: [25, 24, 26, 25, 27, 26, 28, 27, 29, 28],
      lastSync: 'Last txn: 12 sec ago',
      details: [
        { label: 'Avg. Latency', value: '120 ms' },
        { label: 'Fees Today', value: '$12.45' }
      ],
      actionLabel: 'Manage'
    },
    {
      id: 'delivery-platforms',
      icon: <IconVespa />,
      iconBg: 'bg-amber-50 text-amber-600',
      title: 'Delivery Platforms',
      description: 'Third-party delivery platforms',
      statusElement: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <UberEatsBadge />
            <DoorDashBadge />
            <MenulogBadge />
          </div>
          <span className="text-[10px] text-gray-400 font-semibold leading-none mt-0.5">3 Services</span>
        </div>
      ),
      healthDot: 'bg-amber-500',
      healthLabel: 'Warning',
      healthScore: '85%',
      successRate: '97.41%',
      sparklinePoints: [18, 16, 17, 14, 15, 13, 16, 15, 14, 16],
      sparklineColor: '#f59e0b',
      lastSync: 'Last sync: 1 min ago',
      details: [
        { label: 'Open Orders', value: '24' },
        { label: 'Failed Syncs', value: '2' }
      ],
      actionLabel: 'Manage'
    },
    {
      id: 'delivery-integrations',
      icon: <IconVan />,
      iconBg: 'bg-blue-50 text-blue-600',
      title: 'Delivery Integrations',
      description: 'Delivery management providers',
      statusElement: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <DeliverectBadge />
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold">
              +2
            </span>
          </div>
          <span className="text-[10px] text-gray-400 font-semibold leading-none mt-0.5">3 Services</span>
        </div>
      ),
      healthDot: 'bg-emerald-500',
      healthLabel: 'Healthy',
      healthScore: '94%',
      successRate: '98.63%',
      sparklinePoints: [22, 21, 23, 22, 24, 23, 22, 24, 25, 23],
      lastSync: 'Last sync: 2 min ago',
      details: [
        { label: 'Webhook Queue', value: '3' },
        { label: 'Retry Queue', value: '1' }
      ],
      actionLabel: 'Configure'
    },
    {
      id: 'accounting-integrations',
      icon: <IconBarChart />,
      iconBg: 'bg-emerald-50 text-emerald-600',
      title: 'Accounting Integrations',
      description: 'Accounting and bookkeeping systems',
      statusElement: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <XeroBadge />
            <MyobBadge />
            <QbBadge />
          </div>
          <span className="text-[10px] text-gray-400 font-semibold leading-none mt-0.5">3 Services</span>
        </div>
      ),
      healthDot: 'bg-emerald-500',
      healthLabel: 'Healthy',
      healthScore: '96%',
      successRate: '99.20%',
      sparklinePoints: [24, 25, 24, 26, 25, 27, 26, 26, 27, 26],
      lastSync: 'Last sync: 5 min ago',
      details: [
        { label: 'Last Export', value: '10 min ago' },
        { label: 'Pending', value: '0' }
      ],
      actionLabel: 'Manage'
    },
    {
      id: 'other-integrations',
      icon: <IconLink />,
      iconBg: 'bg-gray-100 text-gray-600',
      title: 'Other Integrations',
      description: 'Utilities, communication and more',
      statusElement: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="w-5 h-5 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </span>
            <span className="w-5 h-5 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </span>
            <span className="w-5 h-5 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l3-3m-3 3l-3-3m0-9h6" />
              </svg>
            </span>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-[9px] font-bold">
              +3
            </span>
          </div>
          <span className="text-[10px] text-gray-400 font-semibold leading-none mt-0.5">6 Services</span>
        </div>
      ),
      healthDot: 'bg-amber-500',
      healthLabel: 'Warning',
      healthScore: '82%',
      successRate: '96.11%',
      sparklinePoints: [14, 15, 12, 11, 13, 10, 12, 11, 13, 12],
      sparklineColor: '#f59e0b',
      lastSync: 'Last sync: 3 min ago',
      details: [
        { label: 'Active Webhooks', value: '12' },
        { label: 'Failed', value: '0' }
      ],
      actionLabel: 'Manage'
    }
  ];

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto select-none bg-gray-50">
      
      {/* ── Sub-header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 font-semibold leading-none select-none">
          Connect, monitor and manage all external systems, devices and services.
        </p>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-xs">
            <IconDocument />
            Documentation
          </button>
          <button className="flex items-center gap-1 px-3 py-1.5 bg-[#16a34a] hover:bg-[#15803d] text-white rounded-lg text-xs font-bold transition-colors shadow-sm">
            <IconPlus />
            <span className="mx-1">Add Integration</span>
            <IconChevronDown />
          </button>
        </div>
      </div>

      {/* ── KPI Cards Row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-4">
        {kpiData.map((card, i) => (
          <div
            key={i}
            className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-xs flex flex-col justify-between h-[86px] hover:border-gray-300 transition-colors select-none"
          >
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none">
              {card.title}
            </span>
            {card.customBody ? (
              card.customBody
            ) : (
              <div className="flex items-center justify-between mt-1">
                <div className="flex flex-col gap-0.5">
                  {card.customValue ? card.customValue : (
                    <span className="text-lg font-black text-gray-900 leading-none tabular-nums">
                      {card.value}
                    </span>
                  )}
                  <span className="text-[9px] text-gray-400 font-semibold leading-none">
                    {card.subtext}
                  </span>
                </div>
                {card.icon && (
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${card.iconBg}`}>
                    {card.icon}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Main Layout: Table and Operations Panel ────────────────────────── */}
      <div className="grid grid-cols-12 gap-6 items-start">
        
        {/* LEFT/CENTER: Filters + Table (col-span-9) */}
        <div className="col-span-9 flex flex-col gap-4">
          
          {/* Filters Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 max-w-3xl">
              {/* Search integrations */}
              <div className="relative w-[220px]">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <IconSearch />
                </div>
                <input
                  type="search"
                  placeholder="Search integrations..."
                  className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors"
                />
              </div>

              {/* Dropdowns */}
              {['All Categories', 'All Statuses', 'All Environments'].map((lbl, idx) => (
                <button
                  key={idx}
                  className="flex items-center justify-between gap-2 px-3 h-8 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
                >
                  {lbl}
                  <IconChevronDown />
                </button>
              ))}

              {/* More Filters */}
              <button className="flex items-center gap-1.5 px-3 h-8 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors shrink-0">
                <IconFilter />
                More Filters
              </button>
            </div>

            {/* View Toggle */}
            <div className="flex items-center border border-gray-200 rounded-lg bg-white p-0.5 gap-0.5 shrink-0">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
                title="Grid view"
              >
                <IconGridView />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
                title="List view"
              >
                <IconListView />
              </button>
            </div>
          </div>

          {/* Integration List / Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 py-3 px-4 border-b border-gray-200 text-left w-[240px]">
                    Integration
                  </th>
                  <th className="text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 py-3 px-4 border-b border-gray-200 text-left w-[130px]">
                    Status
                  </th>
                  <th className="text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 py-3 px-4 border-b border-gray-200 text-left w-[90px]">
                    Health
                  </th>
                  <th className="text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 py-3 px-4 border-b border-gray-200 text-left w-[160px]">
                    Sync / Activity
                  </th>
                  <th className="text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 py-3 px-4 border-b border-gray-200 text-left w-[180px]">
                    Details
                  </th>
                  <th className="text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 py-3 px-4 border-b border-gray-200 text-right w-[110px]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categoriesData.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/70 transition-colors">
                    {/* Integration Info */}
                    <td className="py-3.5 px-4 vertical-align-middle">
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${row.iconBg}`}>
                          {row.icon}
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-black text-gray-900 leading-tight">
                            {row.title}
                          </span>
                          <span className="text-[10px] text-gray-400 font-semibold truncate leading-normal mt-0.5">
                            {row.description}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Status badges */}
                    <td className="py-3.5 px-4 vertical-align-middle">
                      {row.statusElement}
                    </td>

                    {/* Health percentage */}
                    <td className="py-3.5 px-4 vertical-align-middle">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${row.healthDot}`} />
                        <span className="text-xs font-bold text-gray-800">
                          {row.healthLabel}
                        </span>
                        <span className="text-[10px] text-gray-400 font-semibold">
                          {row.healthScore}
                        </span>
                      </div>
                    </td>

                    {/* Sync Success Rate / Sparkline */}
                    <td className="py-3.5 px-4 vertical-align-middle">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between gap-4 select-none">
                          <div className="flex items-baseline gap-0.5">
                            <span className="text-[10px] text-gray-400 font-bold uppercase leading-none">Rate</span>
                            <span className="text-xs font-black text-gray-800 leading-none tabular-nums">
                              {row.successRate}
                            </span>
                          </div>
                          <Sparkline
                            points={row.sparklinePoints}
                            color={row.sparklineColor || '#10b981'}
                            width={60}
                            height={14}
                          />
                        </div>
                        <span className="text-[9px] text-gray-400 font-semibold leading-none mt-1">
                          {row.lastSync}
                        </span>
                      </div>
                    </td>

                    {/* Details key-values */}
                    <td className="py-3.5 px-4 vertical-align-middle">
                      <div className="flex flex-col gap-1 w-full max-w-[150px]">
                        {row.details.map((det, idx) => (
                          <div key={idx} className="flex justify-between items-center text-[10px]">
                            <span className="text-gray-400 font-semibold">{det.label}</span>
                            <span className="font-extrabold text-gray-700">{det.value}</span>
                          </div>
                        ))}
                      </div>
                    </td>

                    {/* Actions button/dropdown */}
                    <td className="py-3.5 px-4 text-right vertical-align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        <button className="px-2.5 py-1 bg-white border border-gray-200 rounded-md text-[11px] font-bold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-xs">
                          {row.actionLabel}
                        </button>
                        <button className="p-1 rounded hover:bg-gray-100 transition-colors">
                          <IconThreeDots />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {/* Table Footer */}
            <div className="px-4 py-3 bg-gray-50/55 border-t border-gray-100 flex items-center">
              <span className="text-[10px] text-gray-400 font-bold select-none">
                Showing 1 to 7 of 7 categories
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Operations Panel (col-span-3) */}
        <div className="col-span-3 flex flex-col gap-4">
          
          {/* Card 1: System Health Overview */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase select-none">
                System Health Overview
              </h3>
              <button className="text-[10px] font-bold px-2 py-0.5 border border-gray-200 rounded-md text-gray-600 bg-white hover:bg-gray-50 transition-colors">
                View Dashboard
              </button>
            </div>
            
            <div className="flex flex-col divide-y divide-gray-100">
              {[
                {
                  label: 'Uptime (24h)',
                  value: '99.98%',
                  icon: <IconUptime />,
                  points: [99.98, 99.99, 99.97, 99.98, 99.99, 99.98, 99.98, 99.99, 99.98, 99.98],
                  color: '#10b981'
                },
                {
                  label: 'API Response Time',
                  value: '142 ms',
                  icon: <IconClock />,
                  points: [135, 140, 155, 138, 145, 160, 142, 137, 148, 142],
                  color: '#f59e0b'
                },
                {
                  label: 'Sync Success Rate',
                  value: '99.97%',
                  icon: <IconSyncCloud />,
                  points: [99.97, 99.97, 99.96, 99.98, 99.97, 99.97, 99.97, 99.97, 99.97, 99.97],
                  color: '#10b981'
                },
                {
                  label: 'Failed Syncs (24h)',
                  value: '2',
                  icon: <IconErrorCloud />,
                  points: [0, 1, 0, 0, 2, 0, 1, 0, 0, 0],
                  color: '#f59e0b'
                },
                {
                  label: 'Webhook Failures (24h)',
                  value: '0',
                  icon: <IconWebhookBranch />,
                  points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                  color: '#10b981'
                }
              ].map((row, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 select-none">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {row.icon}
                    <span className="text-[10px] text-gray-500 font-semibold truncate leading-none">
                      {row.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-gray-800 tabular-nums">
                      {row.value}
                    </span>
                    <Sparkline points={row.points} color={row.color} width={60} height={14} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: API Usage */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col">
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase select-none">
                API Usage (Today)
              </h3>
              <button className="text-[10px] font-bold px-2 py-0.5 border border-gray-200 rounded-md text-gray-600 bg-white hover:bg-gray-50 transition-colors">
                View Details
              </button>
            </div>
            
            <div className="flex items-center gap-4">
              <CircleGauge value={68} size={54} strokeWidth={4} color="#3b82f6" />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-sm font-black text-gray-900 tabular-nums leading-none select-none">
                  6,832 <span className="text-[10px] font-bold text-gray-400">/ 10,000</span>
                </span>
                <span className="text-[10px] text-gray-400 font-bold uppercase leading-none mt-0.5">
                  Requests Used
                </span>
              </div>
              <div className="flex flex-col gap-1 text-[10px] shrink-0 border-l border-gray-100 pl-3">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-gray-400 font-semibold select-none">Rate Limit</span>
                  <span className="font-extrabold text-gray-700">10,000/day</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-gray-400 font-semibold select-none">Remaining</span>
                  <span className="font-extrabold text-gray-700">3,168</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-gray-400 font-semibold select-none">Resets in</span>
                  <span className="font-extrabold text-gray-700">6h 24m</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Queues */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase select-none">
                Queues
              </h3>
              <button className="text-[10px] font-bold px-2 py-0.5 border border-gray-200 rounded-md text-gray-600 bg-white hover:bg-gray-50 transition-colors">
                View All Queues
              </button>
            </div>
            
            <div className="flex flex-col divide-y divide-gray-100">
              {[
                { label: 'Webhook Queue', count: '3', countColor: 'text-amber-500 bg-amber-50', icon: <IconWebhookBranch /> },
                { label: 'Retry Queue', count: '2', countColor: 'text-amber-500 bg-amber-50', icon: <IconRefresh /> },
                { label: 'Dead Letter Queue', count: '0', countColor: 'text-emerald-600 bg-emerald-50', icon: <IconErrorCloud /> },
                { label: 'Background Jobs', count: '7', countColor: 'text-blue-600 bg-blue-50', icon: <IconUptime /> }
              ].map((row, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 hover:bg-gray-50/50 rounded px-1 -mx-1 cursor-pointer transition-colors group">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-400 group-hover:text-gray-600 transition-colors">
                      {row.icon}
                    </span>
                    <span className="text-[10px] text-gray-500 font-semibold truncate leading-none">
                      {row.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 select-none">
                    <span className={`text-[10px] font-black rounded-md px-1.5 py-0.5 ${row.countColor}`}>
                      {row.count}
                    </span>
                    <IconChevronRight />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 4: Recent Errors */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase select-none">
                Recent Errors
              </h3>
              <button className="text-[10px] font-bold px-2 py-0.5 border border-gray-200 rounded-md text-gray-600 bg-white hover:bg-gray-50 transition-colors">
                View All
              </button>
            </div>
            
            <div className="flex flex-col gap-2.5">
              {[
                { msg: 'Kitchen Printer K2 offline', time: '12m ago' },
                { msg: 'Ideal POS sync timeout', time: '24m ago' },
                { msg: 'Stripe Terminal disconnected', time: '37m ago' }
              ].map((err, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3 text-[10px]">
                  <div className="flex items-start gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1" />
                    <span className="font-extrabold text-gray-700 truncate leading-tight">
                      {err.msg}
                    </span>
                  </div>
                  <span className="text-gray-400 font-semibold shrink-0 select-none leading-tight">
                    {err.time}
                  </span>
                </div>
              ))}
              
              <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] font-semibold text-gray-500 cursor-pointer hover:text-gray-700 select-none">
                <span>Total Errors (24h): 5</span>
                <IconChevronDown />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Panels Row (col-span-5 layout) ────────────────────────────── */}
      <div className="grid grid-cols-5 gap-6">
        
        {/* Panel 1: Certificate Expiry (col-span-1) */}
        <div className="col-span-1 bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col justify-between h-[155px]">
          <div className="flex items-center justify-between select-none">
            <div className="flex items-center gap-1.5">
              <IconShield />
              <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase">
                Certificate Expiry
              </h3>
            </div>
            <button className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 select-none">
              View All
            </button>
          </div>
          
          <div className="grid grid-cols-[1fr_2fr] gap-4 items-center mt-2 flex-1">
            <div className="flex flex-col select-none border-r border-gray-100 pr-2">
              <span className="text-2xl font-black text-gray-900 leading-none">2</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tight mt-1 leading-tight">
                Expiring Soon
              </span>
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              {[
                { name: 'Star Micronics Certificate', days: '23' },
                { name: 'Epson Certificate', days: '41' }
              ].map((cert, idx) => (
                <div key={idx} className="flex flex-col min-w-0">
                  <span className="text-[10px] font-extrabold text-gray-700 truncate leading-tight">
                    {cert.name}
                  </span>
                  <div className="flex justify-between items-center text-[9px] mt-0.5 select-none">
                    <span className="text-gray-400 font-semibold">Expires in</span>
                    <span className="text-amber-600 bg-amber-50 px-1 py-0.5 rounded font-bold">
                      {cert.days} days
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel 2: OAuth Token Expiry (col-span-1) */}
        <div className="col-span-1 bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col justify-between h-[155px]">
          <div className="flex items-center justify-between select-none">
            <div className="flex items-center gap-1.5">
              <IconLock />
              <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase">
                OAuth Token Expiry
              </h3>
            </div>
            <button className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 select-none">
              View All
            </button>
          </div>
          
          <div className="grid grid-cols-[1fr_2fr] gap-4 items-center mt-2 flex-1">
            <div className="flex flex-col select-none border-r border-gray-100 pr-2">
              <span className="text-2xl font-black text-gray-900 leading-none">3</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tight mt-1 leading-tight">
                Expiring Soon
              </span>
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              {[
                { name: 'Ideal POS', days: '5' },
                { name: 'Uber Eats', days: '12' }
              ].map((tok, idx) => (
                <div key={idx} className="flex flex-col min-w-0">
                  <span className="text-[10px] font-extrabold text-gray-700 truncate leading-tight">
                    {tok.name}
                  </span>
                  <div className="flex justify-between items-center text-[9px] mt-0.5 select-none">
                    <span className="text-gray-400 font-semibold">Expires in</span>
                    <span className="text-amber-600 bg-amber-50 px-1 py-0.5 rounded font-bold">
                      {tok.days} days
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel 3: Last 24-Hour Activity (col-span-2) */}
        <div className="col-span-2 bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col justify-between h-[155px]">
          <div className="flex items-center justify-between select-none">
            <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase">
              Last 24-Hour Activity
            </h3>
            <button className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 select-none">
              View Full Report
            </button>
          </div>
          
          <div className="grid grid-cols-[1.2fr_2fr] gap-4 items-center flex-1 mt-2">
            {/* Legend info */}
            <div className="flex flex-col gap-2 select-none border-r border-gray-100 pr-2">
              {[
                { label: 'Successful Syncs', val: '1,245', dot: 'bg-emerald-500' },
                { label: 'Failed Syncs', val: '12', dot: 'bg-red-500' },
                { label: 'Webhooks', val: '1,876', dot: 'bg-blue-500' }
              ].map((leg, idx) => (
                <div key={idx} className="flex flex-col gap-0.5 leading-none">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${leg.dot}`} />
                    <span className="text-[10px] text-gray-500 font-semibold leading-none">
                      {leg.label}
                    </span>
                  </div>
                  <span className="text-xs font-extrabold text-gray-800 ml-3 mt-0.5 leading-none select-text">
                    {leg.val}
                  </span>
                </div>
              ))}
            </div>
            
            {/* SVG Chart area */}
            <ActivityLineChart />
          </div>
        </div>

        {/* Panel 4: Environment & System (col-span-1) */}
        <div className="col-span-1 bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col justify-between h-[155px]">
          <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase select-none">
            Environment & System
          </h3>
          
          <div className="flex flex-col gap-2 flex-1 mt-3 justify-center">
            {[
              {
                label: 'Environment',
                val: (
                  <span className="flex items-center gap-1 font-bold text-gray-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Production
                  </span>
                )
              },
              { label: 'Region', val: <span className="font-bold text-gray-800">Auckland, NZ</span> },
              { label: 'System Time', val: <span className="font-bold text-gray-800">1 Jul 2025, 11:42 AM NZST</span> },
              { label: 'Version', val: <span className="font-bold text-gray-800">v2.4.1</span> },
              {
                label: 'API Status',
                val: (
                  <span className="flex items-center gap-1 font-bold text-gray-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Operational
                  </span>
                )
              }
            ].map((row, idx) => (
              <div key={idx} className="flex justify-between items-center text-[10px]">
                <span className="text-gray-400 font-semibold select-none">{row.label}</span>
                {row.val}
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

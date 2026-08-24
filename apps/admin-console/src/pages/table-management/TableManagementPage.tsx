import { useMemo, useState, useEffect } from 'react';
import { TableMap, TableMapItem } from '../../components/TableMap';
import { TABLE_LAYOUTS, mapX, mapY, mapW, mapH } from '../../shared/tables';

interface TableItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status: string;
  l1: string;
  chairs: string;
  l2?: string;
  l3?: string;
  round?: boolean;
  alert?: boolean;
  cleaningBadge?: boolean;
}

// ---------- Initial Ground Floor Data ----------
const INITIAL_GROUND_TABLES: TableItem[] = TABLE_LAYOUTS.map((t) => {
  let status = 'available';
  if (t.id === 'T2') status = 'reserved';
  else if (t.id === 'T3') status = 'occupied';
  else if (t.id === 'T12') status = 'occupied';
  else if (t.id === 'T14') status = 'cleaning';
  else if (t.id === 'T15') status = 'reserved';
  else if (t.id === 'T16') status = 'alert';

  return {
    id: t.id,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    status,
    l1: String(t.seats),
    chairs: 'tb2',
    alert: t.id === 'T16' ? true : undefined,
  };
});

export function TableManagementPage() {
  const [tables, setTables] = useState<TableItem[]>(INITIAL_GROUND_TABLES);
  // No floor-switcher UI currently exists in this page (the "Floor Editor"/
  // "QR Codes"/"Add Table" buttons below are unrelated actions, and none of
  // them are wired to change floors either) — this stays a fixed value
  // rather than dead useState/setState machinery until that UI exists.
  const floor = 'ground';
  const [selectedId, setSelectedId] = useState<string | null>('T12');
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState('Overview');
  const [zoom, setZoom] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  // ---------- Synchronize top bar search input ----------
  useEffect(() => {
    const handleSearch = (e: Event) => {
      const query = (e as CustomEvent).detail || '';
      setSearchQuery(query);
    };
    window.addEventListener('table-search', handleSearch);
    return () => window.removeEventListener('table-search', handleSearch);
  }, []);

  // ---------- Generate Tables for other floors ----------
  const genFloor = (prefix: string, count: number, statuses: string[]): TableItem[] => {
    const out: TableItem[] = [];
    for (let i = 0; i < count; i++) {
      const col = i % 6, row = Math.floor(i / 6);
      const pxX = 110 + col * 112;
      const pxY = 90 + row * 118;
      out.push({
        id: prefix + (i + 1),
        x: (pxX / 810) * 100,
        y: (pxY / 530) * 100,
        w: (56 / 810) * 100,
        h: (62 / 530) * 100,
        status: statuses[i % statuses.length] || 'available',
        l1: (2 + (i % 3) * 2) + '',
        chairs: 'tb2',
        round: false,
      });
    }
    return out;
  };

  // ---------- Floor Tables Data getter ----------
  const currentFloorTables = useMemo<TableItem[]>(() => {
    if (floor === 'ground') return tables;
    if (floor === 'level1') return genFloor('L', 18, ['available', 'occupied', 'available', 'reserved', 'available', 'ordering']);
    if (floor === 'bar') return genFloor('B', 12, ['available', 'occupied', 'available']);
    if (floor === 'terrace') return genFloor('T', 16, ['available', 'available', 'reserved', 'occupied']);
    return genFloor('P', 6, ['available', 'reserved']);
  }, [floor, tables]);

  // ---------- Details data map ----------
  const getDetail = (id: string) => {
    const key = id.startsWith('T') ? id.slice(1) : id;
    const D: Record<string, { title: string; status: string; kind: string; seats: number; guests: string; server: string; si: string; seated: string; dur: string; order: string; amount: string; items: string; resv: string; notes: string[] }> = {
      '12': { title: 'Table T12', status: 'Occupied', kind: 'occupied', seats: 2, guests: '2 / 2', server: 'Sarah Mitchell', si: 'SM', seated: 'Seated at 5:18 PM', dur: '1h 24m', order: '#ORD-1287', amount: '$128.50', items: '5 items', resv: 'Walk-in', notes: ['VIP guest', 'Peanut allergy'] },
      '20': { title: 'Table T20', status: 'Occupied', kind: 'occupied', seats: 4, guests: '4 / 4', server: 'Alex Rivera', si: 'AR', seated: 'Seated at 5:27 PM', dur: '1h 15m', order: '#ORD-1291', amount: '$110.00', items: '4 items', resv: 'Walk-in', notes: [] },
      '3': { title: 'Table T3', status: 'Occupied', kind: 'occupied', seats: 2, guests: '2 / 2', server: 'Sarah Mitchell', si: 'SM', seated: 'Seated at 6:05 PM', dur: '37m', order: '#ORD-1302', amount: '$54.00', items: '3 items', resv: '6:30 PM · Alex R.', notes: [] },
      '23': { title: 'Table T23', status: 'Overstay', kind: 'alert', seats: 4, guests: '4 / 4', server: 'James Okafor', si: 'JO', seated: 'Seated at 4:48 PM', dur: '1h 54m', order: '#ORD-1275', amount: '$164.20', items: '7 items', resv: 'Walk-in', notes: ['Overstay > 90 min'] },
      '24': { title: 'Table T24', status: 'Cleaning', kind: 'cleaning', seats: 4, guests: '—', server: '—', si: '', seated: '—', dur: '', order: '—', amount: '', items: '', resv: '—', notes: ['Marked cleaning 6:36 PM'] },
    };
    return D[key] || D['T' + key] || null;
  };

  // ---------- Icon rendering helper ----------
  const renderIcon = (name: string, size = 15, strokeWidth = 2) => {
    const paths: Record<string, string> = {
      check: 'M20 6 9 17l-5-5',
      users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
      users2: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
      calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
      alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z M12 9v4 M12 17h.01',
      grid: 'M3 3h7v7H3Z M14 3h7v7h-7Z M14 14h7v7h-7Z M3 14h7v7H3Z',
      bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
      flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z',
      utensils: 'M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2 M5 2v20 M21 15V2a5 5 0 0 0-3 5v6c0 1.1.9 2 2 2h1Zm0 0v7',
      card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M2 10h20',
      clock: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
      seat: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
      open: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0',
      merge: 'M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3',
      split: 'M16 3h5v5 M8 3H3v5 M21 3l-7 7 M3 3l7 7 M16 21h5v-5 M8 21H3v-5 M21 21l-7-7 M3 21l7-7',
      move: 'M5 9l-3 3 3 3 M9 5l3-3 3 3 M15 19l-3 3-3-3 M19 9l3 3-3 3 M2 12h20 M12 2v20',
      transfer: 'M16 3h5v5 M21 3l-8 8 M8 21H3v-5 M3 21l8-8',
      printqr: 'M3 3h7v7H3Z M14 3h7v7h-7Z M14 14h3v3h-3Z M18 18h3v3h-3Z M3 14h7v7H3Z',
      message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z',
      block: 'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M10 11v6 M14 11v6',
      spark: 'M12 3v3 M18.4 5.6l-2.1 2.1 M21 12h-3 M18.4 18.4l-2.1-2.1 M12 18v3 M7.8 16.3l-2.1 2.1 M6 12H3 M7.8 7.7 5.6 5.6',
    };
    const d = paths[name] || 'M20 6 9 17l-5-5';
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {d.split(' M').map((seg, i) => (
          <path key={i} d={i === 0 ? seg : 'M' + seg} />
        ))}
      </svg>
    );
  };

  // ---------- Search Filter on tables ----------
  const isFiltered = (t: TableItem) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const d = getDetail(t.id);
    const server = d?.server || '';
    const notes = (d?.notes || []).join(' ');
    const floorName =
      floor === 'ground' ? 'Main dining room' :
      floor === 'level1' ? 'Level 1' :
      floor === 'bar' ? 'Bar' :
      floor === 'terrace' ? 'Terrace' : 'Private Dining';

    return (
      t.id.toLowerCase().includes(q) ||
      t.status.toLowerCase().includes(q) ||
      server.toLowerCase().includes(q) ||
      notes.toLowerCase().includes(q) ||
      floorName.toLowerCase().includes(q)
    );
  };

  // ---------- Action button to mutate table status ----------
  const changeSelectedTableStatus = (newStatus: string) => {
    if (!selectedId || floor !== 'ground') return;
    setTables((prev) =>
      prev.map((t) => (t.id === selectedId ? { ...t, status: newStatus } : t))
    );
  };

  // ---------- KPI Card Data ----------
  const kpis = [
    { label: 'Available Tables', value: '18', delta: '24%', deltaColor: '#15803d', sub: 'of 74 total', chipBg: '#dcfce7', chipFg: '#16a34a', icon: renderIcon('check') },
    { label: 'Occupied Tables', value: '32', delta: '43%', deltaColor: '#1d4ed8', sub: 'of 74 total', chipBg: '#dbeafe', chipFg: '#2563eb', icon: renderIcon('users') },
    { label: 'Reserved Tables', value: '14', delta: '19%', deltaColor: '#6d28d9', sub: 'of 74 total', chipBg: '#ede9fe', chipFg: '#7c3aed', icon: renderIcon('calendar') },
    { label: 'Cleaning', value: '6', delta: '8%', deltaColor: '#b45309', sub: 'of 74 total', chipBg: '#fef3c7', chipFg: '#d97706', icon: renderIcon('alert') },
    { label: 'Guests Seated', value: '86', delta: '+12', deltaColor: '#15803d', sub: 'vs yesterday', chipBg: '#dcfce7', chipFg: '#16a34a', icon: renderIcon('users2') },
    { label: 'Occupancy', value: '68%', delta: '+8%', deltaColor: '#b45309', sub: 'vs yesterday', chipBg: '#fef3c7', chipFg: '#d97706', icon: renderIcon('grid') },
  ];

  // ---------- Timeline Data ----------
  const chip = (label: string, kind?: 'blue' | 'green' | 'red', dot?: string) => {
    const K = {
      blue: { bg: '#eff6ff', fg: '#1d4ed8', border: '#dbeafe' },
      green: { bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
      red: { bg: '#fef2f2', fg: '#b91c1c', border: '#fee2e2' },
    }[kind || 'blue'];
    return { label, bg: K.bg, fg: K.fg, border: K.border, dot: dot || false };
  };

  const timeSlots = [
    { time: '5:30 PM', timeColor: '#6b7280', chips: [chip('2 Reservations')] },
    { time: '6:00 PM', timeColor: '#6b7280', chips: [chip('4 Reservations')] },
    { time: '6:30 PM', timeColor: '#15803d', isNow: true, chips: [chip('6 Reservations', 'green')] },
    { time: '7:00 PM', timeColor: '#6b7280', chips: [chip('5 Reservations')] },
    { time: '7:30 PM', timeColor: '#6b7280', chips: [chip('3 Reservations')] },
    { time: '8:00 PM', timeColor: '#6b7280', chips: [chip('6 Reservations')] },
    { time: '8:30 PM', timeColor: '#6b7280', chips: [chip('2 Late', 'red', '#dc2626'), chip('8 Reservations')] },
    { time: '9:00 PM', timeColor: '#6b7280', chips: [chip('2 Reservations')] },
  ];

  const tlLegend = [
    { label: 'Confirmed', color: '#16a34a' },
    { label: 'Arrived', color: '#3b82f6' },
    { label: 'Seated', color: '#111827' },
    { label: 'Late', color: '#dc2626' },
    { label: 'No Show', color: '#9ca3af' },
  ];

  // ---------- Live Service Summary Data ----------
  const summary = [
    { value: '12', label: 'Waiting for Order', chipBg: '#dbeafe', chipFg: '#2563eb', icon: renderIcon('users'), divider: 'none' },
    { value: '5', label: 'Food Ready', chipBg: '#ede9fe', chipFg: '#7c3aed', icon: renderIcon('bell'), divider: '1px solid #f3f4f6' },
    { value: '32', label: 'Currently Dining', chipBg: '#dcfce7', chipFg: '#16a34a', icon: renderIcon('utensils'), divider: '1px solid #f3f4f6' },
    { value: '3', label: 'Waiting Payment', chipBg: '#fef3c7', chipFg: '#d97706', icon: renderIcon('card'), divider: '1px solid #f3f4f6' },
    { value: '4', label: 'Overstay', note: '> 90 min', noteColor: '#dc2626', chipBg: '#fee2e2', chipFg: '#dc2626', icon: renderIcon('alert'), divider: '1px solid #f3f4f6' },
    { value: '2', label: 'Cleaning Overdue', note: '> 20 min', noteColor: '#b45309', chipBg: '#fef3c7', chipFg: '#d97706', icon: renderIcon('alert'), divider: '1px solid #f3f4f6' },
  ];

  // ---------- Waitlist & Activity Data ----------
  const waitlist = [
    { n: '1', name: 'Smith', party: 'Party of 4', wait: '12 min', waitColor: '#b45309', next: 'Next: Table 16' },
    { n: '2', name: 'Johnson', party: 'Party of 2', wait: '+ 4 min', waitColor: '#15803d', next: 'Next: Table 8' },
    { n: '3', name: 'Williams', party: 'Party of 6', wait: '18 min', waitColor: '#b45309', next: 'Next: Table 21' },
    { n: '4', name: 'Brown', party: 'Party of 3', wait: '7 min', waitColor: '#374151', next: 'Next: Table 12' },
    { n: '5', name: 'Davis', party: 'Party of 2', wait: '22 min', waitColor: '#b45309', next: 'Next: Table 5' },
  ];

  const activity = [
    { time: '6:42 PM', title: 'Table 12 seated', sub: 'Sarah Mitchell' },
    { time: '6:41 PM', title: 'Order sent to kitchen', sub: 'Table 12 · 5 items' },
    { time: '6:38 PM', title: 'Table 7 payment completed', sub: '$89.50' },
    { time: '6:38 PM', title: 'Table 21 reservation arrived', sub: 'Party of 4' },
    { time: '6:36 PM', title: 'Table 3 marked as cleaning', sub: 'Alex Rivera' },
  ];

  const statusLegend = [
    { label: 'Available', color: '#16a34a' },
    { label: 'Reserved', color: '#8b5cf6' },
    { label: 'Occupied', color: '#3b82f6' },
    { label: 'Ordering', color: '#9ca3af' },
    { label: 'Food Ready', color: '#7c3aed' },
    { label: 'Dining', color: '#22c55e' },
    { label: 'Bill Requested', color: '#f59e0b' },
    { label: 'Paying', color: '#2563eb' },
    { label: 'Cleaning', color: '#d97706' },
    { label: 'Out of Service', color: '#6b7280' },
  ];

  // ---------- Tables for Render Mapping ----------
  const tablesForRender = useMemo<TableMapItem[]>(() => {
    return currentFloorTables.map((t) => {
      const sel = t.id === selectedId;
      const status = t.status;

      const rx = mapX(t.x);
      const ry = mapY(t.y);
      const rw = mapW(t.w);
      const rh = mapH(t.h);

      // table status colors adapted to match OrderTabletPage!
      let statusColor = 'var(--color-surface)';
      let textColor = 'var(--color-text)';
      let borderStyle = '1.5px solid var(--color-border-strong)';

      if (status === 'occupied' || status === 'alert') {
        statusColor = '#FFB703';
        textColor = '#4A3200';
        borderStyle = '1px solid #FFB703';
      } else if (status === 'reserved') {
        statusColor = '#8B5CF6';
        textColor = '#fff';
        borderStyle = '1px solid #8B5CF6';
      } else if (status === 'cleaning') {
        statusColor = 'var(--color-surface-3)';
        textColor = 'var(--color-text-secondary)';
        borderStyle = '1px solid var(--color-border)';
      } else if (status === 'out-of-service') {
        statusColor = 'var(--color-surface-3)';
        textColor = 'var(--color-text-tertiary)';
        borderStyle = '1px dashed var(--color-border)';
      } else if (status === 'ordering') {
        statusColor = 'var(--color-surface)';
        borderStyle = '1px solid var(--color-border)';
      }

      if (sel) {
        statusColor = 'var(--color-primary)';
        textColor = '#fff';
        borderStyle = '1px solid var(--color-primary)';
      }

      const matchesSearch = isFiltered(t);
      const shadowStyle = sel ? 'var(--shadow-md)' : 'none';

      // Status labels on button subLabel
      const statusLabel = status === 'available' ? '' : ` · ${status}`;
      const subLabel = `${t.l1} seats${statusLabel}`;

      return {
        id: t.id,
        x: rx,
        y: ry,
        w: rw,
        h: rh,
        label: t.id,
        subLabel: subLabel,
        bg: statusColor,
        border: borderStyle,
        color: textColor,
        shadow: shadowStyle,
        cursor: 'pointer',
        opacity: matchesSearch ? 1 : 0.2,
        transform: matchesSearch ? 'scale(1)' : 'scale(0.95)',
        pointerEvents: matchesSearch ? 'auto' : 'none',
        onTap: () => {
          setSelectedId(t.id);
          setPanelOpen(true);
          setPanelTab('Overview');
        }
      };
    });
  }, [currentFloorTables, selectedId, searchQuery, floor]);

  // ---------- Detail Side Panel Computation ----------
  const selT = currentFloorTables.find((t) => t.id === selectedId);
  const detailObj = useMemo(() => {
    if (!selectedId) return null;
    const detail = getDetail(selectedId);
    if (detail) return detail;
    if (selT) {
      return {
        title: 'Table ' + selT.id,
        status: selT.status === 'available' ? 'Available' :
                selT.status === 'reserved' ? 'Reserved' :
                selT.status === 'occupied' ? 'Occupied' :
                selT.status === 'cleaning' ? 'Cleaning' :
                selT.status === 'alert' ? 'Overstay' : 'Ordering',
        kind: selT.status,
        seats: parseInt(selT.l1) || 4,
        guests: selT.l1 || '—',
        server: '—',
        si: '',
        seated: '—',
        dur: '',
        order: '—',
        amount: '',
        items: '',
        resv: '—',
        notes: [] as string[],
      };
    }
    return null;
  }, [selectedId, selT]);

  const badgePal = {
    occupied: { bg: '#eff6ff', fg: '#1d4ed8', border: '#dbeafe' },
    available: { bg: '#f0fdf4', fg: '#15803d', border: '#dcfce7' },
    reserved: { bg: '#f5f3ff', fg: '#6d28d9', border: '#ede9fe' },
    ordering: { bg: '#f9fafb', fg: '#4b5563', border: '#e5e7eb' },
    alert: { bg: '#fffbeb', fg: '#b45309', border: '#fef3c7' },
    cleaning: { bg: '#f9fafb', fg: '#6b7280', border: '#e5e7eb' },
  };

  const bp = (detailObj && badgePal[detailObj.kind as keyof typeof badgePal]) || badgePal.occupied;
  const floorNames: Record<string, string> = {
    ground: 'Main dining room',
    level1: 'Level 1',
    bar: 'Bar',
    terrace: 'Terrace',
    private: 'Private Dining'
  };

  const detFields = useMemo(() => {
    if (!detailObj) return [];
    return [
      { label: 'Status', main: false, badge: detailObj.status, right: false },
      { label: 'Guests', main: false, right: detailObj.guests },
      { label: 'Assigned server', main: false, avatar: detailObj.si || false, right2: detailObj.server, right: detailObj.si ? false : detailObj.server },
      { label: 'Time seated', main: false, sub: detailObj.seated, right: detailObj.dur || '—' },
      { label: 'Current order', main: detailObj.order, sub: detailObj.items || false, right: detailObj.amount || '—' },
      { label: 'Reservation', main: false, right: detailObj.resv },
      { label: 'Notes', main: detailObj.notes[0] || '—', sub: detailObj.notes[1] || false, right: false },
    ];
  }, [detailObj]);

  const panelTabs = ['Overview', 'Order', 'Reservation', 'Guests', 'History'].map((tb) => ({
    label: tb,
    badge: tb === 'Order' ? '5' : false,
    weight: tb === panelTab ? 600 : 500,
    color: tb === panelTab ? '#15803d' : '#6b7280',
    underline: tb === panelTab ? '#16a34a' : 'transparent',
    onClick: () => setPanelTab(tb),
  }));

  const qaN = { border: '#e5e7eb', bg: '#ffffff', fg: '#374151' };
  const quickActions = [
    { label: 'Seat Guests', icon: renderIcon('seat', 13), ...qaN, onClick: () => changeSelectedTableStatus('occupied') },
    { label: 'Open Order', icon: renderIcon('open', 13), ...qaN, onClick: () => changeSelectedTableStatus('ordering') },
    { label: 'Merge Table', icon: renderIcon('merge', 13), ...qaN, onClick: () => {} },
    { label: 'Split Table', icon: renderIcon('split', 13), ...qaN, onClick: () => {} },
    { label: 'Move Table', icon: renderIcon('move', 13), ...qaN, onClick: () => {} },
    { label: 'Transfer Server', icon: renderIcon('transfer', 13), ...qaN, onClick: () => {} },
    { label: 'Print QR', icon: renderIcon('printqr', 13), ...qaN, onClick: () => {} },
    { label: 'Send Message', icon: renderIcon('message', 13), ...qaN, onClick: () => {} },
    { label: 'Block Table', icon: renderIcon('block', 13), border: '#fee2e2', bg: '#fef2f2', fg: '#dc2626', onClick: () => changeSelectedTableStatus('out-of-service') },
    { label: 'Mark Cleaning', icon: renderIcon('alert', 13), border: '#fef3c7', bg: '#fffbeb', fg: '#b45309', onClick: () => changeSelectedTableStatus('cleaning') },
  ];

  return (
    <div style={{ padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '14px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <style>{`
        @keyframes vd-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        .floor-tab-btn:hover {
          border-color: #d1d5db !important;
        }
        .quick-action-btn:hover {
          filter: brightness(0.97) !important;
        }
        .zoom-btn:hover {
          background-color: #f3f4f6 !important;
        }
        .table-element:hover {
          box-shadow: 0 2px 8px rgba(15,23,42,0.18) !important;
        }
        .timeline-chip:hover {
          filter: brightness(0.98) !important;
        }
      `}</style>

      {/* ============ KPI ROW ============ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px' }}>
        {kpis.map((k, idx) => (
          <div key={idx} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ width: '30px', height: '30px', borderRadius: '8px', background: k.chipBg, color: k.chipFg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {k.icon}
              </span>
              <span style={{ fontSize: '12.5px', fontWeight: 500, color: '#4b5563' }}>{k.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '27px', fontWeight: 600, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{k.value}</span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: k.deltaColor }}>{k.delta}</span>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>{k.sub}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ============ FLOOR TABS ROW ============ */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
        <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', paddingLeft: '8px' }}>Main dining room</div>
        <span style={{ flex: 1 }}></span>
        <button className="floor-tab-btn" style={{ border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: 500, padding: '7px 13px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
          Floor Editor
        </button>
        <button className="floor-tab-btn" style={{ border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: 500, padding: '7px 13px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>
          QR Codes
        </button>
        <button className="floor-tab-btn" style={{ border: 'none', background: '#16a34a', color: '#fff', fontSize: '13px', fontWeight: 600, padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"></path></svg>
          Add Table
        </button>
      </div>

      {/* ============ MIDDLE SECTION: left column + detail panel ============ */}
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* ============ TIMELINE CARD ============ */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 'none', width: '118px', display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '28px' }}>
                <span style={{ fontSize: '14.5px', fontWeight: 600 }}>Today</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6b7280' }}>
                  May 28, 2024
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>
                </span>
              </div>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '8px', paddingTop: '26px' }}>
                {timeSlots.map((ts, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
                    {ts.isNow && (
                      <span style={{ position: 'absolute', top: '-4px', left: 0, transform: 'translateY(-100%)', background: '#16a34a', color: '#fff', fontSize: '10.5px', fontWeight: 600, padding: '2px 8px', borderRadius: '5px', whiteSpace: 'nowrap' }}>
                        NOW &nbsp;6:42 PM
                      </span>
                    )}
                    <span style={{ fontSize: '12px', fontWeight: 600, color: ts.timeColor }}>{ts.time}</span>
                    {ts.chips.map((ch, cidx) => (
                      <span key={cidx} className="timeline-chip" style={{ fontSize: '11px', fontWeight: 500, padding: '5px 8px', borderRadius: '6px', background: ch.bg, color: ch.fg, border: '1px solid ' + ch.border, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', transition: 'filter 150ms ease' }}>
                        {ch.dot && <span style={{ width: '6px', height: '6px', borderRadius: '999px', background: ch.dot as string }}></span>}
                        {ch.label}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '18px', marginTop: '12px', paddingLeft: '134px' }}>
              {tlLegend.map((lg, idx) => (
                <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#6b7280' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '999px', background: lg.color }}></span>
                  {lg.label}
                </span>
              ))}
            </div>
          </div>

          {/* ============ BIG FLOOR CARD ============ */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px 16px 12px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)', display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* LIVE SERVICE SUMMARY */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 600, marginBottom: '10px' }}>Live Service Summary</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {summary.map((sm, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '0 16px', borderLeft: sm.divider === 'none' ? 'none' : sm.divider }}>
                    <span style={{ width: '30px', height: '30px', borderRadius: '8px', background: sm.chipBg, color: sm.chipFg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {sm.icon}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{ fontSize: '17px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{sm.value}</span>
                        {sm.note && <span style={{ fontSize: '10.5px', fontWeight: 600, color: sm.noteColor }}>{sm.note}</span>}
                      </span>
                      <span style={{ fontSize: '11px', color: '#6b7280' }}>{sm.label}</span>
                    </span>
                  </div>
                ))}
                <span style={{ flex: 1 }}></span>
                <a href="#" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600, color: '#dc2626', textDecoration: 'none', paddingRight: '4px' }}>
                  View All Alerts &nbsp;(7)
                  <span style={{ width: '20px', height: '20px', borderRadius: '999px', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"></path></svg>
                  </span>
                </a>
              </div>
            </div>

            {/* WAITLIST + FLOOR PLAN */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ flex: 'none', width: '184px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

                {/* Waiting list */}
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '8px', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Waiting List</span>
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>5 Parties</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {waitlist.map((w, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px', padding: '7px 0', borderTop: idx === 0 ? 'none' : '1px solid #f3f4f6' }}>
                        <span style={{ flex: 'none', width: '18px', height: '18px', borderRadius: '999px', background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#4b5563', fontSize: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px' }}>
                          {w.n}
                        </span>
                        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                          <span style={{ fontSize: '12px', fontWeight: 600 }}>{w.name}</span>
                          <span style={{ fontSize: '10.5px', color: '#6b7280' }}>{w.party}</span>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.3 }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: w.waitColor }}>{w.wait}</span>
                          <span style={{ fontSize: '10px', color: '#9ca3af' }}>{w.next}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <a href="#" style={{ display: 'block', textAlign: 'center', fontSize: '11.5px', fontWeight: 600, color: '#15803d', textDecoration: 'none', paddingTop: '8px', borderTop: '1px solid #f3f4f6' }}>
                    View Full Waitlist &nbsp;›
                  </a>
                </div>

                {/* Live activity */}
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '8px', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Live Activity</span>
                    <a href="#" style={{ fontSize: '11px', fontWeight: 500, color: '#15803d', textDecoration: 'none' }}>See All</a>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {activity.map((a, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '7px', padding: '6px 0', borderTop: idx === 0 ? 'none' : '1px solid #f3f4f6' }}>
                        <span style={{ flex: 'none', fontSize: '9.5px', color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace", marginTop: '2px', whiteSpace: 'nowrap' }}>
                          {a.time}
                        </span>
                        <span style={{ flex: 'none', width: '6px', height: '6px', borderRadius: '999px', background: '#16a34a', marginTop: '5px' }}></span>
                        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.35 }}>
                          <span style={{ fontSize: '11px', fontWeight: 600 }}>{a.title}</span>
                          <span style={{ fontSize: '10px', color: '#6b7280' }}>{a.sub}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* FLOOR PLAN CANVAS */}
              <div style={{ flex: 1, minWidth: 0, position: 'relative', height: '560px', display: 'flex', flexDirection: 'column' }}>
                {/* Zoom Controls */}
                <div style={{ position: 'absolute', left: '10px', top: '20px', zIndex: 30, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button onClick={() => setZoom(z => Math.min(1.6, +(z + 0.1).toFixed(2)))} className="zoom-btn" style={{ width: '30px', height: '30px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: '7px', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.06)', transition: 'background-color 150ms ease' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"></path></svg>
                  </button>
                  <button onClick={() => setZoom(z => Math.max(0.6, +(z - 0.1).toFixed(2)))} className="zoom-btn" style={{ width: '30px', height: '30px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: '7px', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.06)', transition: 'background-color 150ms ease' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path></svg>
                  </button>
                  <button onClick={() => setZoom(1)} className="zoom-btn" style={{ width: '30px', height: '30px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: '7px', color: '#374151', display: 'flex', alignItems: 'center', cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.06)', marginTop: '4px', transition: 'background-color 150ms ease', justifyContent: 'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>
                  </button>
                  <button className="zoom-btn" style={{ width: '30px', height: '30px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: '7px', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.06)', marginTop: '4px', transition: 'background-color 150ms ease' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 8.5 4.5-8.5 4.5L3.5 6.5 12 2Z"></path><path d="m3.5 12 8.5 4.5 8.5-4.5"></path><path d="m3.5 17.5 8.5 4.5 8.5-4.5"></path></svg>
                  </button>
                </div>

                <TableMap
                  tables={tablesForRender}
                  zoom={zoom}
                  onBackgroundTap={() => setSelectedId(null)}
                />
              </div>
            </div>

            {/* STATUS PLAN LEGEND */}
            <div style={{ display: 'flex', gap: '18px', justifyContent: 'center', padding: '2px 0 2px' }}>
              {statusLegend.map((sl, idx) => (
                <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#6b7280' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: sl.color }}></span>
                  {sl.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ============ DETAIL PANEL ============ */}
        {panelOpen && detailObj && (
          <aside style={{ flex: 'none', width: '272px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)', padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-0.01em' }}>{detailObj.title}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '999px', background: bp.bg, color: bp.fg, border: '1px solid ' + bp.border }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '999px', background: bp.fg }}></span>
                {detailObj.status}
              </span>
              <span style={{ flex: 1 }}></span>
              <button onClick={() => setPanelOpen(false)} style={{ width: '26px', height: '26px', border: 'none', background: 'transparent', borderRadius: '6px', color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '7px', fontSize: '11.5px', color: '#6b7280' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
                {detailObj.seats} Seats
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3"></path></svg>
                Indoor
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                {floorNames[floor]}
              </span>
            </div>

            {/* Tabs inside panel */}
            <div style={{ display: 'flex', gap: '1px', justifyContent: 'space-between', borderBottom: '1px solid #e5e7eb', marginTop: '12px' }}>
              {panelTabs.map((pt, idx) => (
                <button
                  key={idx}
                  onClick={pt.onClick}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontFamily: 'inherit',
                    fontSize: '10px',
                    fontWeight: pt.weight,
                    color: pt.color,
                    padding: '7px 1px 8px',
                    cursor: 'pointer',
                    borderBottom: '2px solid ' + pt.underline,
                    marginBottom: '-1px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pt.label}
                  {pt.badge && (
                    <span style={{ background: '#2563eb', color: '#fff', fontSize: '8.5px', fontWeight: 600, minWidth: '13px', height: '13px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {pt.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {panelTab === 'Overview' ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {detFields.map((fd, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', padding: '11px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em', color: '#9ca3af', textTransform: 'uppercase' }}>{fd.label}</span>
                      {fd.main && <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#111827' }}>{fd.main}</span>}
                      {fd.sub && <span style={{ fontSize: '11px', color: '#6b7280' }}>{fd.sub}</span>}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', textAlign: 'right' }}>
                      {fd.badge && <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '999px', background: bp.bg, color: bp.fg }}>{fd.badge}</span>}
                      {fd.right && <span style={{ fontSize: '12.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fd.right}</span>}
                      {fd.avatar && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '20px', height: '20px', borderRadius: '999px', background: '#dbeafe', color: '#1d4ed8', fontSize: '8.5px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            {fd.avatar}
                          </span>
                          <span style={{ fontSize: '12px', fontWeight: 600 }}>{fd.right2}</span>
                        </span>
                      )}
                      {!fd.avatar && fd.right === false && fd.right2 && (
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>{fd.right2}</span>
                      )}
                    </span>
                  </div>
                ))}

                {/* Table QR row */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0 13px', borderBottom: '1px solid #e5e7eb', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em', color: '#9ca3af' }}>TABLE QR</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '34px', height: '34px', border: '1px solid #e5e7eb', borderRadius: '6px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: '2px', padding: '5px' }}>
                      <span style={{ background: '#111827', borderRadius: '1px' }}></span><span style={{ background: '#111827', borderRadius: '1px' }}></span><span style={{ background: '#111827', borderRadius: '1px' }}></span>
                      <span style={{ background: '#111827', borderRadius: '1px' }}></span><span></span><span style={{ background: '#111827', borderRadius: '1px' }}></span>
                      <span style={{ background: '#111827', borderRadius: '1px' }}></span><span style={{ background: '#111827', borderRadius: '1px' }}></span><span style={{ background: '#111827', borderRadius: '1px' }}></span>
                    </span>
                    <a href="#" style={{ fontSize: '11.5px', fontWeight: 600, color: '#15803d', textDecoration: 'none' }}>View / Print</a>
                  </span>
                </div>

                {/* Quick Actions Title */}
                <div style={{ fontSize: '12.5px', fontWeight: 600, margin: '13px 0 9px' }}>Quick Actions</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {quickActions.map((qa, idx) => (
                    <button
                      key={idx}
                      onClick={qa.onClick}
                      className="quick-action-btn"
                      style={{
                        border: '1px solid ' + qa.border,
                        background: qa.bg,
                        color: qa.fg,
                        fontFamily: 'inherit',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        padding: '8px 6px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        whiteSpace: 'nowrap',
                        transition: 'filter 150ms ease',
                      }}
                    >
                      {qa.icon}
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: '36px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>{panelTab}</span>
                <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>{panelTab} details for {detailObj.title} will appear here.</span>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

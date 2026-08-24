import { useState, useMemo } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
interface AuditRecord {
  id: string;
  timestamp: Date;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  user: {
    name: string;
    role: string;
    avatarColor: string;
    initials: string;
  };
  action: {
    badge: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT' | 'REFUND' | 'PAYMENT' | 'ACCESS' | 'SYSTEM';
    description: string;
  };
  resource: {
    name: string;
    subtitle: string;
  };
  venue: string;
  outcome: 'Success' | 'Warning' | 'Failed';
  ipAddress: string;
  device: string;
  sessionId: string;
  requestId: string;
  correlationId: string;
  permissions: string;
  detailsJson: string;
}

// ── Mock Data Generator ──────────────────────────────────────────────────────
const USERS = [
  { name: 'Alex Rivera', role: 'Manager', avatarColor: 'bg-emerald-500 text-white', initials: 'AR' },
  { name: 'Sarah Mitchell', role: 'Supervisor', avatarColor: 'bg-purple-500 text-white', initials: 'SM' },
  { name: 'James Morgan', role: 'Staff', avatarColor: 'bg-amber-500 text-white', initials: 'JM' },
  { name: 'Emma Roberts', role: 'Manager', avatarColor: 'bg-blue-500 text-white', initials: 'ER' },
  { name: 'David Lee', role: 'Manager', avatarColor: 'bg-indigo-500 text-white', initials: 'DL' }
];

const ACTIONS = [
  { badge: 'CREATE' as const, description: 'Created new menu item', resName: 'Menu Item', resSub: 'Truffle Pasta' },
  { badge: 'UPDATE' as const, description: 'Updated table status', resName: 'Table', resSub: 'Table 12' },
  { badge: 'DELETE' as const, description: 'Deleted order', resName: 'Order', resSub: '#ORD-1258' },
  { badge: 'UPDATE' as const, description: 'Updated reservation', resName: 'Reservation', resSub: '#RES-8892' },
  { badge: 'CREATE' as const, description: 'Created new staff', resName: 'Staff', resSub: 'Michael Chen' },
  { badge: 'UPDATE' as const, description: 'Updated inventory', resName: 'Inventory Item', resSub: 'Beef Tenderloin' },
  { badge: 'LOGIN' as const, description: 'User logged in', resName: 'System', resSub: 'Authentication' },
  { badge: 'UPDATE' as const, description: 'Updated order status', resName: 'Order', resSub: '#ORD-1257' },
  { badge: 'UPDATE' as const, description: 'Updated venue details', resName: 'Venue', resSub: 'Auckland Central' },
  { badge: 'CREATE' as const, description: 'Discount created', resName: 'Menu Item', resSub: 'Happy Hour 10%' },
  { badge: 'UPDATE' as const, description: 'Customer merged', resName: 'Customer', resSub: 'John Doe & J. Doe' },
  { badge: 'UPDATE' as const, description: 'Recipe updated', resName: 'Menu Item', resSub: 'Vegan Burger' },
  { badge: 'SYSTEM' as const, description: 'Barcode scanned', resName: 'Inventory Item', resSub: 'Tomato Sauce Box' },
  { badge: 'SYSTEM' as const, description: 'QR scanned', resName: 'Table', resSub: 'Table 4 QR Code' },
  { badge: 'UPDATE' as const, description: 'Table reassigned', resName: 'Reservation', resSub: '#RES-8890 to Table 5' },
  { badge: 'UPDATE' as const, description: 'Reservation confirmed', resName: 'Reservation', resSub: '#RES-8895' },
  { badge: 'UPDATE' as const, description: 'Stock transferred', resName: 'Inventory Item', resSub: 'Avocados (CBD -> Gardens)' },
  { badge: 'UPDATE' as const, description: 'Waste recorded', resName: 'Inventory Item', resSub: 'Spoiled Milk (3L)' },
  { badge: 'UPDATE' as const, description: 'Supplier updated', resName: 'Supplier', resSub: 'Fresh Foods Ltd' }
];

const VENUES = [
  'Auckland Central',
  'Auckland CBD',
  'Wellington Waterfront',
  'Christchurch Central',
  'Hamilton Gardens'
];

const SEVERITIES: ('CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO')[] = [
  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'
];

const OUTCOMES: ('Success' | 'Warning' | 'Failed')[] = [
  'Success', 'Warning', 'Failed'
];

const IPS = [
  '192.168.1.45',
  '192.168.1.18',
  '192.168.1.12',
  '210.54.122.9',
  '122.56.88.31'
];

const DEVICES = [
  'Windows 11 • Chrome 129.0',
  'macOS 14 • Safari 17.2',
  'iOS 17 • iPhone 15',
  'Android 14 • Pixel 8',
  'Windows 10 • Firefox 125.0'
];

function generateMockData(): AuditRecord[] {
  const records: AuditRecord[] = [];
  const baseDate = new Date();

  // Exact first 10 items to match the screenshot
  const screenshotRecords = [
    {
      id: 'evt_01J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 1 * 60 * 1000), // 1 min ago
      severity: 'CRITICAL' as const,
      user: USERS[0]!, // Alex Rivera
      action: { badge: 'CREATE' as const, description: 'Created new menu item' },
      resource: { name: 'Menu Item', subtitle: 'Truffle Pasta' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.45',
      device: 'Windows 11 • Chrome 129.0',
      sessionId: 'sess_01J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_01J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_01J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Menu: Write, Menu Item: Create',
      detailsJson: '{\n  "event": "menu.item.created",\n  "actor": "alex.rivera@verdura.co.nz",\n  "resource": "menu_item_truffle_pasta",\n  "changes": {\n    "name": "Truffle Pasta",\n    "category": "Mains",\n    "price": 28.50,\n    "status": "active"\n  },\n  "compliance": {\n    "immutable": true,\n    "secure": true,\n    "gdpr": "non_sensitive"\n  }\n}'
    },
    {
      id: 'evt_02J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 4 * 60 * 1000), // 4 min ago
      severity: 'HIGH' as const,
      user: USERS[1]!, // Sarah Mitchell
      action: { badge: 'UPDATE' as const, description: 'Updated table status' },
      resource: { name: 'Table', subtitle: 'Table 12' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.45',
      device: 'Windows 11 • Chrome 129.0',
      sessionId: 'sess_02J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_02J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_02J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Table: Write',
      detailsJson: '{\n  "event": "table.status.updated",\n  "actor": "sarah.mitchell@verdura.co.nz",\n  "resource": "table_12",\n  "changes": {\n    "status": "occupied",\n    "guests": 4\n  }\n}'
    },
    {
      id: 'evt_03J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 7 * 60 * 1000), // 7 min ago
      severity: 'HIGH' as const,
      user: USERS[2]!, // James Morgan
      action: { badge: 'DELETE' as const, description: 'Deleted order' },
      resource: { name: 'Order', subtitle: '#ORD-1258' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.18',
      device: 'macOS 14 • Safari 17.2',
      sessionId: 'sess_03J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_03J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_03J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Order: Write, Order: Delete',
      detailsJson: '{\n  "event": "order.deleted",\n  "actor": "james.morgan@verdura.co.nz",\n  "resource": "order_1258",\n  "reason": "Customer cancellation"\n}'
    },
    {
      id: 'evt_04J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 10 * 60 * 1000), // 10 min ago
      severity: 'MEDIUM' as const,
      user: USERS[3]!, // Emma Roberts
      action: { badge: 'UPDATE' as const, description: 'Updated reservation' },
      resource: { name: 'Reservation', subtitle: '#RES-8892' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.45',
      device: 'Windows 11 • Chrome 129.0',
      sessionId: 'sess_04J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_04J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_04J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Reservation: Write',
      detailsJson: '{\n  "event": "reservation.updated",\n  "actor": "emma.roberts@verdura.co.nz",\n  "resource": "reservation_8892",\n  "changes": {\n    "time": "19:30",\n    "covers": 6\n  }\n}'
    },
    {
      id: 'evt_05J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 13 * 60 * 1000), // 13 min ago
      severity: 'LOW' as const,
      user: USERS[4]!, // David Lee
      action: { badge: 'CREATE' as const, description: 'Created new staff' },
      resource: { name: 'Staff', subtitle: 'Michael Chen' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.12',
      device: 'Windows 10 • Firefox 125.0',
      sessionId: 'sess_05J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_05J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_05J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Staff: Write',
      detailsJson: '{\n  "event": "staff.created",\n  "actor": "david.lee@verdura.co.nz",\n  "resource": "staff_michael_chen",\n  "role": "chef"\n}'
    },
    {
      id: 'evt_06J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 17 * 60 * 1000), // 17 min ago
      severity: 'MEDIUM' as const,
      user: USERS[1]!, // Sarah Mitchell
      action: { badge: 'UPDATE' as const, description: 'Updated inventory' },
      resource: { name: 'Inventory Item', subtitle: 'Beef Tenderloin' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.45',
      device: 'Windows 11 • Chrome 129.0',
      sessionId: 'sess_06J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_06J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_06J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Inventory: Write',
      detailsJson: '{\n  "event": "inventory.updated",\n  "actor": "sarah.mitchell@verdura.co.nz",\n  "resource": "inv_beef_tenderloin",\n  "changes": {\n    "stock": 14.5\n  }\n}'
    },
    {
      id: 'evt_07J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 20 * 60 * 1000), // 20 min ago
      severity: 'INFO' as const,
      user: USERS[0]!, // Alex Rivera
      action: { badge: 'LOGIN' as const, description: 'User logged in' },
      resource: { name: 'System', subtitle: 'Authentication' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.45',
      device: 'Windows 11 • Chrome 129.0',
      sessionId: 'sess_07J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_07J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_07J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'System: Access',
      detailsJson: '{\n  "event": "auth.login.success",\n  "actor": "alex.rivera@verdura.co.nz",\n  "method": "password_mfa"\n}'
    },
    {
      id: 'evt_08J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 24 * 60 * 1000), // 24 min ago
      severity: 'HIGH' as const,
      user: USERS[2]!, // James Morgan
      action: { badge: 'UPDATE' as const, description: 'Updated order status' },
      resource: { name: 'Order', subtitle: '#ORD-1257' },
      venue: 'Auckland Central',
      outcome: 'Warning' as const,
      ipAddress: '192.168.1.18',
      device: 'macOS 14 • Safari 17.2',
      sessionId: 'sess_08J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_08J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_08J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Order: Write',
      detailsJson: '{\n  "event": "order.status.updated",\n  "actor": "james.morgan@verdura.co.nz",\n  "resource": "order_1257",\n  "warning": "delayed_preparation",\n  "changes": {\n    "status": "preparing"\n  }\n}'
    },
    {
      id: 'evt_09J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 27 * 60 * 1000), // 27 min ago
      severity: 'LOW' as const,
      user: USERS[3]!, // Emma Roberts
      action: { badge: 'CREATE' as const, description: 'Created new reservation' },
      resource: { name: 'Reservation', subtitle: '#RES-8891' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.45',
      device: 'Windows 11 • Chrome 129.0',
      sessionId: 'sess_09J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_09J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_09J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Reservation: Create',
      detailsJson: '{\n  "event": "reservation.created",\n  "actor": "emma.roberts@verdura.co.nz",\n  "resource": "reservation_8891",\n  "details": {\n    "customer": "John Smith",\n    "covers": 2,\n    "time": "18:00"\n  }\n}'
    },
    {
      id: 'evt_10J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      timestamp: new Date(baseDate.getTime() - 30 * 60 * 1000), // 30 min ago
      severity: 'LOW' as const,
      user: USERS[4]!, // David Lee
      action: { badge: 'UPDATE' as const, description: 'Updated venue details' },
      resource: { name: 'Venue', subtitle: 'Auckland Central' },
      venue: 'Auckland Central',
      outcome: 'Success' as const,
      ipAddress: '192.168.1.12',
      device: 'Windows 10 • Firefox 125.0',
      sessionId: 'sess_10J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      requestId: 'req_10J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      correlationId: 'cor_10J9Z3V8X8Y6K2QZ5T7Y1R9M2W',
      permissions: 'Venue: Write',
      detailsJson: '{\n  "event": "venue.details.updated",\n  "actor": "david.lee@verdura.co.nz",\n  "resource": "venue_auckland_central",\n  "changes": {\n    "phone": "+64 9 999 8888"\n  }\n}'
    }
  ];

  records.push(...screenshotRecords);

  // Generate 290 more records
  let currentTime = new Date(baseDate.getTime() - 35 * 60 * 1000);
  for (let i = 11; i <= 300; i++) {
    const minutesToSubtract = Math.floor(Math.random() * 80) + 10;
    currentTime = new Date(currentTime.getTime() - minutesToSubtract * 60 * 1000);

    const user = USERS[Math.floor(Math.random() * USERS.length)]!;
    const act = ACTIONS[Math.floor(Math.random() * ACTIONS.length)]!;
    const venue = VENUES[Math.floor(Math.random() * VENUES.length)]!;
    
    let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' = 'LOW';
    const randSev = Math.random();
    if (randSev < 0.04) severity = 'CRITICAL';
    else if (randSev < 0.12) severity = 'HIGH';
    else if (randSev < 0.32) severity = 'MEDIUM';
    else if (randSev < 0.75) severity = 'LOW';
    else severity = 'INFO';

    let outcome: 'Success' | 'Warning' | 'Failed' = 'Success';
    const randOut = Math.random();
    if (randOut < 0.06) outcome = 'Failed';
    else if (randOut < 0.12) outcome = 'Warning';

    const ip = IPS[Math.floor(Math.random() * IPS.length)]!;
    const device = DEVICES[Math.floor(Math.random() * DEVICES.length)]!;

    const randomHex = Math.random().toString(36).substring(2, 10).toUpperCase();
    const id = `evt_01J9Z3V8${randomHex}W`;
    const sessionId = `sess_01J9Z3V8${randomHex}W`;
    const requestId = `req_01J9Z3V8${randomHex}W`;
    const correlationId = `cor_01J9Z3V8${randomHex}W`;

    const permissions = severity === 'CRITICAL' 
      ? 'System: Admin, Database: Full' 
      : severity === 'HIGH'
      ? 'Menu: Write, User: Write'
      : 'Menu: Read, Order: Read';

    const detailsJson = JSON.stringify({
      event: act.description.toLowerCase().replace(/\s+/g, '.'),
      actor: user.name.toLowerCase().replace(/\s+/g, '.') + '@verdura.co.nz',
      resource: act.resSub.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      venue: venue,
      outcome: outcome.toLowerCase(),
      severity: severity.toLowerCase(),
      ip: ip,
      device: device
    }, null, 2);

    records.push({
      id,
      timestamp: new Date(currentTime),
      severity,
      user,
      action: { badge: act.badge, description: act.description },
      resource: { name: act.resName, subtitle: act.resSub },
      venue,
      outcome,
      ipAddress: ip,
      device,
      sessionId,
      requestId,
      correlationId,
      permissions,
      detailsJson
    });
  }

  return records;
}

const MOCK_DATASET = generateMockData();

// Helper to format Date into human-readable date & time
function formatDateTime(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // hour '0' should be '12'
  return `${month} ${day}, ${year} ${hours}:${minutes}:${seconds} ${ampm}`;
}

// Helper to format relative time
function formatRelativeTime(d: Date): string {
  const diffMs = new Date().getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / (60 * 1000));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

// ── Icons ────────────────────────────────────────────────────────────────────
const SvgIcons = {
  Immutable: () => (
    <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
    </svg>
  ),
  Secure: () => (
    <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.599-3.747A11.959 11.959 0 0112 5.714z" />
    </svg>
  ),
  Compliant: () => (
    <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.125 2.25h3.75a9 9 0 019 9v3.75a9 9 0 01-9 9h-3.75a9 9 0 01-9-9v-3.75a9 9 0 019-9zM9 12.75L11.25 15 15 9.75" />
    </svg>
  ),
  Graph: () => (
    <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" />
    </svg>
  ),
  ShieldAlert: () => (
    <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.599-3.747A11.959 11.959 0 0112 2.914zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  ),
  LockClosed: () => (
    <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  ),
  FolderExport: () => (
    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25" />
    </svg>
  ),
  Cog: () => (
    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.552 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.936 6.936 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.645-.869l.214-1.28z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Users: () => (
    <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.109A12.018 12.018 0 0112 21c-2.624 0-5.1-.845-7.035-2.285v-.079c0-1.114.285-2.16.786-3.07M11.666 15.418a11.952 11.952 0 00-6.864-1.81a4.125 4.125 0 00-7.533 2.493m18.662 0a4.87 4.87 0 00-2.285-2.25m-.086-4.128a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm-3 0a2.25 2.25 0 10-4.5 0 2.25 2.25 0 004.5 0z" />
    </svg>
  ),
  ChevronDown: ({ className = 'w-4.5 h-4.5' }: { className?: string }) => (
    <svg className={`${className} text-gray-400`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  ),
  Calendar: () => (
    <svg className="w-4 h-4 text-gray-400 mr-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  ),
  Filters: () => (
    <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
    </svg>
  ),
  Reset: () => (
    <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  ),
  Columns: () => (
    <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-12-15h18a2.25 2.25 0 012.25 2.25v13.5a2.25 2.25 0 01-2.25 2.25h-18a2.25 2.25 0 01-2.25-2.25V6.75a2.25 2.25 0 012.25-2.25z" />
    </svg>
  ),
  DensityList: () => (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  ),
  DensityGrid: () => (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  Expand: () => (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
    </svg>
  ),
  Cross: () => (
    <svg className="w-3 h-3 text-gray-400 hover:text-gray-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Export: () => (
    <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  ),
  Archive: () => (
    <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),
  Flag: () => (
    <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-6.005-1.248l-.316-.074a9 9 0 00-6 0l-.612.148A9 9 0 013 15.004V15z" />
    </svg>
  ),
  Investigate: () => (
    <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.637 10.637zM12 9.75v4.5m2.25-2.25h-4.5" />
    </svg>
  ),
  ShareLink: () => (
    <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  ),
  MoreActions: () => (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  ),
  Sort: () => (
    <svg className="w-3 h-3 text-gray-400 ml-1.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
    </svg>
  ),
  Details: () => (
    <svg className="w-4 h-4 text-gray-400 hover:text-emerald-600 cursor-pointer" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  ),
  FlagNewZealand: () => (
    <span className="inline-flex items-center text-xs font-normal text-gray-400 ml-1.5">
      🇳🇿
    </span>
  ),
  DeviceScreen: () => (
    <svg className="w-4 h-4 text-gray-400 mr-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12v10.5a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15.25V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
    </svg>
  )
};

export function AuditLogsPage() {
  // ── States ─────────────────────────────────────────────────────────────────
  const [data, setData] = useState<AuditRecord[]>(() => {
    try {
      const stored = localStorage.getItem('custom-audit-logs');
      if (stored) {
        const parsed = JSON.parse(stored);
        const custom = parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp)
        }));
        return [...custom, ...MOCK_DATASET];
      }
    } catch (e) {
      console.error(e);
    }
    return MOCK_DATASET;
  });
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem('custom-audit-logs');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.length > 0) return parsed[0].id;
      }
    } catch (e) {
      console.error(e);
    }
    return MOCK_DATASET[0]?.id || null;
  });
  
  // Tab within right panel drawer
  const [activeTab, setActiveTab] = useState<'Details' | 'Changes' | 'Metadata' | 'JSON'>('Details');

  // Search input state
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdown Open States
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Filters State
  const [savedView, setSavedView] = useState('All Events (Default)');
  const [dateRange, setDateRange] = useState('Last 7 Days');
  const [selectedVenue, setSelectedVenue] = useState('All Venues');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [selectedSeverity, setSelectedSeverity] = useState('All Severities');
  const [selectedOutcome, setSelectedOutcome] = useState('All Outcomes');
  const [selectedUser, setSelectedUser] = useState('All Users');

  // Table Config States
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    checkbox: true,
    timestamp: true,
    severity: true,
    user: true,
    action: true,
    resource: true,
    venue: true,
    outcome: true,
    ipAddress: true,
    details: true
  });
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Mock states for actions
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Toggle Dropdown helper
  const toggleDropdown = (name: string) => {
    setOpenDropdown(openDropdown === name ? null : name);
  };

  // Close all dropdowns helper
  const closeDropdowns = () => setOpenDropdown(null);

  // Reset Filters
  const handleReset = () => {
    setSavedView('All Events (Default)');
    setDateRange('Last 7 Days');
    setSelectedVenue('All Venues');
    setSelectedCategory('All Categories');
    setSelectedSeverity('All Severities');
    setSelectedOutcome('All Outcomes');
    setSelectedUser('All Users');
    setSearchQuery('');
    setCurrentPage(1);
    setSelectedRows({});
    closeDropdowns();
  };

  // Saved Views triggers
  const handleSelectSavedView = (view: string) => {
    setSavedView(view);
    if (view === 'Critical Actions') {
      setSelectedSeverity('CRITICAL');
      setSelectedOutcome('All Outcomes');
      setSelectedCategory('All Categories');
    } else if (view === 'Failed Logins') {
      setSelectedSeverity('All Severities');
      setSelectedOutcome('Failed');
      setSelectedCategory('LOGIN');
    } else if (view === 'System Configs') {
      setSelectedSeverity('All Severities');
      setSelectedOutcome('All Outcomes');
      setSelectedCategory('SYSTEM');
    } else {
      // Default
      setSelectedSeverity('All Severities');
      setSelectedOutcome('All Outcomes');
      setSelectedCategory('All Categories');
    }
    setCurrentPage(1);
    closeDropdowns();
  };

  // Mock Refresh action
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      // Shuffle timestamp of the top item slightly to simulate a new live log
      setData(prev => {
        const copy = [...prev];
        if (copy[0]) {
          copy[0] = {
            ...copy[0],
            timestamp: new Date()
          };
        }
        return copy;
      });
    }, 600);
  };

  // Filter & Search Logic
  const filteredData = useMemo(() => {
    return data.filter(record => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesQuery =
          record.id.toLowerCase().includes(q) ||
          record.user.name.toLowerCase().includes(q) ||
          record.user.role.toLowerCase().includes(q) ||
          record.action.description.toLowerCase().includes(q) ||
          record.resource.name.toLowerCase().includes(q) ||
          record.resource.subtitle.toLowerCase().includes(q) ||
          record.venue.toLowerCase().includes(q) ||
          record.ipAddress.toLowerCase().includes(q);
        if (!matchesQuery) return false;
      }

      // 2. Venue
      if (selectedVenue !== 'All Venues') {
        if (record.venue !== selectedVenue) return false;
      }

      // 3. Category (Mapped from action badge/action category)
      if (selectedCategory !== 'All Categories') {
        if (record.action.badge !== selectedCategory) return false;
      }

      // 4. Severity
      if (selectedSeverity !== 'All Severities') {
        if (record.severity !== selectedSeverity) return false;
      }

      // 5. Outcome
      if (selectedOutcome !== 'All Outcomes') {
        if (record.outcome !== selectedOutcome) return false;
      }

      // 6. User
      if (selectedUser !== 'All Users') {
        if (record.user.name !== selectedUser) return false;
      }

      // 7. Date range filter
      if (dateRange !== 'All Time') {
        const now = new Date();
        const diffMs = now.getTime() - record.timestamp.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (dateRange === 'Last 24 Hours' && diffDays > 1) return false;
        if (dateRange === 'Last 7 Days' && diffDays > 7) return false;
        if (dateRange === 'Last 30 Days' && diffDays > 30) return false;
      }

      return true;
    });
  }, [data, searchQuery, selectedVenue, selectedCategory, selectedSeverity, selectedOutcome, selectedUser, dateRange]);

  // Sorting Logic (Timestamp Descending)
  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [filteredData]);

  // Paginated Data
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedData.slice(startIndex, startIndex + rowsPerPage);
  }, [sortedData, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(sortedData.length / rowsPerPage) || 1;

  // Selected Record details
  const selectedRecord = useMemo(() => {
    return data.find(r => r.id === selectedRecordId) || null;
  }, [data, selectedRecordId]);

  // Select all rows on current page
  const allRowsOnPageSelected = useMemo(() => {
    if (paginatedData.length === 0) return false;
    return paginatedData.every(r => selectedRows[r.id]);
  }, [paginatedData, selectedRows]);

  const handleSelectAllToggle = () => {
    const newSelected = { ...selectedRows };
    if (allRowsOnPageSelected) {
      paginatedData.forEach(r => {
        delete newSelected[r.id];
      });
    } else {
      paginatedData.forEach(r => {
        newSelected[r.id] = true;
      });
    }
    setSelectedRows(newSelected);
  };

  const handleRowSelectToggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = { ...selectedRows };
    if (newSelected[id]) {
      delete newSelected[id];
    } else {
      newSelected[id] = true;
    }
    setSelectedRows(newSelected);
  };

  const totalSelectedCount = Object.keys(selectedRows).length;

  // Compute active chips based on filter state
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (dateRange !== 'All Time') {
      chips.push({
        key: 'date',
        label: `Date: ${dateRange}`,
        clear: () => setDateRange('All Time')
      });
    }
    if (selectedVenue !== 'All Venues') {
      chips.push({
        key: 'venue',
        label: `Venue: ${selectedVenue}`,
        clear: () => setSelectedVenue('All Venues')
      });
    }
    if (selectedCategory !== 'All Categories') {
      chips.push({
        key: 'category',
        label: `Category: ${selectedCategory}`,
        clear: () => setSelectedCategory('All Categories')
      });
    }
    if (selectedSeverity !== 'All Severities') {
      chips.push({
        key: 'severity',
        label: `Severity: ${selectedSeverity}`,
        clear: () => setSelectedSeverity('All Severities')
      });
    }
    if (selectedOutcome !== 'All Outcomes') {
      chips.push({
        key: 'outcome',
        label: `Outcome: ${selectedOutcome}`,
        clear: () => setSelectedOutcome('All Outcomes')
      });
    }
    if (selectedUser !== 'All Users') {
      chips.push({
        key: 'user',
        label: `User: ${selectedUser}`,
        clear: () => setSelectedUser('All Users')
      });
    }
    return chips;
  }, [dateRange, selectedVenue, selectedCategory, selectedSeverity, selectedOutcome, selectedUser]);

  // Statistics for KPI Cards (simulated metrics matching the screenshot)
  const stats = useMemo(() => {
    const totalToday = 1248;
    const criticalToday = 23;
    const failedLogins = 18;
    const exportsToday = 12;
    const configChanges = 36;
    const activeUsers = 56;
    return {
      totalToday,
      criticalToday,
      failedLogins,
      exportsToday,
      configChanges,
      activeUsers
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-50 text-gray-900 select-none overflow-hidden">
      
      {/* Scrollable container for main page content */}
      <div className="flex-1 flex flex-row overflow-hidden relative">
        
        {/* Left main area containing header, cards, filters, and table */}
        <div className="flex-1 flex flex-col p-6 overflow-y-auto min-w-0">
          
          {/* ── 1. HEADER ──────────────────────────────────────────────────────── */}
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-5 gap-3 shrink-0">
            <div>
              {/* Visual compliance badges */}
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase tracking-wide">
                  <SvgIcons.Immutable />
                  Immutable
                </span>
                <span className="inline-flex items-center text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase tracking-wide">
                  <SvgIcons.Secure />
                  Secure
                </span>
                <span className="inline-flex items-center text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase tracking-wide">
                  <SvgIcons.Compliant />
                  Compliant
                </span>
              </div>
            </div>
            
            {/* Search Input */}
            <div className="relative max-w-md w-full md:w-80">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-[14px] h-[14px] text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="search"
                placeholder="Search events, users, actions, resources, IPs..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full h-[34px] pl-9 pr-10 text-xs bg-white border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors shadow-sm"
              />
            </div>
          </div>

          {/* ── 2. KPI SUMMARY ROW ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5 mb-5 shrink-0">
            {/* Card 1 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm relative flex flex-col justify-between min-h-[96px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Events Today</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <SvgIcons.Graph />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-black text-gray-900 leading-none mb-1">
                  {stats.totalToday.toLocaleString()}
                </h3>
                <p className="text-[10px] text-gray-400 leading-none">
                  <span className="text-emerald-500 font-bold mr-1">↑ 12.5%</span> vs yesterday
                </p>
              </div>
            </div>

            {/* Card 2 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm relative flex flex-col justify-between min-h-[96px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Critical Events</span>
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                  <SvgIcons.ShieldAlert />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-black text-gray-900 leading-none mb-1">
                  {stats.criticalToday}
                </h3>
                <p className="text-[10px] text-gray-400 leading-none">
                  <span className="text-red-500 font-bold mr-1">↑ 35.3%</span> vs yesterday
                </p>
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm relative flex flex-col justify-between min-h-[96px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Failed Logins</span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <SvgIcons.LockClosed />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-black text-gray-900 leading-none mb-1">
                  {stats.failedLogins}
                </h3>
                <p className="text-[10px] text-gray-400 leading-none">
                  <span className="text-amber-500 font-bold mr-1">↑ 8.7%</span> vs yesterday
                </p>
              </div>
            </div>

            {/* Card 4 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm relative flex flex-col justify-between min-h-[96px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Data Exports</span>
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <SvgIcons.FolderExport />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-black text-gray-900 leading-none mb-1">
                  {stats.exportsToday}
                </h3>
                <p className="text-[10px] text-gray-400 leading-none">
                  <span className="text-blue-500 font-bold mr-1">↑ 9.1%</span> vs yesterday
                </p>
              </div>
            </div>

            {/* Card 5 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm relative flex flex-col justify-between min-h-[96px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Config Changes</span>
                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                  <SvgIcons.Cog />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-black text-gray-900 leading-none mb-1">
                  {stats.configChanges}
                </h3>
                <p className="text-[10px] text-gray-400 leading-none">
                  <span className="text-purple-500 font-bold mr-1">↑ 16.2%</span> vs yesterday
                </p>
              </div>
            </div>

            {/* Card 6 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm relative flex flex-col justify-between min-h-[96px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Active Users</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <SvgIcons.Users />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-black text-gray-900 leading-none mb-1">
                  {stats.activeUsers}
                </h3>
                <p className="text-[10px] text-gray-400 font-medium flex items-center gap-1.5 leading-none">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
                  Online now
                </p>
              </div>
            </div>
          </div>

          {/* ── 3. FILTER TOOLBAR ────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm mb-4 shrink-0 flex flex-wrap gap-2.5 items-center justify-between relative">
            <div className="flex flex-wrap gap-2 items-center">
              
              {/* Saved Views */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('savedView')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mr-0.5">Saved View:</span>
                  <span>{savedView}</span>
                  <SvgIcons.ChevronDown className="w-3.5 h-3.5" />
                </button>
                {openDropdown === 'savedView' && (
                  <div className="absolute left-0 mt-1.5 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-1">
                    {[
                      'All Events (Default)',
                      'Critical Actions',
                      'Failed Logins',
                      'System Configs'
                    ].map(v => (
                      <button
                        key={v}
                        onClick={() => handleSelectSavedView(v)}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          savedView === v ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Filters toggle count */}
              <button
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <SvgIcons.Filters />
                <span>Filters</span>
                <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center ml-0.5">
                  {activeChips.length}
                </span>
              </button>

              <div className="w-px h-5 bg-gray-200 mx-0.5" />

              {/* Date Range Picker */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('dateRange')}
                  className="flex items-center px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <SvgIcons.Calendar />
                  <span>{dateRange}</span>
                  <SvgIcons.ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                </button>
                {openDropdown === 'dateRange' && (
                  <div className="absolute left-0 mt-1.5 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-1">
                    {['Last 24 Hours', 'Last 7 Days', 'Last 30 Days', 'All Time'].map(d => (
                      <button
                        key={d}
                        onClick={() => {
                          setDateRange(d);
                          setCurrentPage(1);
                          closeDropdowns();
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          dateRange === d ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Venue Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('venue')}
                  className="flex items-center px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mr-1">Venue:</span>
                  <span>{selectedVenue}</span>
                  <SvgIcons.ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                </button>
                {openDropdown === 'venue' && (
                  <div className="absolute left-0 mt-1.5 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-1 max-h-60 overflow-y-auto">
                    <button
                      onClick={() => {
                        setSelectedVenue('All Venues');
                        setCurrentPage(1);
                        closeDropdowns();
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        selectedVenue === 'All Venues' ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                      }`}
                    >
                      All Venues
                    </button>
                    {VENUES.map(v => (
                      <button
                        key={v}
                        onClick={() => {
                          setSelectedVenue(v);
                          setCurrentPage(1);
                          closeDropdowns();
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          selectedVenue === v ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Category Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('category')}
                  className="flex items-center px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mr-1">Category:</span>
                  <span>{selectedCategory}</span>
                  <SvgIcons.ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                </button>
                {openDropdown === 'category' && (
                  <div className="absolute left-0 mt-1.5 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-1">
                    <button
                      onClick={() => {
                        setSelectedCategory('All Categories');
                        setCurrentPage(1);
                        closeDropdowns();
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        selectedCategory === 'All Categories' ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                      }`}
                    >
                      All Categories
                    </button>
                    {['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT', 'SYSTEM'].map(c => (
                      <button
                        key={c}
                        onClick={() => {
                          setSelectedCategory(c);
                          setCurrentPage(1);
                          closeDropdowns();
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          selectedCategory === c ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Severity Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('severity')}
                  className="flex items-center px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mr-1">Severity:</span>
                  <span>{selectedSeverity}</span>
                  <SvgIcons.ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                </button>
                {openDropdown === 'severity' && (
                  <div className="absolute left-0 mt-1.5 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-1">
                    <button
                      onClick={() => {
                        setSelectedSeverity('All Severities');
                        setCurrentPage(1);
                        closeDropdowns();
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        selectedSeverity === 'All Severities' ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                      }`}
                    >
                      All Severities
                    </button>
                    {SEVERITIES.map(s => (
                      <button
                        key={s}
                        onClick={() => {
                          setSelectedSeverity(s);
                          setCurrentPage(1);
                          closeDropdowns();
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          selectedSeverity === s ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Outcome Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('outcome')}
                  className="flex items-center px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mr-1">Outcome:</span>
                  <span>{selectedOutcome}</span>
                  <SvgIcons.ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                </button>
                {openDropdown === 'outcome' && (
                  <div className="absolute left-0 mt-1.5 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-1">
                    <button
                      onClick={() => {
                        setSelectedOutcome('All Outcomes');
                        setCurrentPage(1);
                        closeDropdowns();
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        selectedOutcome === 'All Outcomes' ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                      }`}
                    >
                      All Outcomes
                    </button>
                    {OUTCOMES.map(o => (
                      <button
                        key={o}
                        onClick={() => {
                          setSelectedOutcome(o);
                          setCurrentPage(1);
                          closeDropdowns();
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          selectedOutcome === o ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* User Dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('userFilter')}
                  className="flex items-center px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mr-1">User:</span>
                  <span>{selectedUser}</span>
                  <SvgIcons.ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                </button>
                {openDropdown === 'userFilter' && (
                  <div className="absolute left-0 mt-1.5 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-1">
                    <button
                      onClick={() => {
                        setSelectedUser('All Users');
                        setCurrentPage(1);
                        closeDropdowns();
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        selectedUser === 'All Users' ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                      }`}
                    >
                      All Users
                    </button>
                    {USERS.map(u => (
                      <button
                        key={u.name}
                        onClick={() => {
                          setSelectedUser(u.name);
                          setCurrentPage(1);
                          closeDropdowns();
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          selectedUser === u.name ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-gray-700'
                        }`}
                      >
                        {u.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* More Filters button */}
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <span>More Filters</span>
                <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center">3</span>
              </button>

            </div>

            {/* Right toolbar controls */}
            <div className="flex gap-2 items-center">
              
              {/* Reset button */}
              <button
                onClick={handleReset}
                className="flex items-center px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <SvgIcons.Reset />
                <span>Reset</span>
              </button>

              {/* Columns Visibility Selector */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('columns')}
                  className="flex items-center px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <SvgIcons.Columns />
                  <span>Columns</span>
                </button>
                {openDropdown === 'columns' && (
                  <div className="absolute right-0 mt-1.5 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-2 px-3 flex flex-col gap-1.5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Toggle Columns</p>
                    {Object.keys(visibleColumns).map(col => (
                      <label key={col} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={visibleColumns[col]}
                          onChange={(e) => {
                            setVisibleColumns(prev => ({
                              ...prev,
                              [col]: e.target.checked
                            }));
                          }}
                          className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5 border-gray-300"
                        />
                        <span className="capitalize">{col.replace(/([A-Z])/g, ' $1')}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Density and Refresh toolbar group */}
              <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                <button
                  onClick={() => setDensity('comfortable')}
                  className={`p-1 rounded ${density === 'comfortable' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'}`}
                  title="Comfortable Density"
                >
                  <SvgIcons.DensityList />
                </button>
                <button
                  onClick={() => setDensity('compact')}
                  className={`p-1 rounded ${density === 'compact' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'}`}
                  title="Compact Density"
                >
                  <SvgIcons.DensityGrid />
                </button>
              </div>

              {/* Refresh Event Logs Button */}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                title="Refresh log timeline"
              >
                <svg className={`w-3.5 h-3.5 text-gray-500 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>

              {/* Export dropdown */}
              <div className="relative">
                <button
                  onClick={() => toggleDropdown('export')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
                >
                  <span>Export</span>
                  <SvgIcons.ChevronDown className="w-3 h-3 text-white" />
                </button>
                {openDropdown === 'export' && (
                  <div className="absolute right-0 mt-1.5 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-25 py-1">
                    {['CSV Format', 'JSON Format', 'XLSX Spreadsheet', 'PDF Document'].map(f => (
                      <button
                        key={f}
                        onClick={() => {
                          alert(`Mocking export of ${sortedData.length} events as ${f}`);
                          closeDropdowns();
                        }}
                        className="w-full text-left px-3.5 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* ── 4. ACTIVE FILTER CHIPS ────────────────────────────────────────── */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4 shrink-0">
              {activeChips.map(chip => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 shadow-sm"
                >
                  <span>{chip.label}</span>
                  <button onClick={chip.clear} className="focus:outline-none">
                    <SvgIcons.Cross />
                  </button>
                </span>
              ))}
              
              {/* Clear all filter values */}
              <button
                onClick={handleReset}
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-1 py-0.5 ml-1 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}

          {/* ── 5. BULK ACTION BAR ────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-t-xl px-4 py-2.5 flex items-center justify-between shrink-0 shadow-sm relative">
            <div className="flex items-center gap-4">
              <input
                type="checkbox"
                checked={allRowsOnPageSelected}
                onChange={handleSelectAllToggle}
                className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 border-gray-300 cursor-pointer"
              />
              <span className="text-xs font-bold text-gray-600">
                {totalSelectedCount} selected
              </span>

              <div className="w-px h-4 bg-gray-200" />

              {/* Action Buttons (Disabled unless rows are checked) */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  disabled={totalSelectedCount === 0}
                  onClick={() => alert(`Archiving ${totalSelectedCount} logs`)}
                  className={`flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    totalSelectedCount > 0
                      ? 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200'
                      : 'text-gray-300 border border-gray-100 cursor-not-allowed'
                  }`}
                >
                  <SvgIcons.Export />
                  Export
                </button>
                <button
                  disabled={totalSelectedCount === 0}
                  onClick={() => alert(`Archiving ${totalSelectedCount} logs`)}
                  className={`flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    totalSelectedCount > 0
                      ? 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200'
                      : 'text-gray-300 border border-gray-100 cursor-not-allowed'
                  }`}
                >
                  <SvgIcons.Archive />
                  Archive
                </button>
                <button
                  disabled={totalSelectedCount === 0}
                  onClick={() => alert(`Flagging ${totalSelectedCount} logs`)}
                  className={`flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    totalSelectedCount > 0
                      ? 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200'
                      : 'text-gray-300 border border-gray-100 cursor-not-allowed'
                  }`}
                >
                  <SvgIcons.Flag />
                  Flag
                </button>
                <button
                  disabled={totalSelectedCount === 0}
                  onClick={() => alert(`Investigating ${totalSelectedCount} logs`)}
                  className={`flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    totalSelectedCount > 0
                      ? 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200'
                      : 'text-gray-300 border border-gray-100 cursor-not-allowed'
                  }`}
                >
                  <SvgIcons.Investigate />
                  Investigate
                </button>
                <button
                  disabled={totalSelectedCount === 0}
                  onClick={() => {
                    const links = Object.keys(selectedRows).map(id => `http://localhost:5176/audit?evt=${id}`).join('\n');
                    navigator.clipboard.writeText(links);
                    alert('Links copied to clipboard!');
                  }}
                  className={`flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    totalSelectedCount > 0
                      ? 'text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200'
                      : 'text-gray-300 border border-gray-100 cursor-not-allowed'
                  }`}
                >
                  <SvgIcons.ShareLink />
                  Share Link
                </button>
              </div>
            </div>

            <button className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
              <SvgIcons.MoreActions />
            </button>
          </div>

          {/* ── 6. AUDIT TABLE ────────────────────────────────────────────────── */}
          <div className="bg-white border-x border-b border-gray-200 rounded-b-xl overflow-x-auto shadow-sm relative flex-1 min-h-[400px]">
            <table className="w-full text-left border-collapse table-fixed min-w-[1000px]">
              
              {/* Sticky header */}
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                <tr>
                  {visibleColumns.checkbox && (
                    <th className="w-12 px-4 py-3 text-center">
                      {/* Checkbox already handled in bulk action bar */}
                    </th>
                  )}
                  {visibleColumns.timestamp && <th className="w-48 px-4 py-3">Timestamp <SvgIcons.Sort /></th>}
                  {visibleColumns.severity && <th className="w-28 px-4 py-3">Severity</th>}
                  {visibleColumns.user && <th className="w-48 px-4 py-3">User</th>}
                  {visibleColumns.action && <th className="w-56 px-4 py-3">Action</th>}
                  {visibleColumns.resource && <th className="w-48 px-4 py-3">Resource</th>}
                  {visibleColumns.venue && <th className="w-36 px-4 py-3">Venue</th>}
                  {visibleColumns.outcome && <th className="w-28 px-4 py-3">Outcome</th>}
                  {visibleColumns.ipAddress && <th className="w-32 px-4 py-3">IP Address</th>}
                  {visibleColumns.details && <th className="w-20 px-4 py-3 text-center">Details</th>}
                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-gray-200 text-xs">
                {paginatedData.length > 0 ? (
                  paginatedData.map(record => {
                    const isSelected = selectedRows[record.id] || false;
                    const isDrawerSelected = selectedRecordId === record.id;
                    const rowHeightPadding = density === 'compact' ? 'py-1.5' : 'py-3';
                    
                    return (
                      <tr
                        key={record.id}
                        onClick={() => setSelectedRecordId(record.id)}
                        className={`hover:bg-gray-50/70 transition-colors cursor-pointer select-none ${
                          isDrawerSelected ? 'bg-emerald-50/30' : isSelected ? 'bg-gray-50/50' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        {visibleColumns.checkbox && (
                          <td className="px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => handleRowSelectToggle(record.id, e as any)}
                              className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5 border-gray-300 cursor-pointer"
                            />
                          </td>
                        )}

                        {/* Timestamp */}
                        {visibleColumns.timestamp && (
                          <td className={`px-4 ${rowHeightPadding}`}>
                            <p className="font-semibold text-gray-900 leading-tight">
                              {formatDateTime(record.timestamp)}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-0.5 leading-none">
                              {formatRelativeTime(record.timestamp)}
                            </p>
                          </td>
                        )}

                        {/* Severity Badge */}
                        {visibleColumns.severity && (
                          <td className="px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                                record.severity === 'CRITICAL'
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : record.severity === 'HIGH'
                                  ? 'bg-orange-50 text-orange-700 border-orange-200'
                                  : record.severity === 'MEDIUM'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : record.severity === 'LOW'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-gray-50 text-gray-700 border-gray-200'
                              }`}
                            >
                              {record.severity}
                            </span>
                          </td>
                        )}

                        {/* User with avatar & role */}
                        {visibleColumns.user && (
                          <td className="px-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${record.user.avatarColor}`}>
                                {record.user.initials}
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-900 truncate leading-tight">
                                  {record.user.name}
                                </p>
                                <p className="text-[10px] text-gray-400 truncate leading-none mt-0.5">
                                  {record.user.role}
                                </p>
                              </div>
                            </div>
                          </td>
                        )}

                        {/* Action badge & description */}
                        {visibleColumns.action && (
                          <td className="px-4">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-[9px] font-bold text-gray-500 uppercase tracking-wide">
                                {record.action.badge}
                              </span>
                              <span className="font-semibold text-gray-700 truncate">
                                {record.action.description}
                              </span>
                            </div>
                          </td>
                        )}

                        {/* Resource */}
                        {visibleColumns.resource && (
                          <td className="px-4">
                            <p className="font-semibold text-gray-900 leading-tight truncate">
                              {record.resource.name}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate leading-none mt-0.5">
                              {record.resource.subtitle}
                            </p>
                          </td>
                        )}

                        {/* Venue */}
                        {visibleColumns.venue && (
                          <td className="px-4 font-semibold text-gray-700 truncate">
                            {record.venue}
                          </td>
                        )}

                        {/* Outcome status badge */}
                        {visibleColumns.outcome && (
                          <td className="px-4">
                            <span className="inline-flex items-center gap-1.5 font-bold">
                              {record.outcome === 'Success' ? (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span className="text-emerald-700 text-xs">Success</span>
                                </>
                              ) : record.outcome === 'Warning' ? (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  <span className="text-amber-700 text-xs">Warning</span>
                                </>
                              ) : (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  <span className="text-red-700 text-xs">Failed</span>
                                </>
                              )}
                            </span>
                          </td>
                        )}

                        {/* IP Address */}
                        {visibleColumns.ipAddress && (
                          <td className="px-4 font-mono font-medium text-gray-600">
                            {record.ipAddress}
                          </td>
                        )}

                        {/* Details View trigger */}
                        {visibleColumns.details && (
                          <td className="px-4 text-center" onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRecordId(record.id);
                          }}>
                            <div className="flex justify-center">
                              <SvgIcons.Details />
                            </div>
                          </td>
                        )}

                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="text-center py-16 text-gray-500 font-semibold bg-gray-50/30">
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.637 10.637z" />
                        </svg>
                      </div>
                      <p className="text-sm font-bold text-gray-700">No events matched your filters</p>
                      <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">Try resetting active filter chips or modify search query.</p>
                      <button
                        onClick={handleReset}
                        className="mt-4 inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold shadow-sm transition-colors"
                      >
                        Reset All Filters
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── 7. PAGINATION ────────────────────────────────────────────────── */}
          <div className="bg-white border-x border-b border-gray-200 rounded-b-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Rows per page</span>
              <div className="relative">
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-xs font-bold text-gray-700 outline-none cursor-pointer focus:border-emerald-500"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            {/* Pagination Range & Page selection */}
            <div className="flex items-center gap-4">
              <span className="text-xs font-bold text-gray-500">
                {(currentPage - 1) * rowsPerPage + 1} - {Math.min(currentPage * rowsPerPage, sortedData.length)} of {sortedData.length.toLocaleString()}
              </span>

              <div className="flex items-center gap-1">
                {/* Previous Page */}
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  className={`p-1.5 rounded-lg border text-gray-500 transition-colors ${
                    currentPage === 1
                      ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>

                {/* Page Number 1 */}
                <button
                  onClick={() => setCurrentPage(1)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                    currentPage === 1
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-600 font-bold'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  1
                </button>

                {totalPages > 1 && (
                  <button
                    onClick={() => setCurrentPage(2)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                      currentPage === 2
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-600 font-bold'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    2
                  </button>
                )}

                {totalPages > 2 && (
                  <button
                    onClick={() => setCurrentPage(3)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                      currentPage === 3
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-600 font-bold'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    3
                  </button>
                )}

                {totalPages > 4 && <span className="text-gray-400 text-xs px-1">...</span>}

                {totalPages > 3 && (
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                      currentPage === totalPages
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-600 font-bold'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {totalPages}
                  </button>
                )}

                {/* Next Page */}
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  className={`p-1.5 rounded-lg border text-gray-500 transition-colors ${
                    currentPage === totalPages
                      ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="h-6" /> {/* Spacing bottom */}
        </div>

        {/* ── 8. RIGHT SIDE DETAILS PANEL ───────────────────────────────────── */}
        {selectedRecord && (
          <aside className="w-[420px] bg-white border-l border-gray-200 flex flex-col shrink-0 h-full overflow-hidden shadow-lg sticky right-0 z-20">
            
            {/* Panel Drawer Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-gray-50/50">
              <div className="flex items-center gap-2.5 min-w-0">
                <h3 className="font-bold text-gray-900 truncate text-sm">
                  {selectedRecord.action.description}
                </h3>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border shrink-0 ${
                    selectedRecord.severity === 'CRITICAL'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : selectedRecord.severity === 'HIGH'
                      ? 'bg-orange-50 text-orange-700 border-orange-200'
                      : selectedRecord.severity === 'MEDIUM'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : selectedRecord.severity === 'LOW'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-gray-50 text-gray-700 border-gray-200'
                  }`}
                >
                  {selectedRecord.severity}
                </span>
              </div>
              <button
                onClick={() => setSelectedRecordId(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <SvgIcons.Cross />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 shrink-0 text-xs">
              {(['Details', 'Changes', 'Metadata', 'JSON'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 text-center py-2.5 font-bold transition-all relative ${
                    activeTab === tab
                      ? 'text-emerald-600 font-extrabold'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50/50'
                  }`}
                >
                  {tab}
                  {activeTab === tab && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-600" />
                  )}
                </button>
              ))}
            </div>

            {/* Panel Tab Content Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeTab === 'Details' && (
                <div className="space-y-3.5 text-xs">
                  {/* Event ID */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 6h15" />
                      </svg>
                      Event ID
                    </span>
                    <span className="font-mono text-gray-800 break-all select-all font-medium text-right max-w-[200px]">
                      {selectedRecord.id}
                    </span>
                  </div>

                  {/* Timestamp */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Timestamp
                    </span>
                    <span className="text-gray-800 font-medium text-right leading-tight max-w-[200px]">
                      {formatDateTime(selectedRecord.timestamp)} (NZST)
                    </span>
                  </div>

                  {/* User */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                      </svg>
                      User
                    </span>
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${selectedRecord.user.avatarColor}`}>
                        {selectedRecord.user.initials}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-800 leading-tight">{selectedRecord.user.name}</p>
                        <p className="text-[10px] text-gray-400 leading-none mt-0.5">{selectedRecord.user.role}</p>
                      </div>
                    </div>
                  </div>

                  {/* Venue */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72M6.75 18h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .414.336.75.75.75z" />
                      </svg>
                      Venue
                    </span>
                    <span className="text-gray-800 font-semibold text-right">
                      {selectedRecord.venue}
                    </span>
                  </div>

                  {/* IP Address */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-.778.099-1.533.284-2.253" />
                      </svg>
                      IP Address
                    </span>
                    <span className="font-mono text-gray-800 font-medium text-right flex items-center">
                      {selectedRecord.ipAddress}
                      <SvgIcons.FlagNewZealand />
                    </span>
                  </div>

                  {/* Device */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                      </svg>
                      Device
                    </span>
                    <span className="text-gray-800 font-medium text-right leading-tight max-w-[200px]">
                      {selectedRecord.device}
                    </span>
                  </div>

                  {/* Action */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                      </svg>
                      Action
                    </span>
                    <div className="text-right">
                      <span className="inline-flex px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-[9px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                        {selectedRecord.action.badge}
                      </span>
                      <p className="font-semibold text-gray-800">{selectedRecord.action.description}</p>
                    </div>
                  </div>

                  {/* Resource */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                      </svg>
                      Resource
                    </span>
                    <div className="text-right">
                      <p className="font-semibold text-gray-800">{selectedRecord.resource.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-medium leading-normal break-all max-w-[200px]">{selectedRecord.resource.subtitle}</p>
                    </div>
                  </div>

                  {/* Outcome */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      <svg className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Outcome
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-bold">
                      {selectedRecord.outcome === 'Success' ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span className="text-emerald-700 text-xs">Success</span>
                        </>
                      ) : selectedRecord.outcome === 'Warning' ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <span className="text-amber-700 text-xs">Warning</span>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          <span className="text-red-700 text-xs">Failed</span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Session ID */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      Session ID
                    </span>
                    <span className="font-mono text-gray-500 break-all text-right max-w-[200px]">
                      {selectedRecord.sessionId}
                    </span>
                  </div>

                  {/* Request ID */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      Request ID
                    </span>
                    <span className="font-mono text-gray-500 break-all text-right max-w-[200px]">
                      {selectedRecord.requestId}
                    </span>
                  </div>

                  {/* Correlation ID */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      Correlation ID
                    </span>
                    <span className="font-mono text-gray-500 break-all text-right max-w-[200px]">
                      {selectedRecord.correlationId}
                    </span>
                  </div>

                  {/* User Role */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      User Role
                    </span>
                    <span className="text-gray-800 font-semibold text-right">
                      {selectedRecord.user.role}
                    </span>
                  </div>

                  {/* Permissions */}
                  <div className="flex justify-between items-start border-b border-gray-100 pb-2">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      Permissions
                    </span>
                    <span className="text-gray-700 font-medium text-right leading-tight max-w-[200px]">
                      {selectedRecord.permissions}
                    </span>
                  </div>

                  {/* Related Events */}
                  <div className="flex justify-between items-start">
                    <span className="text-gray-400 font-medium leading-normal flex items-center">
                      Related Events
                    </span>
                    <span className="text-gray-700 font-medium text-right">
                      2 events <button className="text-emerald-600 hover:text-emerald-700 font-bold ml-1 transition-colors">View</button>
                    </span>
                  </div>
                </div>
              )}

              {activeTab === 'Changes' && (
                <div className="text-xs space-y-4">
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between border-b border-gray-200 pb-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      <span>Field</span>
                      <span>Value Changes</span>
                    </div>
                    
                    {selectedRecord.action.badge === 'CREATE' ? (
                      <div className="space-y-1.5 font-mono">
                        <div className="flex justify-between">
                          <span className="text-gray-500">name</span>
                          <span className="text-emerald-600 font-medium bg-emerald-50 px-1 rounded">+ "{selectedRecord.resource.subtitle}"</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">status</span>
                          <span className="text-emerald-600 font-medium bg-emerald-50 px-1 rounded">+ "active"</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">created_at</span>
                          <span className="text-emerald-600 font-medium bg-emerald-50 px-1 rounded">+ TIMESTAMP</span>
                        </div>
                      </div>
                    ) : selectedRecord.action.badge === 'UPDATE' ? (
                      <div className="space-y-1.5 font-mono">
                        <div className="flex justify-between">
                          <span className="text-gray-500">updated_fields</span>
                          <span className="text-amber-600 bg-amber-50 px-1 rounded font-medium">["status", "modified_by"]</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">status</span>
                          <span className="text-gray-400 line-through">"pending"</span>
                          <span className="text-emerald-600 font-medium bg-emerald-50 px-1 rounded">→ "updated"</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1 text-gray-400 font-medium">
                        No direct state modifications captured for this activity type.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'Metadata' && (
                <div className="text-xs space-y-3 font-mono text-gray-600">
                  <div className="flex justify-between border-b border-gray-100 pb-1.5">
                    <span className="text-gray-400">client_user_agent</span>
                    <span className="text-gray-800 text-right">Mozilla/5.0</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-1.5">
                    <span className="text-gray-400">browser_engine</span>
                    <span className="text-gray-800">Blink / V8</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-1.5">
                    <span className="text-gray-400">compliance_governance</span>
                    <span className="text-gray-800">SOX-compliant</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">encryption_cipher</span>
                    <span className="text-gray-800">AES-256-GCM</span>
                  </div>
                </div>
              )}

              {activeTab === 'JSON' && (
                <div className="space-y-2">
                  <pre className="bg-gray-900 text-emerald-400 rounded-lg p-3 text-[11px] font-mono overflow-x-auto leading-relaxed shadow-inner max-h-[350px]">
                    <code>{selectedRecord.detailsJson}</code>
                  </pre>
                </div>
              )}
            </div>

            {/* Quick Actions Footer inside Drawer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50/50 space-y-2 shrink-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Quick Actions</p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => alert(`Investigating Event ${selectedRecord.id}`)}
                  className="flex flex-col items-center justify-center py-2 px-1 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold gap-1 transition-all"
                >
                  <SvgIcons.Investigate />
                  <span>Investigate</span>
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`http://localhost:5176/audit?evt=${selectedRecord.id}`);
                    alert('Share link copied to clipboard!');
                  }}
                  className="flex flex-col items-center justify-center py-2 px-1 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold gap-1 transition-all"
                >
                  <SvgIcons.ShareLink />
                  <span>Share Link</span>
                </button>
                <button
                  onClick={() => {
                    alert(`Exporting Event ${selectedRecord.id} details JSON`);
                  }}
                  className="flex flex-col items-center justify-center py-2 px-1 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold gap-1 transition-all"
                >
                  <SvgIcons.Export />
                  <span>Export Event</span>
                </button>
              </div>
            </div>

          </aside>
        )}

      </div>

      {/* ── 9. FOOTER STATUS BAR ──────────────────────────────────────────── */}
      <footer className="bg-white border-t border-gray-200 px-5 py-2.5 flex flex-wrap items-center justify-between text-[11px] font-semibold text-gray-500 shadow-sm shrink-0 select-none">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <strong>{sortedData.length.toLocaleString()}</strong> events
          </span>
          <span className="text-gray-300">|</span>
          <span className="flex items-center text-emerald-600 font-bold">
            <SvgIcons.Immutable />
            100% verified
          </span>
          <span className="text-gray-300">|</span>
          <span className="flex items-center text-emerald-600 font-bold">
            <SvgIcons.Secure />
            Immutable
          </span>
          <span className="text-gray-300">|</span>
          <span className="flex items-center text-gray-500">
            Retention: 7 years
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1 sm:mt-0 font-bold text-gray-600">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          <span>PostgreSQL WAL Synced</span>
        </div>
      </footer>

    </div>
  );
}

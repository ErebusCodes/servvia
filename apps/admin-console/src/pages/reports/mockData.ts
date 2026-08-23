import { FilterState, UserRole } from './types';

// Baseline constant records
export const VENUES = [
  { id: 'all', name: 'All Venues' },
  { id: 'verdura', name: 'Verdura — Downtown' },
  { id: 'v2', name: 'Verdura — Marina' },
  { id: 'v3', name: 'Verdura — Airport' },
];

export const SERVICE_TYPES = [
  { id: 'all', name: 'All Services' },
  { id: 'dinein', name: 'Dine-in' },
  { id: 'takeaway', name: 'Take Away' },
];

export const CHANNELS = [
  { id: 'all', name: 'All Channels' },
  { id: 'pos', name: 'POS Terminal' },
  { id: 'kiosk', name: 'Kiosk Window' },
  { id: 'tablet', name: 'Order Tablet' },
  { id: 'delivery_app', name: 'Delivery Platform' },
];

// Helper to mask currency if role lacks permissions
export function formatValueForRole(val: string | number, role: UserRole, isCurrency = false): string {
  if (role === 'kitchen' || role === 'staff') {
    if (isCurrency) return '— (Restricted)';
  }
  if (typeof val === 'number') {
    return isCurrency ? '$' + val.toLocaleString('en-US') : val.toLocaleString('en-US');
  }
  return val;
}

// Generate base metrics that respond dynamically to filters
export function getReportData(filters: FilterState, role: UserRole) {
  // Deterministic seed from filter properties
  const seed = (filters.venue.length * 3) + (filters.service.length * 7) + (filters.dateRange.length * 2);
  
  // Scale factor based on Date Range
  let scale = 1.0;
  if (filters.dateRange === 'today') scale = 0.15;
  else if (filters.dateRange === 'yesterday') scale = 0.14;
  else if (filters.dateRange === 'last30') scale = 4.2;
  else if (filters.dateRange === 'custom') scale = 1.5;
  
  // Scale factor based on Venue
  let venueScale = 1.0;
  if (filters.venue === 'verdura') venueScale = 0.55;
  else if (filters.venue === 'v2') venueScale = 0.30;
  else if (filters.venue === 'v3') venueScale = 0.15;

  const mult = scale * venueScale;

  // Filter effect modifier
  let filterModifier = 1.0;
  if (filters.searchQuery) {
    filterModifier = 0.45;
  }
  if (filters.menuItem !== 'all') {
    filterModifier *= 0.15;
  }

  const fMult = mult * filterModifier;

  // 1. Sales Tab Data
  const rawSales = Math.round(24580 * fMult);
  const rawNet = Math.round(21940 * fMult);
  const rawOrders = Math.max(1, Math.round(412 * fMult));
  const rawCovers = Math.max(1, Math.round(968 * fMult));
  const aov = rawOrders > 0 ? (rawSales / rawOrders) : 59.66;

  const salesKpis = [
    { label: 'Total Sales', value: formatValueForRole(rawSales, role, true), delta: '+9.4%', trend: 'up', icon: 'dollar', hint: 'vs. ' + formatValueForRole(Math.round(rawSales * 0.91), role, true) + ' prev.' },
    { label: 'Net Sales', value: formatValueForRole(rawNet, role, true), delta: '+8.1%', trend: 'up', icon: 'receipt', hint: 'After tax & discounts' },
    { label: 'Orders', value: rawOrders.toString(), delta: '+' + Math.round(rawOrders * 0.09), trend: 'up', icon: 'bag', hint: 'Completed checkout' },
    { label: 'Average Order Value', value: formatValueForRole(aov.toFixed(2), role, true), delta: '+2.3%', trend: 'up', icon: 'trend', hint: 'Normalized ticket average' },
    { label: 'Covers', value: rawCovers.toString(), delta: '+' + Math.round(rawCovers * 0.04), trend: 'up', icon: 'users', hint: (rawCovers / rawOrders).toFixed(1) + ' covers / order' },
    { label: 'Top Selling Item', value: 'Grilled Halloumi', delta: Math.round(142 * fMult) + ' sold', trend: 'flat', icon: 'star', hint: formatValueForRole(Math.round(2840 * fMult), role, true) + ' in sales' },
  ];

  const salesTrend = [
    { l: 'Mon', v: Math.round(18.2 * fMult * 10) / 10 },
    { l: 'Tue', v: Math.round(20.4 * fMult * 10) / 10 },
    { l: 'Wed', v: Math.round(17.6 * fMult * 10) / 10 },
    { l: 'Thu', v: Math.round(22.1 * fMult * 10) / 10 },
    { l: 'Fri', v: Math.round(28.9 * fMult * 10) / 10 },
    { l: 'Sat', v: Math.round(31.4 * fMult * 10) / 10 },
    { l: 'Sun', v: Math.round(24.8 * fMult * 10) / 10 },
  ];

  const salesByService = [
    { l: 'Dine-in', v: Math.round(13420 * fMult), c: 'var(--chart-1)' },
    { l: 'Delivery', v: Math.round(5680 * fMult), c: 'var(--chart-4)' },
    { l: 'Pickup', v: Math.round(2840 * fMult), c: 'var(--chart-2)' },
  ];

  const rawHourlySales = [820, 1640, 2480, 1920, 980, 760, 1180, 2240, 3120, 3680, 2960, 1840].map(v => Math.round(v * fMult));
  const salesByHour = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'].map((hh, i) => ({
    l: hh,
    v: rawHourlySales[i] || 0
  }));

  const topMenuItems = [
    { l: 'Grilled Halloumi', v: Math.round(2840 * fMult), sub: Math.round(142 * fMult).toString(), c: 'var(--chart-1)' },
    { l: 'Lamb Shawarma', v: Math.round(2360 * fMult), sub: Math.round(118 * fMult).toString(), c: 'var(--chart-1)' },
    { l: 'Mixed Grill Platter', v: Math.round(2180 * fMult), sub: Math.round(64 * fMult).toString(), c: 'var(--chart-1)' },
    { l: 'Margherita Pizza', v: Math.round(1640 * fMult), sub: Math.round(96 * fMult).toString(), c: 'var(--chart-1)' },
    { l: 'Hummus Bowl', v: Math.round(1180 * fMult), sub: Math.round(134 * fMult).toString(), c: 'var(--chart-1)' },
  ];

  const salesByCategory = [
    { l: 'Mains', v: Math.round(9840 * fMult), c: 'var(--chart-1)' },
    { l: 'Pizza & Oven', v: Math.round(3620 * fMult), c: 'var(--chart-2)' },
    { l: 'Starters', v: Math.round(2980 * fMult), c: 'var(--chart-3)' },
    { l: 'Beverages', v: Math.round(2140 * fMult), c: 'var(--chart-4)' },
    { l: 'Desserts', v: Math.round(1840 * fMult), c: 'var(--chart-5)' },
    { l: 'Sides', v: Math.round(1520 * fMult), c: 'var(--gray-400)' },
  ];

  // 2. Kitchen Tab Data
  const basePrep = 12.8;
  const kitchenKpis = [
    { label: 'Average Prep Time', value: '12:48', delta: '−0:42', trend: 'down', positiveIsGood: true, icon: 'clock', hint: 'Target: 15:00' },
    { label: 'SLA Compliance', value: '91%', delta: '+3%', trend: 'up', icon: 'check', hint: 'Goal: >90% compliant' },
    { label: 'Delayed Orders', value: Math.max(0, Math.round(23 * fMult)).toString(), delta: '−6', trend: 'down', positiveIsGood: true, icon: 'alert', hint: 'SLA breach tickets' },
    { label: 'Fastest Station', value: 'Cold & Salad', delta: '5:06 avg', trend: 'flat', icon: 'zap', hint: 'Shortest prep cycle' },
    { label: 'Slowest Station', value: 'Pizza & Oven', delta: '16:48 avg', trend: 'flat', icon: 'flame', hint: 'High volume choke-point' },
    { label: 'Orders Completed', value: Math.max(0, Math.round(389 * fMult)).toString(), delta: '+34', trend: 'up', icon: 'checkCircle', hint: 'Completed ticket count' },
  ];

  const prepTimeByStation = [
    { l: 'Grill', v: 14.2 },
    { l: 'Fry', v: 9.6 },
    { l: 'Cold & Salad', v: 5.1 },
    { l: 'Pizza & Oven', v: 16.8 },
    { l: 'Main Kitchen', v: 12.4 },
    { l: 'Dessert', v: 7.3 },
  ];

  const delayedByStation = [
    { l: 'Pizza & Oven', v: Math.max(0, Math.round(9 * fMult)), c: 'var(--color-danger)' },
    { l: 'Grill', v: Math.max(0, Math.round(6 * fMult)), c: 'var(--color-warning)' },
    { l: 'Main Kitchen', v: Math.max(0, Math.round(4 * fMult)), c: 'var(--color-warning)' },
    { l: 'Fry', v: Math.max(0, Math.round(2 * fMult)), c: 'var(--color-primary)' },
    { l: 'Dessert', v: Math.max(0, Math.round(1 * fMult)), c: 'var(--color-primary)' },
    { l: 'Cold & Salad', v: Math.max(0, Math.round(1 * fMult)), c: 'var(--color-primary)' },
  ];

  const ticketTimeByHour = [
    { l: '11', v: 9.8 },
    { l: '13', v: 11.2 },
    { l: '15', v: 8.4 },
    { l: '17', v: 10.6 },
    { l: '19', v: 14.8 },
    { l: '21', v: 16.2 },
    { l: '22', v: 12.1 },
  ];

  const topDelayedItems = [
    { id: 1, item: 'Pizza Margherita', station: 'Pizza & Oven', count: Math.max(0, Math.round(14 * fMult)), avg: '4:20' },
    { id: 2, item: 'Mixed Grill Platter', station: 'Grill', count: Math.max(0, Math.round(11 * fMult)), avg: '3:50' },
    { id: 3, item: 'Lamb Shawarma', station: 'Main Kitchen', count: Math.max(0, Math.round(7 * fMult)), avg: '2:40' },
    { id: 4, item: 'Calzone', station: 'Pizza & Oven', count: Math.max(0, Math.round(5 * fMult)), avg: '5:10' },
    { id: 5, item: 'Chicken Wings', station: 'Fry', count: Math.max(0, Math.round(3 * fMult)), avg: '1:55' },
  ];

  const stationThroughput = [
    { l: 'Main Kitchen', v: Math.max(1, Math.round(38 * fMult)), c: 'var(--chart-1)' },
    { l: 'Grill', v: Math.max(1, Math.round(32 * fMult)), c: 'var(--chart-1)' },
    { l: 'Cold & Salad', v: Math.max(1, Math.round(28 * fMult)), c: 'var(--chart-1)' },
    { l: 'Fry', v: Math.max(1, Math.round(24 * fMult)), c: 'var(--chart-1)' },
    { l: 'Pizza & Oven', v: Math.max(1, Math.round(19 * fMult)), c: 'var(--chart-1)' },
    { l: 'Dessert', v: Math.max(1, Math.round(14 * fMult)), c: 'var(--chart-1)' },
  ];

  // 3. Operations Tab Data
  const opsKpis = [
    { label: 'Total Orders', value: rawOrders.toString(), delta: '+' + Math.round(rawOrders * 0.09), trend: 'up', icon: 'bag', hint: 'Order count' },
    { label: 'Completed Orders', value: Math.max(0, Math.round(389 * fMult)).toString(), delta: '+34', trend: 'up', icon: 'checkCircle', hint: 'Fulfilled orders' },
    { label: 'Cancelled Orders', value: Math.max(0, Math.round(23 * fMult)).toString(), delta: '−4', trend: 'down', positiveIsGood: true, icon: 'xCircle', hint: 'Void/refunded orders' },
    { label: 'Completion Rate', value: '94.4%', delta: '+1.2%', trend: 'up', icon: 'percent', hint: 'Target: >93%' },
    { label: 'Peak Hour', value: '20:00', delta: Math.max(1, Math.round(61 * fMult)) + ' orders', trend: 'flat', icon: 'clock', hint: 'Highest concentration' },
    { label: 'Avg Fulfillment Time', value: '18:20', delta: '−1:10', trend: 'down', positiveIsGood: true, icon: 'timer', hint: 'Order entry to release' },
  ];

  const rawHourlyOrders = [14, 28, 42, 33, 18, 13, 21, 38, 52, 61, 49, 31].map(v => Math.round(v * fMult));
  const ordersByHour = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'].map((hh, i) => ({
    l: hh,
    v: rawHourlyOrders[i] || 0
  }));

  const ordersByType = [
    { l: 'Dine-in (T)', v: Math.round(248 * fMult), c: 'var(--chart-1)' },
    { l: 'Take Away (TA)', v: Math.round(164 * fMult), c: 'var(--chart-2)' },
    { l: 'Delivery (DEL)', v: Math.round(98 * fMult), c: 'var(--chart-4)' },
    { l: 'Pickup (PUP)', v: Math.round(66 * fMult), c: 'var(--chart-3)' },
  ];

  const ordersByStatus = [
    { l: 'Completed', v: Math.round(389 * fMult), c: 'var(--color-success)' },
    { l: 'Preparing', v: Math.round(31 * fMult), c: 'var(--color-warning)' },
    { l: 'Cancelled', v: Math.round(23 * fMult), c: 'var(--color-danger)' },
    { l: 'Ready', v: Math.round(18 * fMult), c: 'var(--chart-1)' },
    { l: 'New', v: Math.round(9 * fMult), c: 'var(--color-info)' },
  ];

  const splitDineInTakeAway = {
    a: { l: 'Dine-in', v: Math.round(248 * fMult), c: 'var(--chart-1)' },
    b: { l: 'Take Away', v: Math.round(164 * fMult), c: 'var(--chart-2)' }
  };

  const splitDeliveryPickup = {
    a: { l: 'Delivery', v: Math.round(98 * fMult), c: 'var(--chart-4)' },
    b: { l: 'Pickup', v: Math.round(66 * fMult), c: 'var(--chart-3)' }
  };

  // 4. Inventory Tab Data
  const rawStockVal = Math.round(48210 * venueScale);
  const rawWaste = Math.round(1240 * fMult);
  const inventoryKpis = [
    { label: 'Stock Value', value: formatValueForRole(rawStockVal, role, true), delta: '+2.1%', trend: 'up', icon: 'package', hint: 'Total on-hand value' },
    { label: 'Low Stock Items', value: Math.max(0, Math.round(7 * fMult)).toString(), delta: '+3', trend: 'up', positiveIsGood: false, icon: 'alert', hint: 'Below par threshold' },
    { label: 'Waste Cost', value: formatValueForRole(rawWaste, role, true), delta: '−' + formatValueForRole(180, role, true), trend: 'down', positiveIsGood: true, icon: 'refund', hint: 'Discards & spoilage' },
    { label: 'Stock Variance', value: '−2.4%', delta: '0.6%', trend: 'flat', positiveIsGood: false, icon: 'percent', hint: 'Actual vs counted' },
    { label: 'Most Used Ingredient', value: 'Chicken', delta: Math.round(184 * fMult) + ' kg', trend: 'flat', icon: 'flame', hint: 'Highest unit volume' },
    { label: 'Reorder Alerts', value: Math.max(0, Math.round(5 * fMult)).toString(), delta: '2 urgent', trend: 'flat', positiveIsGood: false, icon: 'bell', hint: 'Purchase orders req.' },
  ];

  const lowStockList = [
    { id: 1, item: 'Halloumi', onhand: '6 kg', par: '20 kg', status: 'critical' },
    { id: 2, item: 'Lamb', onhand: '11 kg', par: '30 kg', status: 'critical' },
    { id: 3, item: 'Mozzarella', onhand: '9 kg', par: '18 kg', status: 'low' },
    { id: 4, item: 'Hummus', onhand: '4 kg', par: '12 kg', status: 'low' },
    { id: 5, item: 'Bread', onhand: '38 pcs', par: '80 pcs', status: 'low' },
  ];

  const wasteByCategory = [
    { l: 'Proteins', v: Math.round(480 * fMult), c: 'var(--color-danger)' },
    { l: 'Produce', v: Math.round(320 * fMult), c: 'var(--color-warning)' },
    { l: 'Dairy', v: Math.round(210 * fMult), c: 'var(--color-warning)' },
    { l: 'Bakery', v: Math.round(140 * fMult), c: 'var(--chart-3)' },
    { l: 'Prepared', v: Math.round(90 * fMult), c: 'var(--chart-1)' },
  ];

  const inventoryUsageTrend = [
    { l: 'W1', v: Math.round(8.4 * fMult * 10) / 10 },
    { l: 'W2', v: Math.round(9.1 * fMult * 10) / 10 },
    { l: 'W3', v: Math.round(7.8 * fMult * 10) / 10 },
    { l: 'W4', v: Math.round(10.2 * fMult * 10) / 10 },
    { l: 'W5', v: Math.round(9.6 * fMult * 10) / 10 },
    { l: 'W6', v: Math.round(11.4 * fMult * 10) / 10 },
  ];

  const reorderRequiredList = [
    { id: 1, item: 'Halloumi', supplier: 'Aegean Dairy Co.', qty: '24 kg', eta: '1 day' },
    { id: 2, item: 'Lamb', supplier: 'Highland Meats', qty: '40 kg', eta: '2 days' },
    { id: 3, item: 'Mozzarella', supplier: 'Aegean Dairy Co.', qty: '20 kg', eta: '1 day' },
    { id: 4, item: 'Rice', supplier: 'Golden Grains Ltd.', qty: '50 kg', eta: '3 days' },
    { id: 5, item: 'Fries', supplier: 'FreshFreeze Inc.', qty: '60 kg', eta: '2 days' },
  ];

  // 5. Staff Tab Data
  const staffKpis = [
    { label: 'Active Staff', value: '18', delta: '2 on break', trend: 'flat', icon: 'users', hint: 'Clocked-in shifts' },
    { label: 'Orders Handled', value: rawOrders.toString(), delta: '+' + Math.round(rawOrders * 0.09), trend: 'up', icon: 'bag', hint: 'Avg ' + (rawOrders / 18).toFixed(1) + ' / staff' },
    { label: 'Average Service Time', value: '6:42', delta: '−0:18', trend: 'down', positiveIsGood: true, icon: 'timer', hint: 'Order ticket cycle' },
    { label: 'Best Performer', value: 'Maya O.', delta: '4.9 ★', trend: 'flat', icon: 'trophy', hint: Math.round(86 * fMult) + ' orders' },
    { label: 'Late Tasks', value: Math.max(0, Math.round(9 * fMult)).toString(), delta: '−3', trend: 'down', positiveIsGood: true, icon: 'alert', hint: 'SLA breaches' },
    { label: 'Shift Coverage', value: '96%', delta: '+2%', trend: 'up', icon: 'check', hint: 'Schedule matches shift' },
  ];

  const staffPerformance = [
    { id: 1, name: 'Maya Othman', role: 'Line Cook', orders: Math.round(86 * fMult), prep: '6:10', late: Math.max(0, Math.round(1 * fMult)), rating: 4.9 },
    { id: 2, name: 'Diego Santos', role: 'Grill', orders: Math.round(74 * fMult), prep: '6:48', late: Math.max(0, Math.round(2 * fMult)), rating: 4.7 },
    { id: 3, name: 'Aisha Karim', role: 'Cold Station', orders: Math.round(68 * fMult), prep: '5:32', late: Math.max(0, Math.round(0 * fMult)), rating: 4.8 },
    { id: 4, name: 'Liam Walsh', role: 'Pizza', orders: Math.round(59 * fMult), prep: '8:14', late: Math.max(0, Math.round(4 * fMult)), rating: 4.2 },
    { id: 5, name: 'Nora Haddad', role: 'Expediter', orders: Math.round(71 * fMult), prep: '6:55', late: Math.max(0, Math.round(2 * fMult)), rating: 4.6 },
  ];

  const ordersCompletedByStaff = [
    { l: 'Maya Othman', v: Math.round(86 * fMult), c: 'var(--chart-1)' },
    { l: 'Diego Santos', v: Math.round(74 * fMult), c: 'var(--chart-1)' },
    { l: 'Nora Haddad', v: Math.round(71 * fMult), c: 'var(--chart-1)' },
    { l: 'Aisha Karim', v: Math.round(68 * fMult), c: 'var(--chart-1)' },
    { l: 'Liam Walsh', v: Math.round(59 * fMult), c: 'var(--chart-1)' },
  ];

  const prepTimeByStaff = [
    { l: 'Aisha Karim', v: 5.5, c: 'var(--color-primary)' },
    { l: 'Maya Othman', v: 6.2, c: 'var(--color-primary)' },
    { l: 'Diego Santos', v: 6.8, c: 'var(--color-primary)' },
    { l: 'Nora Haddad', v: 6.9, c: 'var(--color-primary)' },
    { l: 'Liam Walsh', v: 8.2, c: 'var(--color-warning)' },
  ];

  const shiftCoverage = [
    { l: 'Morning', v: 92 },
    { l: 'Afternoon', v: 98 },
    { l: 'Evening', v: 96 },
    { l: 'Night', v: 88 },
  ];

  // 6. Payments Tab Data
  const rawFees = Math.round(612 * fMult);
  const rawRefunds = Math.round(640 * fMult);
  const paymentKpis = [
    { label: 'Gross Payments', value: formatValueForRole(rawSales, role, true), delta: '+9.4%', trend: 'up', icon: 'dollar', hint: 'Card + Cash + Delivery' },
    { label: 'Net Payments', value: formatValueForRole(rawNet, role, true), delta: '+8.1%', trend: 'up', icon: 'wallet', hint: 'Excludes fees & refunds' },
    { label: 'Refunds', value: formatValueForRole(rawRefunds, role, true), delta: Math.max(1, Math.round(14 * fMult)) + ' issued', trend: 'flat', positiveIsGood: false, icon: 'refund', hint: 'Reversed transactions' },
    { label: 'Failed Payments', value: Math.max(0, Math.round(6 * fMult)).toString(), delta: '−2', trend: 'down', positiveIsGood: true, icon: 'xCircle', hint: 'Declined transactions' },
    { label: 'Card Fees', value: formatValueForRole(rawFees, role, true), delta: '2.5% avg', trend: 'flat', positiveIsGood: false, icon: 'percent', hint: 'Processor fees' },
    { label: 'Cash Collected', value: formatValueForRole(Math.round(4120 * fMult), role, true), delta: '16.8%', trend: 'flat', icon: 'receipt', hint: 'In-drawer currency' },
  ];

  const paymentsByMethod = [
    { l: 'Card', v: Math.round(13420 * fMult), c: 'var(--chart-1)' },
    { l: 'Online', v: Math.round(4280 * fMult), c: 'var(--chart-2)' },
    { l: 'Cash', v: Math.round(4120 * fMult), c: 'var(--chart-3)' },
    { l: 'PayWave', v: Math.round(1840 * fMult), c: 'var(--chart-4)' },
    { l: 'Delivery Platform', v: Math.round(920 * fMult), c: 'var(--chart-5)' },
  ];

  const refundsTrend = [
    { l: 'Mon', v: Math.round(60 * fMult) },
    { l: 'Tue', v: Math.round(95 * fMult) },
    { l: 'Wed', v: Math.round(40 * fMult) },
    { l: 'Thu', v: Math.round(120 * fMult) },
    { l: 'Fri', v: Math.round(80 * fMult) },
    { l: 'Sat', v: Math.round(145 * fMult) },
    { l: 'Sun', v: Math.round(100 * fMult) },
  ];

  const failedTransactions = [
    { id: 'TXN-90412', method: 'Card ····4821', amount: 64.50, reason: 'Insufficient funds', time: '19:42' },
    { id: 'TXN-90388', method: 'Card ····1190', amount: 128.00, reason: 'Card declined', time: '18:15' },
    { id: 'TXN-90351', method: 'Online', amount: 42.20, reason: 'Gateway timeout', time: '16:08' },
    { id: 'TXN-90329', method: 'PayWave', amount: 31.75, reason: 'Read error', time: '14:51' },
    { id: 'TXN-90301', method: 'Card ····0042', amount: 88.90, reason: 'Expired card', time: '13:22' },
  ];

  const paymentSettlements = [
    { id: 1, method: 'Card', gross: Math.round(13420 * fMult), fees: Math.round(335 * fMult), net: Math.round(13085 * fMult), status: 'Settled' },
    { id: 2, method: 'Online', gross: Math.round(4280 * fMult), fees: Math.round(128 * fMult), net: Math.round(4152 * fMult), status: 'Settled' },
    { id: 3, method: 'Cash', gross: Math.round(4120 * fMult), fees: 0, net: Math.round(4120 * fMult), status: 'Settled' },
    { id: 4, method: 'PayWave', gross: Math.round(1840 * fMult), fees: Math.round(46 * fMult), net: Math.round(1794 * fMult), status: 'Pending' },
    { id: 5, method: 'Delivery Platform', gross: Math.round(920 * fMult), fees: Math.round(103 * fMult), net: Math.round(817 * fMult), status: 'Pending' },
  ];

  return {
    sales: { kpi: salesKpis, trend: salesTrend, service: salesByService, hour: salesByHour, items: topMenuItems, categories: salesByCategory },
    kitchen: { kpi: kitchenKpis, prep: prepTimeByStation, delayed: delayedByStation, ticket: ticketTimeByHour, topDelayed: topDelayedItems, throughput: stationThroughput },
    operations: { kpi: opsKpis, hour: ordersByHour, type: ordersByType, status: ordersByStatus, splitDine: splitDineInTakeAway, splitDel: splitDeliveryPickup },
    inventory: { kpi: inventoryKpis, lowStock: lowStockList, waste: wasteByCategory, usage: inventoryUsageTrend, reorder: reorderRequiredList },
    staff: { kpi: staffKpis, perf: staffPerformance, volume: ordersCompletedByStaff, time: prepTimeByStaff, shift: shiftCoverage },
    payments: { kpi: paymentKpis, method: paymentsByMethod, refunds: refundsTrend, failed: failedTransactions, settlements: paymentSettlements },
  };
}

// Generate realistic live real-time simulation ticks
export function getLiveUpdateTick(currentData: any, tab: string) {
  // Deep clone
  const updated = JSON.parse(JSON.stringify(currentData));
  const tickAmount = Math.random();

  // Only apply ticks if random chance hits
  if (tickAmount > 0.4) {
    const isSales = tab === 'sales' || tab === 'payments' || tab === 'operations';
    const isKitchen = tab === 'kitchen' || tab === 'staff';

    if (isSales && updated.sales) {
      // Increment sales metrics
      const newOrders = 1 + Math.floor(Math.random() * 2);
      const newRev = Math.round(newOrders * (50 + Math.random() * 40));
      const newCovers = Math.round(newOrders * (1 + Math.random() * 2));

      // Update Sales KPIs
      updated.sales.kpi = updated.sales.kpi.map((k: any) => {
        if (k.label === 'Total Sales') {
          const currentVal = parseInt(k.value.replace(/[^0-9]/g, '')) || 0;
          return { ...k, value: '$' + (currentVal + newRev).toLocaleString() };
        }
        if (k.label === 'Net Sales') {
          const currentVal = parseInt(k.value.replace(/[^0-9]/g, '')) || 0;
          return { ...k, value: '$' + (currentVal + Math.round(newRev * 0.9)).toLocaleString() };
        }
        if (k.label === 'Orders') {
          const currentVal = parseInt(k.value) || 0;
          return { ...k, value: (currentVal + newOrders).toString() };
        }
        if (k.label === 'Covers') {
          const currentVal = parseInt(k.value) || 0;
          return { ...k, value: (currentVal + newCovers).toString() };
        }
        return k;
      });

      // Update Hourly Sales (add to last hour)
      if (updated.sales.hour && updated.sales.hour.length > 0) {
        const lastIdx = updated.sales.hour.length - 1;
        updated.sales.hour[lastIdx].v += newRev;
      }

      // Add to payments tab too
      if (updated.payments) {
        updated.payments.kpi = updated.payments.kpi.map((k: any) => {
          if (k.label === 'Gross Payments') {
            const currentVal = parseInt(k.value.replace(/[^0-9]/g, '')) || 0;
            return { ...k, value: '$' + (currentVal + newRev).toLocaleString() };
          }
          if (k.label === 'Net Payments') {
            const currentVal = parseInt(k.value.replace(/[^0-9]/g, '')) || 0;
            return { ...k, value: '$' + (currentVal + Math.round(newRev * 0.9)).toLocaleString() };
          }
          return k;
        });
      }
    }

    if (isKitchen && updated.kitchen) {
      // Simulate minor SLA changes
      const successChance = Math.random();
      updated.kitchen.kpi = updated.kitchen.kpi.map((k: any) => {
        if (k.label === 'Orders Completed') {
          const currentVal = parseInt(k.value) || 0;
          return { ...k, value: (currentVal + 1).toString() };
        }
        if (k.label === 'Delayed Orders' && successChance < 0.1) {
          const currentVal = parseInt(k.value) || 0;
          return { ...k, value: (currentVal + 1).toString() };
        }
        return k;
      });
    }
  }

  return updated;
}

// Detailed Drill-down Mock Datasets
export function getDrillDownDetails(type: string, name: string) {
  // Generates itemized granular list depending on drill target
  switch (type) {
    case 'item': // Drill menu item
      return {
        title: `Sales Details — ${name}`,
        headers: ['Date', 'Venue', 'Orders', 'Qty Sold', 'Revenue', 'SLA Compl.'],
        rows: [
          { col1: '2026-07-01', col2: 'Verdura Downtown', col3: '28', col4: '34 units', col5: '$680.00', col6: '94%' },
          { col1: '2026-06-30', col2: 'Verdura Downtown', col3: '22', col4: '26 units', col5: '$520.00', col6: '92%' },
          { col1: '2026-06-29', col2: 'Verdura Downtown', col3: '31', col4: '38 units', col5: '$760.00', col6: '88%' },
          { col1: '2026-06-28', col2: 'Verdura Marina', col3: '14', col4: '18 units', col5: '$360.00', col6: '100%' },
          { col1: '2026-06-27', col2: 'Verdura Downtown', col3: '26', col4: '31 units', col5: '$620.00', col6: '95%' },
        ]
      };
    case 'staff': // Drill employee
      return {
        title: `Performance Profile — ${name}`,
        headers: ['Shift Date', 'Station', 'Orders Handled', 'Avg Prep Time', 'Late Count', 'Rating'],
        rows: [
          { col1: '2026-07-01', col2: 'Main Kitchen', col3: '18', col4: '6:15m', col5: '0', col6: '5.0 ★' },
          { col1: '2026-06-30', col2: 'Main Kitchen', col3: '15', col4: '6:02m', col5: '1', col6: '4.8 ★' },
          { col1: '2026-06-29', col2: 'Cold Station', col3: '22', col4: '5:45m', col5: '0', col6: '4.9 ★' },
          { col1: '2026-06-28', col2: 'Main Kitchen', col3: '16', col4: '6:30m', col5: '0', col6: '4.9 ★' },
          { col1: '2026-06-27', col2: 'Grill Station', col3: '15', col4: '7:10m', col5: '0', col6: '4.7 ★' },
        ]
      };
    case 'station': // Drill kitchen station
      return {
        title: `Station Analytics — ${name}`,
        headers: ['Shift', 'Orders Routed', 'Active Staff', 'Avg Queue', 'Breaches', 'Load Index'],
        rows: [
          { col1: 'Lunch Shift', col2: '48 orders', col3: '2 cooks', col4: '1.4 orders', col5: '2', col6: 'Optimal' },
          { col1: 'Dinner Shift', col2: '112 orders', col3: '4 cooks', col4: '3.6 orders', col5: '9', col6: 'Heavy' },
          { col1: 'Morning Shift', col2: '12 orders', col3: '1 cook', col4: '0.4 orders', col5: '0', col6: 'Light' },
          { col1: 'Late Night Shift', col2: '24 orders', col3: '2 cooks', col4: '1.2 orders', col5: '1', col6: 'Optimal' },
        ]
      };
    case 'payment': // Drill payment transaction details
      return {
        title: `Transaction Audit — ${name}`,
        headers: ['Ref ID', 'Timestamp', 'Gateway', 'Fees Charged', 'Settled Net', 'Auth Status'],
        rows: [
          { col1: 'TXN-90481', col2: '19:54:12', col3: 'Stripe Reader', col4: '$1.62', col5: '$63.28', col6: 'Authorized' },
          { col1: 'TXN-90477', col2: '19:48:05', col3: 'Stripe Reader', col4: '$2.34', col5: '$91.66', col6: 'Authorized' },
          { col1: 'TXN-90471', col2: '19:33:41', col3: 'ApplePay API', col4: '$0.88', col5: '$34.12', col6: 'Authorized' },
          { col1: 'TXN-90465', col2: '19:15:10', col3: 'Stripe Reader', col4: '$4.12', col5: '$160.88', col6: 'Authorized' },
          { col1: 'TXN-90459', col2: '18:59:22', col3: 'Cash Draw A', col4: '$0.00', col5: '$42.50', col6: 'Cash' },
        ]
      };
    case 'kpi': // Drill down on KPI card click
      return {
        title: `Granular Trend — ${name}`,
        headers: ['Breakdown Dimension', 'Unit Count', 'Revenue Contribution', 'SLA Rate', 'Status'],
        rows: [
          { col1: 'Dine-in (Verdura Downtown)', col2: '186 orders', col3: '$11,240.00', col4: '92.6%', col5: 'Normal' },
          { col1: 'Take Away (Verdura Downtown)', col2: '112 orders', col3: '$6,420.00', col4: '94.1%', col5: 'Normal' },
          { col1: 'Dine-in (Verdura Marina)', col2: '62 orders', col3: '$2,180.00', col4: '100%', col5: 'Normal' },
          { col1: 'Take Away (Verdura Marina)', col2: '52 orders', col3: '$4,740.00', col4: '84.8%', col5: 'Watch' },
        ]
      };
    default:
      return {
        title: `Report Breakdown — ${name}`,
        headers: ['Dimension', 'Value', 'Percentage', 'Rating'],
        rows: [
          { col1: 'Downtown Segment', col2: '84%', col3: '84%', col4: 'Good' },
          { col1: 'Marina Segment', col2: '11%', col3: '11%', col4: 'Average' },
          { col1: 'Airport Segment', col2: '5%', col3: '5%', col4: 'Average' },
        ]
      };
  }
}

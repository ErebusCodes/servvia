export type UserRole = 'owner' | 'admin' | 'finance' | 'operations' | 'kitchen' | 'venueManager' | 'staff';

export interface FilterState {
  // Basic filters
  dateRange: string;
  venue: string;
  service: string;
  orderType: string;
  
  // Advanced filters (collapsible)
  shift: string;
  kitchenStation: string;
  staff: string;
  category: string;
  menuItem: string;
  paymentMethod: string;
  customerType: string;
  discount: string;
  promotion: string;
  supplier: string;
  reservationSource: string;
  posTerminal: string;
  device: string;
  orderStatus: string;
  table: string;
  channel: string;
  deliveryPartner: string;
  taxClass: string;
  
  // Search query
  searchQuery: string;
}

export interface ComparisonState {
  enabled: boolean;
  type: 'prev_period' | 'prev_year' | 'custom_range' | 'another_venue' | 'another_service' | 'another_channel';
  customStartDate?: string;
  customEndDate?: string;
  targetValue?: string; // Target venue ID, service ID, etc.
}

export interface SavedReportView {
  id: string;
  name: string;
  isDefault?: boolean;
  isShared?: boolean;
  filters: Partial<FilterState>;
  comparison: ComparisonState;
  tab: string;
}

export interface CustomReportConfig {
  id: string;
  name: string;
  metrics: string[]; // e.g. 'sales', 'covers', 'avgTicket', 'prepTime', 'waste'
  dimensions: string[]; // e.g. 'hour', 'day', 'menuItem', 'category', 'staff', 'station'
  columns: string[]; // table columns
  grouping: string; // group by dimension
  sorting: { key: string; dir: 'asc' | 'desc' };
  dateRange: string;
  chartType: 'barV' | 'line' | 'donut' | 'barList' | 'none';
}

export interface InsightAlert {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  severity: 'info' | 'warning' | 'error' | 'success';
  trend: 'up' | 'down' | 'flat';
  recommendation: string;
  category: 'sales' | 'kitchen' | 'operations' | 'inventory' | 'staff' | 'payments';
  timestamp: string;
}

export interface ScheduledExportConfig {
  id: string;
  reportName: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  format: 'csv' | 'excel' | 'pdf';
  recipients: string;
  deliveryTime: string;
  subject: string;
  created: string;
}

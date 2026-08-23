import tableConfig from '../../../../shared/table-config.json';

export interface CanonicalTable {
  tableNumber: string;
  name: string;
  capacity: number;
  sortOrder: number;
}

export const TABLES = tableConfig as CanonicalTable[];
export const TABLE_COUNT = TABLES.length;
export const TOTAL_SEATING_CAPACITY = TABLES.reduce((total, table) => total + table.capacity, 0);

export function canonicalTable(tableNumber: string): CanonicalTable | undefined {
  return TABLES.find(table => table.tableNumber === tableNumber);
}

// Layout Configuration & Mapping for Table Map
export interface TableLayoutItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  seats: number;
}

export const TABLE_LAYOUTS: TableLayoutItem[] = [
  { id: 'T1', x: 32.7, y: 16.7, w: 7.6, h: 9.0, seats: 2 },
  { id: 'T2', x: 46.5, y: 16.7, w: 7.6, h: 9.0, seats: 2 },
  { id: 'T3', x: 60.3, y: 16.7, w: 7.6, h: 9.0, seats: 2 },
  { id: 'T19', x: 87.8, y: 56.9, w: 8.3, h: 14.0, seats: 2 },
  { id: 'T10', x: 2.0, y: 36.2, w: 10.7, h: 14.4, seats: 8 },
  { id: 'T11', x: 15.8, y: 36.1, w: 6.9, h: 9.0, seats: 2 },
  { id: 'T12', x: 25.8, y: 36.1, w: 6.9, h: 9.0, seats: 2 },
  { id: 'T13', x: 35.8, y: 36.1, w: 6.9, h: 9.0, seats: 2 },
  { id: 'T14', x: 45.8, y: 36.1, w: 6.9, h: 9.0, seats: 4 },
  { id: 'T15', x: 55.7, y: 36.1, w: 6.9, h: 9.0, seats: 4 },
  { id: 'T16', x: 65.7, y: 36.1, w: 6.9, h: 9.0, seats: 4 },
  { id: 'T17', x: 75.7, y: 36.1, w: 6.9, h: 9.0, seats: 6 },
  { id: 'T18', x: 85.7, y: 36.2, w: 12.5, h: 18.0, seats: 12 },
  { id: 'T7', x: 15.8, y: 59.4, w: 13.8, h: 8.9, seats: 6 },
  { id: 'T8', x: 40.8, y: 59.4, w: 13.8, h: 8.9, seats: 6 },
  { id: 'T9', x: 65.7, y: 56.9, w: 8.3, h: 14.0, seats: 4 },
  { id: 'T4', x: 12.5, y: 78.8, w: 13.8, h: 8.9, seats: 4 },
  { id: 'T5', x: 35.0, y: 78.8, w: 30.2, h: 8.9, seats: 8 },
  { id: 'T6', x: 73.9, y: 78.8, w: 13.8, h: 8.9, seats: 6 },
];

export const RX = { min: 2.0, span: 96.2 };
export const RY = { min: 16.7, span: 71.0 };
export const PAD = 2.5;
export const FILL = 95;

export const mapX = (v: number) => (v - RX.min) / RX.span * FILL + PAD;
export const mapY = (v: number) => (v - RY.min) / RY.span * FILL + PAD;
export const mapW = (v: number) => v / RX.span * FILL;
export const mapH = (v: number) => v / RY.span * FILL;

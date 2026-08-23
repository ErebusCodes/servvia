export interface Table {
  id: string;
  tableNumber: string;
  name: string | null;
  capacity: number;
  isActive: boolean;
  sortOrder: number;
}

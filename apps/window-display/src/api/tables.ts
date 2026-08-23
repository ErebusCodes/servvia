import type { Table } from '../types/table';

const API_BASE = import.meta.env['VITE_API_URL'] || '';

export async function fetchActiveTables(venueId: string): Promise<Table[]> {
  const res = await fetch(`${API_BASE}/api/kiosk/venues/${venueId}/tables`);
  if (!res.ok) throw new Error(`Failed to fetch tables: ${res.status}`);
  return res.json() as Promise<Table[]>;
}

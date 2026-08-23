import type { Category, MenuItem } from '../types/menu';

const API_BASE = import.meta.env['VITE_API_URL'] || '';

interface MenuData {
  categories: Category[];
  menuItems: MenuItem[];
}

export async function fetchVenueMenu(venueId: string): Promise<MenuData> {
  const res = await fetch(`${API_BASE}/api/kiosk/venues/${venueId}/menu`);
  if (!res.ok) throw new Error(`Failed to fetch menu: ${res.status}`);
  return res.json() as Promise<MenuData>;
}

export async function submitKioskOrder(orderPayload: any): Promise<any> {
  const res = await fetch(`${API_BASE}/api/kiosk/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderPayload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to submit order: ${res.status}`);
  }
  return res.json();
}

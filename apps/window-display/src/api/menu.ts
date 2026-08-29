import type { Category, MenuItem } from '../types/menu';

const API_BASE = import.meta.env['VITE_API_URL'] || '';

interface MenuData {
  categories: Category[];
  menuItems: MenuItem[];
}

/**
 * Phase D (Menu Management architecture): calls the canonical
 * window_display channel resolver, which excludes channel-hidden items/
 * categories AND unavailable items server-side, and can never return a
 * PosProductIdentity candidate (it is never a MenuItem row). This is the
 * structural fix for the pre-Phase-D leak where this function hit the
 * always-unfiltered `GET /api/kiosk/venues/:venueId/menu` directly and
 * `KioskOrderPage.tsx` only visually dimmed (never excluded) unavailable
 * items — meaning every one of the ~825 unreviewed IdealPOS-imported
 * staging rows rendered, dimmed, in the real self-service ordering UI.
 */
export async function fetchVenueMenu(venueId: string): Promise<MenuData> {
  const res = await fetch(`${API_BASE}/api/menu/venues/${venueId}/channel/window_display`);
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

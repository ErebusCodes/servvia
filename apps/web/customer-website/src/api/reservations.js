// Real reservation API client — replaces the old apiClient.js (dead code,
// deleted; bypassed the NestJS API and was never actually imported
// anywhere) and BookTable.jsx's fabricated `'VRD-' + Date.now()` reference.
//
// Every function here talks to the backend's public reservations surface
// (backend/src/reservations/public-reservations.controller.ts), which
// reuses the same ReservationsService/capacity/FSM the staff admin panel
// uses — there is exactly one reservation implementation, not two.

const API_BASE = import.meta.env.VITE_API_URL || '';
const VENUE_ID = import.meta.env.VITE_VENUE_ID || '';

/** "7:30 PM" / "12:00 PM" / "19:30" -> "19:30". Returns null if unparseable. */
export function to24HourTime(input) {
  if (!input) return null;
  const trimmed = String(input).trim();

  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  if (minute < 0 || minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'AM') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const method = (options.method || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    // The backend's CSRF middleware issues a csrf_token cookie on the first
    // request and requires it echoed back in this header for state-changing
    // requests. A GET (e.g. an availability check) always runs before a
    // POST in this flow, so the cookie is reliably present by then; fetch
    // one defensively if not.
    let csrfToken = readCookie('csrf_token');
    if (!csrfToken) {
      await fetch(`${API_BASE}/api/health`, { credentials: 'include' });
      csrfToken = readCookie('csrf_token');
    }
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...headers },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (Array.isArray(body?.message)) message = body.message.join(', ');
      else if (typeof body?.message === 'string') message = body.message;
    } catch {
      // response body wasn't JSON — keep the generic message
    }
    throw new Error(message);
  }

  return response.json();
}

function requireVenueId() {
  if (!VENUE_ID) {
    throw new Error(
      'VITE_VENUE_ID is not configured — cannot check availability or book. See apps/web/customer-website/.env.example.'
    );
  }
  return VENUE_ID;
}

/**
 * Checks live, database-backed availability for a date/time/party size.
 * Throws (never fabricates a result) if the request fails.
 */
export async function checkAvailability({ date, time, partySize }) {
  const venueId = requireVenueId();
  const time24 = to24HourTime(time);
  if (!time24) throw new Error(`Could not understand time "${time}"`);

  const params = new URLSearchParams({ date, time: time24, partySize: String(partySize) });
  return apiFetch(`/api/reservations/venues/${venueId}/availability?${params.toString()}`);
}

/**
 * Creates a real reservation. Resolves with the backend's persisted row
 * (real id, real bookingRef, status starting at "pending") or rejects — the
 * caller must not treat a rejection as success.
 */
export async function createReservation(reservation) {
  const venueId = requireVenueId();
  const time24 = to24HourTime(reservation.time);
  if (!time24) throw new Error(`Could not understand time "${reservation.time}"`);

  const guests = (reservation.guestSetup || [])
    .filter((g) => (g?.name && g.name.trim()) || (g?.dietary && g.dietary.length > 0))
    .map((g) => ({
      name: g.name?.trim() || undefined,
      dietaryPreferences: (g.dietary || []).filter((d) => d !== 'None'),
    }));

  const menuTotal = Object.values(reservation.menuSelections || {})
    .flat()
    .reduce((sum, item) => sum + (item.price || 0), 0);

  const paymentMethod = reservation.paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'pay_at_restaurant';

  return apiFetch('/api/reservations', {
    method: 'POST',
    body: JSON.stringify({
      venueId,
      guestName: reservation.name,
      guestEmail: reservation.email,
      guestPhone: reservation.phone || undefined,
      partySize: reservation.guests,
      reservationDate: reservation.date,
      reservationTime: time24,
      occasion: reservation.occasion || undefined,
      specialRequests: reservation.requests || undefined,
      paymentMethod,
      menuSelections: reservation.menuSelections || {},
      menuTotal,
      guests: guests.length > 0 ? guests : undefined,
    }),
  });
}

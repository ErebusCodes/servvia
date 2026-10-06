import { create } from 'zustand';
import { api } from '../lib/api';

export interface Reservation {
  id: string;
  venueId: string;
  bookingRef: string;
  status: 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  partySize: number;
  occasion: string | null;
  specialRequests: string | null;
  reservationDate: string;
  reservationTime: string;
  tableId: string | null;
  createdAt: string;
  updatedAt: string;

  // UI-only decorative fields with no backend equivalent (no CRM/visit-
  // history model exists) — never sent to or read from the API. Populated
  // only for reservations created/edited in this browser session via the
  // admin form; real reservations fetched from the backend simply won't
  // have these set, and the UI already treats them as optional everywhere.
  starred?: boolean;
  vip?: boolean;
  visitsCount?: number;
  lastVisit?: string;
  avgSpend?: number;
  subStatus?: string;
  tags?: string[];
  source?: 'online' | 'phone';
  confirmationChannel?: string;
}

interface BackendReservation {
  id: string;
  venueId: string;
  bookingRef: string;
  status: Reservation['status'];
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  partySize: number;
  occasion: string | null;
  specialRequests: string | null;
  reservationDate: string;
  reservationTime: string;
  tableId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toStoreReservation(r: BackendReservation): Reservation {
  return { ...r };
}

const BACKEND_FIELDS = [
  'guestName',
  'guestEmail',
  'guestPhone',
  'partySize',
  'reservationDate',
  'reservationTime',
  'tableId',
  'occasion',
  'specialRequests',
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The reservation form's time field is free text ("1:30 PM", matching the
 * mockup's placeholder), but the backend expects 24h "HH:MM". Already
 * 24h-formatted input (e.g. from a real reservation's own reservationTime,
 * unchanged on edit) passes through unchanged.
 */
function to24HourTime(input: string): string {
  const trimmed = input.trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (!match) {
    throw new Error(`Could not understand time "${input}" — use a format like "7:30 PM".`);
  }
  let hour = parseInt(match[1]!, 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3] ? match[3].toUpperCase() : null;
  if (minute < 0 || minute > 59) {
    throw new Error(`Could not understand time "${input}" — use a format like "7:30 PM".`);
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new Error(`Could not understand time "${input}".`);
    hour = meridiem === 'AM' ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  } else if (hour < 0 || hour > 23) {
    throw new Error(`Could not understand time "${input}".`);
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * ReservationsPage's "Assign Table" dropdown currently sources ids from the
 * static shared/table-config.json (synthetic ids like "t1"), not the real
 * backend Table rows' UUIDs (see apps/web/admin-console/src/pages/table-management's
 * mock/real split, already known from the menu/audit work) — sending one of
 * those to the backend's @IsUUID()-validated tableId would 400. Until that
 * table-source split is unified, silently drop a non-UUID tableId rather
 * than fail the whole reservation save over an unrelated, already-known gap.
 */
function sanitizeTableId(tableId: string | null | undefined): string | undefined {
  if (!tableId) return undefined;
  if (!UUID_PATTERN.test(tableId)) {
    console.warn(
      `[reservation.store] Ignoring non-UUID tableId "${tableId}" — table assignment isn't backend-wired yet.`,
    );
    return undefined;
  }
  return tableId;
}

let cachedVenueId: string | null = null;
/** Exported for reuse anywhere else in Admin Console that needs "the one
 * venue this single-venue-MVP organization has" — see MediaAssetsService's
 * request-upload flow, which requires a real venueId. */
export async function resolveVenueId(): Promise<string> {
  if (cachedVenueId) return cachedVenueId;
  const { data } = await api.get<{ id: string }[]>('/api/venues');
  if (!data[0]) throw new Error('No venue is configured for this organization.');
  cachedVenueId = data[0].id;
  return cachedVenueId;
}

interface ReservationState {
  reservations: Reservation[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  fetchReservations: () => Promise<void>;
  /** Creates a real reservation via admin/reservations and returns the
   *  server-persisted row (real id/bookingRef/status) — never a
   *  client-fabricated one. */
  addReservation: (draft: Omit<Reservation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Reservation>;
  /** `status` changes go through the dedicated transition endpoint (the
   *  same FSM the backend enforces everywhere else); other backend fields
   *  go through a normal PATCH; purely decorative fields (e.g. `starred`)
   *  never touch the network at all. */
  updateReservation: (id: string, updated: Partial<Reservation>) => Promise<void>;
  deleteReservation: (id: string) => Promise<void>;
}

export const useReservationStore = create<ReservationState>((set) => ({
  reservations: [],
  loading: false,
  loaded: false,
  error: null,

  fetchReservations: async () => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.get<BackendReservation[]>('/api/admin/reservations');
      set({ reservations: data.map(toStoreReservation), loading: false, loaded: true });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load reservations from the server.',
      });
    }
  },

  addReservation: async (draft) => {
    const venueId = await resolveVenueId();
    const { data } = await api.post<BackendReservation>('/api/admin/reservations', {
      venueId,
      guestName: draft.guestName,
      guestEmail: draft.guestEmail,
      guestPhone: draft.guestPhone || undefined,
      partySize: draft.partySize,
      reservationDate: draft.reservationDate,
      reservationTime: to24HourTime(draft.reservationTime),
      tableId: sanitizeTableId(draft.tableId),
      occasion: draft.occasion || undefined,
      specialRequests: draft.specialRequests || undefined,
    });
    const created: Reservation = {
      ...toStoreReservation(data),
      starred: draft.starred,
      vip: draft.vip,
      tags: draft.tags,
      source: draft.source,
      confirmationChannel: draft.confirmationChannel,
    };
    set((state) => ({ reservations: [created, ...state.reservations] }));
    return created;
  },

  updateReservation: async (id, patch) => {
    const hasBackendFieldChange = BACKEND_FIELDS.some((f) => f in patch);
    const hasStatusChange = 'status' in patch && patch.status !== undefined;

    if (!hasBackendFieldChange && !hasStatusChange) {
      set((state) => ({
        reservations: state.reservations.map((r) =>
          r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r,
        ),
      }));
      return;
    }

    let serverTruth: BackendReservation | null = null;

    if (hasBackendFieldChange) {
      const body: Record<string, unknown> = {};
      if (patch.guestName !== undefined) body.guestName = patch.guestName;
      if (patch.guestEmail !== undefined) body.guestEmail = patch.guestEmail;
      if (patch.guestPhone !== undefined) body.guestPhone = patch.guestPhone ?? undefined;
      if (patch.partySize !== undefined) body.partySize = patch.partySize;
      if (patch.reservationDate !== undefined) body.reservationDate = patch.reservationDate;
      if (patch.reservationTime !== undefined) body.reservationTime = to24HourTime(patch.reservationTime);
      if (patch.tableId !== undefined) body.tableId = sanitizeTableId(patch.tableId);
      if (patch.occasion !== undefined) body.occasion = patch.occasion ?? undefined;
      if (patch.specialRequests !== undefined) body.specialRequests = patch.specialRequests ?? undefined;
      const { data } = await api.patch<BackendReservation>(`/api/admin/reservations/${id}`, body);
      serverTruth = data;
    }

    if (hasStatusChange) {
      const { data } = await api.patch<BackendReservation>(`/api/admin/reservations/${id}/status`, {
        status: patch.status,
      });
      serverTruth = data;
    }

    set((state) => ({
      reservations: state.reservations.map((r) =>
        r.id === id ? { ...r, ...patch, ...(serverTruth ? toStoreReservation(serverTruth) : {}) } : r,
      ),
    }));
  },

  deleteReservation: async (id) => {
    await api.delete(`/api/admin/reservations/${id}`);
    set((state) => ({ reservations: state.reservations.filter((r) => r.id !== id) }));
  },
}));

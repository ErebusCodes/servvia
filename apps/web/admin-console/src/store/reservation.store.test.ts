import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../lib/api', () => ({ api: apiMock }));

const { useReservationStore } = await import('./reservation.store');

const backendReservation = {
  id: 'res-1',
  venueId: 'venue-1',
  bookingRef: 'VR-1234',
  status: 'pending' as const,
  guestName: 'Test Guest',
  guestEmail: 'guest@example.com',
  guestPhone: null,
  partySize: 2,
  occasion: null,
  specialRequests: null,
  reservationDate: '2026-09-01',
  reservationTime: '19:00',
  tableId: null,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

function resetStore() {
  useReservationStore.setState({ reservations: [], loading: false, loaded: false, error: null });
  Object.values(apiMock).forEach((fn) => fn.mockReset());
}

describe('useReservationStore (backend-backed, Phase 3)', () => {
  afterEach(() => {
    resetStore();
  });

  it('fetchReservations loads from the backend, not fabricated/mock data', async () => {
    apiMock.get.mockResolvedValue({ data: [backendReservation] });

    await useReservationStore.getState().fetchReservations();

    const state = useReservationStore.getState();
    expect(apiMock.get).toHaveBeenCalledWith('/api/admin/reservations');
    expect(state.loaded).toBe(true);
    expect(state.reservations).toEqual([backendReservation]);
  });

  it('fetchReservations surfaces a real error instead of falling back to fake data', async () => {
    apiMock.get.mockRejectedValue(new Error('network down'));

    await useReservationStore.getState().fetchReservations();

    const state = useReservationStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.error).toBe('network down');
    expect(state.reservations).toEqual([]);
  });

  it('addReservation POSTs to the backend and returns the server-assigned booking reference', async () => {
    apiMock.get.mockResolvedValue({ data: [{ id: 'venue-1' }] });
    apiMock.post.mockResolvedValue({ data: backendReservation });

    const result = await useReservationStore.getState().addReservation({
      venueId: '',
      bookingRef: '',
      status: 'pending',
      guestName: 'Test Guest',
      guestEmail: 'guest@example.com',
      guestPhone: null,
      partySize: 2,
      occasion: null,
      specialRequests: null,
      reservationDate: '2026-09-01',
      reservationTime: '7:00 PM',
      tableId: null,
    });

    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/admin/reservations',
      expect.objectContaining({ venueId: 'venue-1', reservationTime: '19:00' }),
    );
    // The real server-assigned bookingRef, never a client-fabricated one.
    expect(result.bookingRef).toBe('VR-1234');
    expect(useReservationStore.getState().reservations[0].id).toBe('res-1');
  });

  it('addReservation drops a non-UUID tableId (static table-config id) rather than sending it', async () => {
    apiMock.get.mockResolvedValue({ data: [{ id: 'venue-1' }] });
    apiMock.post.mockResolvedValue({ data: backendReservation });

    await useReservationStore.getState().addReservation({
      venueId: '', bookingRef: '', status: 'pending',
      guestName: 'x', guestEmail: 'x@example.com', guestPhone: null, partySize: 2,
      occasion: null, specialRequests: null, reservationDate: '2026-09-01', reservationTime: '7:00 PM',
      tableId: 't3',
    });

    const body = apiMock.post.mock.calls[0][1];
    expect(body.tableId).toBeUndefined();
  });

  it('updateReservation with only a decorative field (starred) never calls the API', async () => {
    useReservationStore.setState({ reservations: [backendReservation], loading: false, loaded: true, error: null });

    await useReservationStore.getState().updateReservation('res-1', { starred: true });

    expect(apiMock.patch).not.toHaveBeenCalled();
    expect(useReservationStore.getState().reservations[0].starred).toBe(true);
  });

  it('updateReservation with a status change calls the dedicated transition endpoint', async () => {
    useReservationStore.setState({ reservations: [backendReservation], loading: false, loaded: true, error: null });
    apiMock.patch.mockResolvedValue({ data: { ...backendReservation, status: 'confirmed' } });

    await useReservationStore.getState().updateReservation('res-1', { status: 'confirmed' });

    expect(apiMock.patch).toHaveBeenCalledWith('/api/admin/reservations/res-1/status', { status: 'confirmed' });
    expect(useReservationStore.getState().reservations[0].status).toBe('confirmed');
  });

  it('deleteReservation calls the real DELETE endpoint and removes the row on success', async () => {
    useReservationStore.setState({ reservations: [backendReservation], loading: false, loaded: true, error: null });
    apiMock.delete.mockResolvedValue({ data: {} });

    await useReservationStore.getState().deleteReservation('res-1');

    expect(apiMock.delete).toHaveBeenCalledWith('/api/admin/reservations/res-1');
    expect(useReservationStore.getState().reservations).toEqual([]);
  });
});

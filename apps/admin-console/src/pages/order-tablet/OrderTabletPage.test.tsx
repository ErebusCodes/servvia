import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('../../shared/orders', async () => {
  const actual = await vi.importActual<typeof import('../../shared/orders')>('../../shared/orders');
  return { ...actual, useLiveOrders: () => ({ data: [], isRealtimeConnected: true }) };
});

const { useMenuStore } = await import('../../store/menu.store');
const { useReservationStore } = await import('../../store/reservation.store');
const { useTabletDeviceAuthStore } = await import('../../store/tabletDeviceAuth.store');
const { OrderTabletPage } = await import('./OrderTabletPage');

const NZ_SUPPORTED_TAX_CONFIG = { currency: 'NZD', locale: 'en-NZ', taxJurisdiction: 'NZ_GST', pricesIncludeTax: true };
const UNSUPPORTED_TAX_CONFIG = { currency: 'NZD', locale: 'en-NZ', taxJurisdiction: 'NZ_GST', pricesIncludeTax: false };

function seedMenuStore() {
  useMenuStore.setState({
    resolvedCategories: [
      { id: 'cat-1', name: 'Mains', description: null, imageUrl: null, sortOrder: 0, isActive: true, subs: [] },
    ],
    resolvedItems: [
      {
        id: 'item-1',
        categoryId: 'cat-1',
        subCategory: null,
        title: 'Test Kebab',
        description: 'A test item',
        imageUrl: null,
        price: '$70.00',
        nutritionalDetails: { tags: [], isFeatured: false } as never,
        modifierGroups: [],
        isSpicy: false,
        isAvailable: true,
        sortOrder: 0,
      },
    ],
    resolvedLoading: false,
    resolvedLoaded: true,
    resolvedError: null,
    fetchResolvedMenu: vi.fn().mockResolvedValue(undefined),
  } as never);
}

function seedReservationStore() {
  useReservationStore.setState({ reservations: [] } as never);
}

interface FetchCall { url: string; init?: RequestInit }

function installFetchMock(taxConfig: unknown, posSyncStatus: string = 'not_applicable') {
  const calls: FetchCall[] = [];
  const createdOrder = {
    id: 'order-1',
    venueId: 'venue-1',
    tableId: 'real-table-1',
    tableNumber: '1',
    serviceMode: 'dine_in',
    takeawayReference: null,
    status: 'confirmed',
    source: 'staff',
    subtotalCents: 7000,
    taxCents: 1050,
    totalCents: 8050,
    notes: null,
    submittedAt: new Date().toISOString(),
    items: [],
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url.includes('/tax-config')) {
      return new Response(JSON.stringify(taxConfig), { status: 200 });
    }
    if (url.includes('/tables') && !url.includes('/admin/orders')) {
      return new Response(
        JSON.stringify([
          { id: 'real-table-1', tableNumber: '1', name: null, capacity: 4 },
          { id: 'real-table-2', tableNumber: '2', name: null, capacity: 4 },
        ]),
        { status: 200 },
      );
    }
    if (url.includes('/api/admin/orders') && init?.method === 'POST') {
      const submitCount = calls.filter((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST').length;
      // Real backend behavior this mock must reflect: serviceMode/tableId
      // echo the request, and a takeaway request gets a real-shaped
      // server-generated reference (never client-supplied).
      const reqBody = JSON.parse((init!.body as string) ?? '{}') as {
        serviceMode?: string;
        tableId?: string;
      };
      const isTakeaway = reqBody.serviceMode === 'takeaway';
      return new Response(
        JSON.stringify({
          ...createdOrder,
          id: `order-${submitCount}`,
          serviceMode: isTakeaway ? 'takeaway' : 'dine_in',
          tableId: isTakeaway ? null : (reqBody.tableId ?? createdOrder.tableId),
          tableNumber: isTakeaway ? null : createdOrder.tableNumber,
          takeawayReference: isTakeaway ? `TA-${String(100000 + submitCount)}` : null,
        }),
        { status: 201 },
      );
    }
    // Real shapes for the post-submission status polling endpoints (mirrors
    // PosSyncRecordsService.getForOrder's no-adapter-configured `{ orderId,
    // status }` shape, and print-jobs' real array-of-rows shape) — a bare
    // `{}` here made printJobsView.map throw once a test's flow actually
    // reached the Order Status screen (found while fixing this suite for
    // the payment-removal redesign).
    if (url.includes('/pos-sync')) {
      return new Response(JSON.stringify({ orderId: 'order-1', status: posSyncStatus }), { status: 200 });
    }
    if (url.includes('/print-jobs')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function renderTablet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OrderTabletPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderStandaloneTablet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OrderTabletPage standalone />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function resetTabletDeviceAuth() {
  useTabletDeviceAuthStore.setState({
    deviceToken: null,
    deviceId: null,
    venueId: null,
    deviceLabel: null,
    staffToken: null,
    staffName: null,
    staffRole: null,
    staffElevatedUntil: null,
    managerToken: null,
    managerName: null,
    managerElevatedUntil: null,
  });
}

function seedEnrolledDevice() {
  useTabletDeviceAuthStore.setState({ deviceToken: 'device.jwt.token', deviceId: 'device-1', venueId: 'venue-1', deviceLabel: 'Tablet 1' });
}

function fakeJwt(payload: Record<string, unknown>): string {
  const base64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=+$/, '');
  return `${base64({ alg: 'none' })}.${base64(payload)}.sig`;
}

function installStandaloneFetchMock(taxConfig: unknown) {
  const calls: FetchCall[] = [];
  const createdOrder = {
    id: 'order-1',
    venueId: 'venue-1',
    tableId: 'real-table-1',
    tableNumber: '1',
    status: 'confirmed',
    source: 'staff',
    subtotalCents: 7000,
    taxCents: 1050,
    totalCents: 8050,
    notes: null,
    submittedAt: new Date().toISOString(),
    items: [],
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url.includes('/tax-config')) return new Response(JSON.stringify(taxConfig), { status: 200 });
    if (url.includes('/tables') && !url.includes('orders')) {
      return new Response(JSON.stringify([{ id: 'real-table-1', tableNumber: '1', name: null, capacity: 4 }]), { status: 200 });
    }
    if (url.includes('/api/tablet/elevate') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { staffPin: string };
      if (body.staffPin !== '4242') {
        return new Response(JSON.stringify({ message: 'Incorrect staff PIN' }), { status: 401 });
      }
      const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 1200 });
      return new Response(JSON.stringify({ token, staff: { id: 'staff-1', name: 'Alex Cashier', role: 'cashier' } }), { status: 200 });
    }
    if (url.includes('/api/tablet/orders') && init?.method === 'POST') {
      return new Response(JSON.stringify(createdOrder), { status: 201 });
    }
    if (url.includes('/api/admin/orders') && init?.method === 'POST') {
      return new Response(JSON.stringify(createdOrder), { status: 201 });
    }
    if (url.includes('/api/tablet/lock')) return new Response(null, { status: 204 });
    if (url.includes('/pos-sync')) {
      return new Response(JSON.stringify({ orderId: 'order-1', status: 'not_applicable' }), { status: 200 });
    }
    if (url.includes('/print-jobs')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function selectTableAndStartOrder() {
  // TableMap renders the table id and seat-count subLabel as adjacent spans
  // with no separating whitespace in the DOM (e.g. "T1" + "2 seats" ->
  // accessible name "T12 seats") — match the exact concatenated string for
  // table T1 so T10-T19 (which also start with "T1") aren't matched too.
  const tableButton = await screen.findByRole('button', { name: 'T12 seats' });
  fireEvent.click(tableButton);

  const incrementGuests = await screen.findByRole('button', { name: '+' });
  fireEvent.click(incrementGuests);

  const startButton = await screen.findByRole('button', { name: /Start order/i });
  fireEvent.click(startButton);
}

// 'Test Kebab' has no configured modifierGroups (Story 15-3: real,
// authoritative data only — no fictional catalog is ever invented for an
// item that hasn't been authored one), so tapping it adds it to the cart
// directly with no customizer modal, exactly like a real unconfigured item.
async function addTestItemToCart() {
  const itemCard = await screen.findByText('Test Kebab');
  fireEvent.click(itemCard);
}

beforeEach(() => {
  seedMenuStore();
  seedReservationStore();
  resetTabletDeviceAuth();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetTabletDeviceAuth();
});

describe('OrderTabletPage — Story 15-4 provisional billing', () => {
  it('shows no fabricated service charge and discloses GST without adding it to the total', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    await selectTableAndStartOrder();
    await addTestItemToCart();

    await waitFor(() => expect(screen.getByText('GST included')).toBeInTheDocument());

    // Regression guard: no trace of the old fabricated 10% service charge anywhere.
    expect(screen.queryByText(/service charge/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Service \+ GST/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Service 10%/i)).not.toBeInTheDocument();

    // $70.00 item, no discount: total is exactly the item price — GST (contained,
    // $9.13) is disclosed but not added on top of it.
    const totalRows = screen.getAllByText('Total');
    expect(totalRows.length).toBeGreaterThan(0);
    expect(screen.getAllByText('$70.00').length).toBeGreaterThan(0);
    expect(screen.getByText('$9.13')).toBeInTheDocument();

    expect(screen.getAllByText(/Provisional — pending Idealpos confirmation/i).length).toBeGreaterThan(0);
  });

  it('submits the order without any service-charge field and with a real idempotency key', async () => {
    const { calls } = installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    await selectTableAndStartOrder();
    await addTestItemToCart();

    const sendButton = await screen.findByRole('button', { name: /Send to kitchen/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      const submit = calls.find((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
      expect(submit).toBeDefined();
    });

    const submit = calls.find((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST')!;
    const body = JSON.parse(submit.init!.body as string);

    expect(body).not.toHaveProperty('service');
    expect(body).not.toHaveProperty('serviceCharge');
    expect(body).not.toHaveProperty('gst');
    expect(body).not.toHaveProperty('total');
    expect(body).not.toHaveProperty('totalCents');
    expect(typeof body.idempotencyKey).toBe('string');
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(body.items).toHaveLength(1);
  });

  it('carries the same corrected provisional total through to the order status screen, with no payment UI', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    await selectTableAndStartOrder();
    await addTestItemToCart();

    const sendButton = await screen.findByRole('button', { name: /Send to kitchen/i });
    fireEvent.click(sendButton);

    await waitFor(() => expect(screen.getByText(/Order Status · Table/)).toBeInTheDocument());
    expect(screen.getAllByText('GST included').length).toBeGreaterThan(0);
    expect(screen.queryByText(/service charge/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('$70.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/Payment is completed separately through IdealPOS\/EFTPOS\./i)).toBeInTheDocument();

    // The Order Tablet never processes payment: no Card/Cash/split/Pay/
    // Charge control exists anywhere on this screen, before or after
    // submission.
    expect(screen.queryByRole('button', { name: /^Card$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cash$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Charge/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Payment · Table/)).not.toBeInTheDocument();
  });

  it('never claims a physical KOT was printed when no PrinterJob exists for this venue — for a venue with no real POS integration, it truthfully says no printer is configured, not "Printed"', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG, 'not_applicable');
    renderTablet();

    await selectTableAndStartOrder();
    await addTestItemToCart();
    fireEvent.click(await screen.findByRole('button', { name: /Send to kitchen/i }));

    await waitFor(() => expect(screen.getByText('No printer configured for this venue.')).toBeInTheDocument());
    expect(screen.queryByText('Printed')).not.toBeInTheDocument();
  });

  it('never claims a physical KOT was printed for a venue on the real IdealPOS Bridge either — no Verdura PrinterJob exists there by design (IdealPOS owns kitchen-ticket printing), and the screen says so instead of a generic/absent-sounding message', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG, 'synced');
    renderTablet();

    await selectTableAndStartOrder();
    await addTestItemToCart();
    fireEvent.click(await screen.findByRole('button', { name: /Send to kitchen/i }));

    await waitFor(() =>
      expect(
        screen.getByText('Kitchen ticket is produced by IdealPOS once it confirms this order — see Idealpos status above.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('No printer configured for this venue.')).not.toBeInTheDocument();
    expect(screen.queryByText('Printed')).not.toBeInTheDocument();
  });

  it('fails safely — disables charging and shows a clear message — for an unsupported venue tax configuration', async () => {
    installFetchMock(UNSUPPORTED_TAX_CONFIG);
    renderTablet();

    await selectTableAndStartOrder();
    await addTestItemToCart();

    await waitFor(() =>
      expect(screen.getAllByText(/Unable to calculate a safe total/i).length).toBeGreaterThan(0),
    );
    const chargeButton = await screen.findByRole('button', { name: /Totals unavailable/i });
    expect(chargeButton).toBeDisabled();
  });

  it('rotates the idempotency key when starting a new order at a different table -- never reuses one key across two different orders', async () => {
    // Regression test for a real defect found during Story 15-5 real-browser
    // verification (2026-08-20): orderIdempotencyKey was only rotated by
    // handleReset (reachable after a full payment cycle at the SAME table),
    // so starting a second order at a DIFFERENT table while an earlier
    // order was still pending reused the stale key -- the backend correctly
    // rejected the second table's submission with an
    // idempotencyKey-already-used-for-a-different-order ConflictException,
    // silently blocking ordinary concurrent-table service.
    const { calls } = installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    await selectTableAndStartOrder(); // Table 1
    await addTestItemToCart();
    fireEvent.click(await screen.findByRole('button', { name: /Send to kitchen/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST')).toBe(true);
    });
    const firstSubmit = calls.find((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST')!;
    const firstKey = (JSON.parse(firstSubmit.init!.body as string) as { idempotencyKey: string }).idempotencyKey;

    // Back to the floor plan: this suite's useLiveOrders mock always
    // returns an empty list (it never reflects the just-created order back
    // into `orders`, unlike the real query cache in production), so the
    // Order Status screen's own resync effect can revert createdOrderRef to
    // null here -- landing back on "Review Order" (‹ Back to order) rather
    // than "Order Status" (‹ Back to floor plan). Either back button reaches
    // the floor plan; go via whichever is actually present rather than
    // asserting which one.
    const backButton = await screen.findByRole('button', { name: /Back to floor plan|Back to order/i });
    fireEvent.click(backButton);
    if (/Back to order/i.test(backButton.textContent ?? '')) {
      fireEvent.click(await screen.findByRole('button', { name: /Home/i }));
    }
    const table2Button = await screen.findByRole('button', { name: 'T22 seats' });
    fireEvent.click(table2Button);
    fireEvent.click(await screen.findByRole('button', { name: '+' }));
    fireEvent.click(await screen.findByRole('button', { name: /Start order/i }));
    await addTestItemToCart();
    fireEvent.click(await screen.findByRole('button', { name: /Send to kitchen/i }));

    await waitFor(() => {
      const submits = calls.filter((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
      expect(submits).toHaveLength(2);
    });
    const submits = calls.filter((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
    const secondKey = (JSON.parse(submits[1].init!.body as string) as { idempotencyKey: string }).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it('recomputes identically across a re-render with the same cart (reload/recalculation consistency)', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    const { rerender } = renderTablet();

    await selectTableAndStartOrder();
    await addTestItemToCart();

    await waitFor(() => expect(screen.getAllByText('$70.00').length).toBeGreaterThan(0));
    const before = screen.getByText('$9.13').textContent;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <OrderTabletPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Re-rendering the same mounted instance must not change the figures —
    // this component intentionally keeps its own cart state, so this proves
    // the calculation is a pure function of that state, not incidental render order.
    expect(within(document.body).getByText('$9.13').textContent).toBe(before);
  });
});

// DL-087: the Order Tablet never processes payment. Guest/customer mode's
// primary action is Send to Kitchen, reached via a two-step Review Order ->
// Send to Kitchen flow (distinct from staff's single-step submit-from-cart)
// -- these tests exercise that path explicitly, since the other describe
// blocks in this file default to staff mode. Uses the standalone tablet
// route so "Guest mode" reflects the real, restricted /api/tablet/orders
// customer identity (Story 15-1) — on the embedded Admin Console route the
// guest/staff toggle is not rendered at all, since that route is always a
// full staff JWT session.
describe('OrderTabletPage — customer/guest order-entry-only flow (DL-087 payment removal)', () => {
  async function switchToGuestModeAndStartOrder() {
    fireEvent.click(await screen.findByRole('button', { name: /^Guest mode$/ }));
    const tableButton = await screen.findByRole('button', { name: 'T12 seats' });
    fireEvent.click(tableButton);
    fireEvent.click(await screen.findByRole('button', { name: '+' }));
    fireEvent.click(await screen.findByRole('button', { name: /Start order/i }));
  }

  it('customer mode submits a valid order via Review Order -> Send to Kitchen, with no payment step before or after', async () => {
    seedEnrolledDevice();
    const { calls } = installStandaloneFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderStandaloneTablet();

    await switchToGuestModeAndStartOrder();
    await addTestItemToCart();

    // No payment control is reachable from the cart-building screen either.
    expect(screen.queryByRole('button', { name: /^Card$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cash$/i })).not.toBeInTheDocument();

    const reviewButton = await screen.findByRole('button', { name: /^Review order$/i });
    fireEvent.click(reviewButton);

    await waitFor(() => expect(screen.getByText(/Review Order · Table/)).toBeInTheDocument());
    expect(screen.getByText(/Payment is completed separately through IdealPOS\/EFTPOS\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Card$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cash$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Charge/i })).not.toBeInTheDocument();

    const sendButton = await screen.findByRole('button', { name: /^Send to Kitchen$/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      const submits = calls.filter((c) => c.url.includes('/api/tablet/orders') && c.init?.method === 'POST');
      expect(submits).toHaveLength(1);
    });
    // Restricted/customer identity, never the staff-tier endpoint.
    expect(calls.some((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST')).toBe(false);
    // The action never navigates to any payment-named screen or route.
    expect(screen.queryByText(/^Payment · Table/)).not.toBeInTheDocument();
  });

  it('rapid double-click on Send to Kitchen creates exactly one order', async () => {
    seedEnrolledDevice();
    const { calls } = installStandaloneFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderStandaloneTablet();

    await switchToGuestModeAndStartOrder();
    await addTestItemToCart();
    fireEvent.click(await screen.findByRole('button', { name: /^Review order$/i }));

    const sendButton = await screen.findByRole('button', { name: /^Send to Kitchen$/i });
    // Fire both clicks before either await resolves -- the button disables
    // itself via isSubmittingOrder on the first click, so the second is a
    // no-op rather than a second submission.
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => {
      const submits = calls.filter((c) => c.url.includes('/api/tablet/orders') && c.init?.method === 'POST');
      expect(submits.length).toBeGreaterThan(0);
    });
    const submits = calls.filter((c) => c.url.includes('/api/tablet/orders') && c.init?.method === 'POST');
    expect(submits).toHaveLength(1);
  });
});

describe('OrderTabletPage — Story 15-1 device identity, restricted mode, and staff elevation', () => {
  it('restricted/customer-context ordering (no elevation) submits through the purpose-built /api/tablet/orders endpoint, never /api/admin/orders', async () => {
    seedEnrolledDevice();
    const { calls } = installStandaloneFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderStandaloneTablet();

    await selectTableAndStartOrder();
    await addTestItemToCart();

    const sendButton = await screen.findByRole('button', { name: /Send to kitchen/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      const submit = calls.find((c) => c.init?.method === 'POST' && c.url.includes('/orders') && !c.url.includes('elevate'));
      expect(submit).toBeDefined();
    });

    const restrictedSubmit = calls.find((c) => c.url.includes('/api/tablet/orders') && c.init?.method === 'POST');
    const staffSubmit = calls.find((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
    expect(restrictedSubmit).toBeDefined();
    expect(staffSubmit).toBeUndefined();

    // The device Bearer token was used, never a fabricated/absent one.
    expect((restrictedSubmit!.init!.headers as Record<string, string>).Authorization).toBe('Bearer device.jwt.token');
    // No venueId is client-supplied on the restricted contract — it comes
    // only from the device token server-side.
    const body = JSON.parse(restrictedSubmit!.init!.body as string);
    expect(body).not.toHaveProperty('venueId');
  });

  it('an incorrect staff PIN does not elevate the session, and a subsequent order still uses the restricted endpoint', async () => {
    seedEnrolledDevice();
    const { calls } = installStandaloneFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderStandaloneTablet();

    fireEvent.click(await screen.findByRole('button', { name: /^Staff mode$/ }));
    fireEvent.change(await screen.findByPlaceholderText('PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));

    await waitFor(() => expect(screen.getByText('Incorrect PIN.')).toBeInTheDocument());
    expect(useTabletDeviceAuthStore.getState().staffToken).toBeNull();

    await selectTableAndStartOrder();
    await addTestItemToCart();
    fireEvent.click(await screen.findByRole('button', { name: /Send to kitchen/i }));

    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/tablet/orders'))).toBe(true));
    expect(calls.some((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST')).toBe(false);
  });

  it('a correct staff PIN elevates the session, shows the real staff name, and routes subsequent orders through /api/admin/orders with staff attribution', async () => {
    seedEnrolledDevice();
    const { calls } = installStandaloneFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderStandaloneTablet();

    fireEvent.click(await screen.findByRole('button', { name: /^Staff mode$/ }));
    fireEvent.change(await screen.findByPlaceholderText('PIN'), { target: { value: '4242' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));

    await waitFor(() => expect(screen.getByText('Alex Cashier')).toBeInTheDocument());
    expect(useTabletDeviceAuthStore.getState().staffToken).not.toBeNull();

    await selectTableAndStartOrder();
    await addTestItemToCart();
    fireEvent.click(await screen.findByRole('button', { name: /Send to kitchen/i }));

    await waitFor(() => {
      const submit = calls.find((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
      expect(submit).toBeDefined();
    });
    const submit = calls.find((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST')!;
    expect((submit.init!.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    expect((submit.init!.headers as Record<string, string>).Authorization).not.toBe('Bearer device.jwt.token');
  });

  it('explicit lock ends the elevated session and returns to restricted mode', async () => {
    seedEnrolledDevice();
    installStandaloneFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderStandaloneTablet();

    fireEvent.click(await screen.findByRole('button', { name: /^Staff mode$/ }));
    fireEvent.change(await screen.findByPlaceholderText('PIN'), { target: { value: '4242' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));
    await waitFor(() => expect(screen.getByText('Alex Cashier')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^Lock$/ }));

    await waitFor(() => expect(screen.queryByText('Alex Cashier')).not.toBeInTheDocument());
    expect(useTabletDeviceAuthStore.getState().staffToken).toBeNull();
    expect(screen.getByText(/Restricted mode/i)).toBeInTheDocument();
  });
});

// Story 15-3: authoritative modifier groups, required-selection enforcement,
// and removal of the fictional VERDURA10 promo. A separate seed (not
// seedMenuStore's plain 'Test Kebab', which many pre-existing tests rely on
// staying modifier-free) gives one real item a real, ID-bearing modifier
// catalog — never inferred from its category/subCategory/title.
function seedMenuStoreWithModifiers() {
  useMenuStore.setState({
    resolvedCategories: [
      { id: 'cat-1', name: 'Mains', description: null, imageUrl: null, sortOrder: 0, isActive: true, subs: [] },
    ],
    resolvedItems: [
      {
        id: 'item-2',
        categoryId: 'cat-1',
        subCategory: null,
        title: 'Test Mezze Board',
        description: 'A test item with real modifiers',
        imageUrl: null,
        price: '$70.00',
        nutritionalDetails: { tags: [], isFeatured: false } as never,
        modifierGroups: [
          {
            // maxSelections > 1 deliberately: a required *single*-select
            // group gets a sane pre-selected default (see
            // OrderTabletPage.handleOpenSlide), so it can never actually be
            // caught in a "blocked" state by these tests — this group can.
            id: 'group-sauce',
            name: 'Sauce',
            required: true,
            minSelections: 1,
            maxSelections: 2,
            options: [
              { id: 'opt-garlic', name: 'Toum Garlic Paste', priceDeltaCents: 50, isAvailable: true, sortOrder: 0 },
              { id: 'opt-none', name: 'No Sauce', priceDeltaCents: 0, isAvailable: true, sortOrder: 1 },
            ],
          },
          {
            id: 'group-extras',
            name: 'Extras',
            required: false,
            minSelections: 0,
            maxSelections: 1,
            options: [
              { id: 'opt-pita', name: 'Extra Pita', priceDeltaCents: 150, isAvailable: true, sortOrder: 0 },
              { id: 'opt-retired', name: 'Retired Extra', priceDeltaCents: 100, isAvailable: false, sortOrder: 1 },
            ],
          },
        ],
        isSpicy: false,
        isAvailable: true,
        sortOrder: 0,
      },
    ],
    resolvedLoading: false,
    resolvedLoaded: true,
    resolvedError: null,
    fetchResolvedMenu: vi.fn().mockResolvedValue(undefined),
  } as never);
}

async function openMezzeBoardCustomizer() {
  const itemCard = await screen.findByText('Test Mezze Board');
  fireEvent.click(itemCard);
  await screen.findByRole('button', { name: /Complete required selections|^Add \d/ });
}

describe('OrderTabletPage — Story 15-3 authoritative modifiers', () => {
  beforeEach(() => {
    seedMenuStoreWithModifiers();
  });

  it('renders the real, ID-backed modifier groups — no category/name-substring-inferred catalog', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();
    await selectTableAndStartOrder();

    await openMezzeBoardCustomizer();

    expect(screen.getByText('Sauce')).toBeInTheDocument();
    expect(screen.getByText('Extras')).toBeInTheDocument();
    expect(screen.getByText('Toum Garlic Paste')).toBeInTheDocument();

    // Regression guard: none of the old hardcoded/inferred catalogue names
    // ever appear — this item's real data has no "Preparation"/"Medium
    // Well"/"Sauces & Dips" group, which the deleted getModifierGroupsForItem
    // used to fabricate for every non-drink, non-pizza item regardless of
    // what it actually was.
    expect(screen.queryByText('Preparation')).not.toBeInTheDocument();
    expect(screen.queryByText('Medium Well')).not.toBeInTheDocument();
    expect(screen.queryByText('Sauces & Dips')).not.toBeInTheDocument();
  });

  it('blocks "Add" until the required group has a selection, then allows it once satisfied', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();
    await selectTableAndStartOrder();
    await openMezzeBoardCustomizer();

    const addButton = screen.getByRole('button', { name: /Complete required selections/i });
    expect(addButton).toBeDisabled();
    expect(screen.getByText(/"Sauce" requires a selection/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('No Sauce'));

    const enabledAddButton = await screen.findByRole('button', { name: /^Add 1/ });
    expect(enabledAddButton).not.toBeDisabled();
  });

  it('disables an unavailable option — it cannot be selected', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();
    await selectTableAndStartOrder();
    await openMezzeBoardCustomizer();

    const retiredButton = screen.getByText('Retired Extra').closest('button');
    expect(retiredButton).toBeDisabled();
  });

  it('THE $0.50 DEFECT REGRESSION: a real +$0.50 modifier displays correctly and the submitted payload carries only ids — never a name or a client-calculated price', async () => {
    const { calls } = installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();
    await selectTableAndStartOrder();
    await openMezzeBoardCustomizer();

    fireEvent.click(screen.getByText('Toum Garlic Paste'));
    const addButton = await screen.findByRole('button', { name: /^Add 1/ });
    // $70.00 base + $0.50 modifier = $70.50, shown on the Add button itself.
    expect(addButton.textContent).toContain('70.50');
    fireEvent.click(addButton);

    const sendButton = await screen.findByRole('button', { name: /Send to kitchen/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      const orderCall = calls.find(c => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
      expect(orderCall).toBeDefined();
      const body = JSON.parse(orderCall!.init!.body as string);
      const line = body.items[0];
      expect(line.selectedModifiers).toEqual([{ modifierGroupId: 'group-sauce', optionId: 'opt-garlic' }]);
      // No name, no priceDeltaCents anywhere in the submitted modifier —
      // the server resolves both from authoritative data, never a client
      // value (this is the actual fix for the $0.50-displayed/$0-persisted
      // defect: there is no client-supplied price left to be ignored).
      expect(line.selectedModifiers[0]).not.toHaveProperty('name');
      expect(line.selectedModifiers[0]).not.toHaveProperty('priceDeltaCents');
      expect(line.expectedUnitPriceCents).toBe(7050);
    });
  });

  it('no trace of the removed VERDURA10 promo UI remains anywhere on the order screen', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();
    await selectTableAndStartOrder();

    expect(screen.queryByText(/VERDURA10/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Add promo code/i)).not.toBeInTheDocument();
  });
});

// Story 15-13: dine-in and takeaway service mode.
async function startTakeawayOrder() {
  fireEvent.click(await screen.findByRole('button', { name: /^Takeaway$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^Start takeaway order$/i }));
}

describe('OrderTabletPage — Story 15-13 dine-in and takeaway service mode', () => {
  it('renders a dine-in/takeaway mode toggle on the floor screen, defaulting to dine-in', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    const dineInToggle = await screen.findByRole('button', { name: /^Dine-in$/i });
    const takeawayToggle = await screen.findByRole('button', { name: /^Takeaway$/i });
    expect(dineInToggle).toHaveAttribute('aria-pressed', 'true');
    expect(takeawayToggle).toHaveAttribute('aria-pressed', 'false');
    // Dine-in table selection is still present and untouched by default.
    expect(await screen.findByText('Select a table')).toBeInTheDocument();
  });

  it('takeaway mode bypasses table selection entirely -- no table button is required to reach the cart', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    fireEvent.click(await screen.findByRole('button', { name: /^Takeaway$/i }));
    expect(screen.getByText('No table required for takeaway')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'T12 seats' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /^Start takeaway order$/i }));

    // Lands directly on the cart/order screen with a truthful "Takeaway
    // order" header -- never a fabricated "Table" label.
    expect(await screen.findByText('Takeaway order')).toBeInTheDocument();
    expect(screen.queryByText(/^Table \d/)).not.toBeInTheDocument();
    // Seat strip (a dine-in-only concept) is not rendered for takeaway.
    expect(screen.queryByText('Ordering for')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ Seat/i })).not.toBeInTheDocument();
  });

  it('the review screen shows "Takeaway" (never a table label), and the submitted payload carries serviceMode: takeaway with no tableId', async () => {
    const { calls } = installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    await startTakeawayOrder();
    await addTestItemToCart();

    const sendButton = await screen.findByRole('button', { name: /Send to kitchen/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      const submit = calls.find((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
      expect(submit).toBeDefined();
    });
    const submit = calls.find((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST')!;
    const body = JSON.parse(submit.init!.body as string);
    expect(body.serviceMode).toBe('takeaway');
    expect(body).not.toHaveProperty('tableId');

    // Order Status screen shows the server-issued reference, never a table.
    await waitFor(() => expect(screen.getByText(/Order Status · Takeaway/)).toBeInTheDocument());
    expect(screen.getAllByText(/TA-100001/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Table \d/)).not.toBeInTheDocument();

    // The Order Tablet never processes payment, in takeaway mode either.
    expect(screen.queryByRole('button', { name: /^Card$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cash$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Charge/i })).not.toBeInTheDocument();
  });

  it('switching from dine-in (table selected) to takeaway clears the selected table -- the dine-in table panel disappears, never a stale table carried into the takeaway order', async () => {
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    // Select a dine-in table (without starting the order yet).
    const tableButton = await screen.findByRole('button', { name: 'T12 seats' });
    fireEvent.click(tableButton);
    expect(await screen.findByText('Selected table')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /^Takeaway$/i }));
    expect(screen.queryByText('Selected table')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /^Start takeaway order$/i }));
    expect(await screen.findByText('Takeaway order')).toBeInTheDocument();
  });

  it('rapid double-click on Send to Kitchen for a takeaway order creates exactly one order', async () => {
    const { calls } = installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
    renderTablet();

    await startTakeawayOrder();
    await addTestItemToCart();

    const sendButton = await screen.findByRole('button', { name: /Send to kitchen/i });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => {
      const submits = calls.filter((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
      expect(submits.length).toBeGreaterThan(0);
    });
    const submits = calls.filter((c) => c.url.includes('/api/admin/orders') && c.init?.method === 'POST');
    expect(submits).toHaveLength(1);
  });

  it('a failed takeaway submission preserves the cart and shows a recoverable error, never silently drops items', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/tax-config')) return new Response(JSON.stringify(NZ_SUPPORTED_TAX_CONFIG), { status: 200 });
      if (url.includes('/tables') && !url.includes('orders')) {
        return new Response(JSON.stringify([{ id: 'real-table-1', tableNumber: '1', name: null, capacity: 4 }]), { status: 200 });
      }
      if (url.includes('/api/admin/orders') && init?.method === 'POST') {
        return new Response(JSON.stringify({}), { status: 500 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTablet();

    await startTakeawayOrder();
    await addTestItemToCart();

    fireEvent.click(await screen.findByRole('button', { name: /Send to kitchen/i }));

    await waitFor(() => expect(screen.getByText(/Failed to send order/i)).toBeInTheDocument());
    // Still on the cart/order screen -- a failed submission never advances
    // to Order Status, and the cart (still holding the added item) is not
    // reset or silently discarded; the same action remains available to retry.
    expect(screen.getByText('Takeaway order')).toBeInTheDocument();
    expect(screen.queryByText(/Order Status/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Send to kitchen/i })).toBeInTheDocument();
  });
});

// Menu-card presentation fix: alphabetical ordering (never the admin-editable
// `sortOrder` field) and a consistent, always-branded image fallback for
// missing or failed-to-load images. Seeds its own categories/items per test
// rather than reusing seedMenuStore()'s single item, since these tests are
// specifically about relative ordering and image states across several items.
describe('OrderTabletPage — menu-card sorting and images', () => {
  function seedMultiItemMenu() {
    useMenuStore.setState({
      resolvedCategories: [
        { id: 'cat-mains', name: 'Mains', description: null, imageUrl: null, sortOrder: 0, isActive: true, subs: [] },
        { id: 'cat-salads', name: 'Salads', description: null, imageUrl: null, sortOrder: 1, isActive: true, subs: [] },
      ],
      resolvedItems: [
        // Mains — sortOrder deliberately reversed relative to alphabetical
        // order, and deliberately mixed-case, so a sortOrder-based or a
        // naive case-sensitive comparator would both produce the wrong order.
        { id: 'm-zebra', categoryId: 'cat-mains', subCategory: null, title: 'zebra kebab', description: '', imageUrl: null, price: '20', nutritionalDetails: { tags: [], isFeatured: false } as never, modifierGroups: [], isSpicy: false, isAvailable: true, sortOrder: 0 },
        { id: 'm-apple', categoryId: 'cat-mains', subCategory: null, title: 'Apple Salad Skewer', description: '', imageUrl: null, price: '21', nutritionalDetails: { tags: [], isFeatured: false } as never, modifierGroups: [], isSpicy: false, isAvailable: true, sortOrder: 3 },
        { id: 'm-cherry', categoryId: 'cat-mains', subCategory: null, title: 'Cherry Bowl', description: '', imageUrl: null, price: '22', nutritionalDetails: { tags: [], isFeatured: false } as never, modifierGroups: [], isSpicy: false, isAvailable: true, sortOrder: 1 },
        { id: 'm-banana', categoryId: 'cat-mains', subCategory: null, title: 'banana Wrap', description: '', imageUrl: null, price: '23', nutritionalDetails: { tags: [], isFeatured: false } as never, modifierGroups: [], isSpicy: false, isAvailable: true, sortOrder: 2 },
        // Salads — a lower sortOrder than some Mains items, so a flat
        // sortOrder sort would interleave it into the middle of Mains; the
        // authoritative category order (Mains, then Salads) must still win.
        { id: 's-fresh', categoryId: 'cat-salads', subCategory: null, title: 'Fresh Garden Salad', description: '', imageUrl: 'https://example.com/fresh.jpg', price: '15', nutritionalDetails: { tags: [], isFeatured: false } as never, modifierGroups: [], isSpicy: false, isAvailable: true, sortOrder: 0 },
        { id: 's-avocado', categoryId: 'cat-salads', subCategory: null, title: 'avocado Salad', description: '', imageUrl: null, price: '16', nutritionalDetails: { tags: [], isFeatured: false } as never, modifierGroups: [], isSpicy: false, isAvailable: true, sortOrder: 1 },
      ],
      resolvedLoading: false,
      resolvedLoaded: true,
      resolvedError: null,
      fetchResolvedMenu: vi.fn().mockResolvedValue(undefined),
    } as never);
  }

  // Walks up from an item's name text node to the clickable card container
  // (name -> name/price row -> padding wrapper -> card), matching the fixed
  // DOM structure the item grid renders each card with.
  function cardFor(name: string): HTMLElement {
    const nameEl = screen.getByText(name);
    const card = nameEl.parentElement?.parentElement?.parentElement;
    if (!card) throw new Error(`Could not locate card container for "${name}"`);
    return card;
  }

  beforeEach(() => {
    seedMultiItemMenu();
    seedReservationStore();
    resetTabletDeviceAuth();
    installFetchMock(NZ_SUPPORTED_TAX_CONFIG);
  });

  it('sorts items alphabetically by name within a category, case-insensitively — never by sortOrder', async () => {
    renderTablet();
    await selectTableAndStartOrder();

    const grid = (await screen.findByText('zebra kebab')).closest('[style*="grid-template-columns"]');
    expect(grid).toBeTruthy();
    const names = within(grid as HTMLElement)
      .getAllByText(/Salad Skewer|Cherry Bowl|banana Wrap|zebra kebab|Fresh Garden Salad|avocado Salad/)
      .map((el) => el.textContent);

    // Mains (A→Z, case-insensitive): Apple, banana, Cherry, zebra.
    // Salads (A→Z, case-insensitive): avocado, Fresh — and the whole Salads
    // group must still come after the whole Mains group (category order
    // preserved), even though 's-fresh' has a lower sortOrder than three of
    // the Mains items above.
    expect(names).toEqual([
      'Apple Salad Skewer',
      'banana Wrap',
      'Cherry Bowl',
      'zebra kebab',
      'avocado Salad',
      'Fresh Garden Salad',
    ]);
  });

  it('keeps identical ordering across a re-render (category switch and back)', async () => {
    renderTablet();
    await selectTableAndStartOrder();

    const readOrder = () => {
      const grid = document.querySelector('[style*="grid-template-columns"]') as HTMLElement;
      return within(grid).getAllByText(/Salad Skewer|Cherry Bowl|banana Wrap|zebra kebab/).map((el) => el.textContent);
    };
    const initial = readOrder();

    // Switch to Salads and back to All Items — a fresh computation each time.
    fireEvent.click(await screen.findByText('Salads'));
    fireEvent.click(await screen.findByText('All Items'));

    expect(await screen.findByText('zebra kebab')).toBeInTheDocument();
    expect(readOrder()).toEqual(initial);
  });

  it('renders a configured image with correct src and accessible alt text, no fallback shown', async () => {
    renderTablet();
    await selectTableAndStartOrder();

    const card = cardFor('Fresh Garden Salad');
    const img = within(card).getByRole('img', { name: 'Fresh Garden Salad' }) as HTMLImageElement;
    expect(img.src).toBe('https://example.com/fresh.jpg');
    expect(within(card).queryByText('VERDURA KITCHEN')).not.toBeInTheDocument();
  });

  it('shows the branded fallback, never a broken-image state, when an item has no configured image', async () => {
    renderTablet();
    await selectTableAndStartOrder();

    const card = cardFor('avocado Salad');
    expect(within(card).getByText('VERDURA KITCHEN')).toBeInTheDocument();
    expect(within(card).queryByRole('img', { name: 'avocado Salad' })).not.toBeInTheDocument();
  });

  it('falls back to the branded placeholder when a configured image URL fails to load', async () => {
    renderTablet();
    await selectTableAndStartOrder();

    const card = cardFor('Fresh Garden Salad');
    const img = within(card).getByRole('img', { name: 'Fresh Garden Salad' });
    expect(within(card).queryByText('VERDURA KITCHEN')).not.toBeInTheDocument();

    // Simulate the real browser firing a load failure (stale/broken GCS URL,
    // private object, network error, ...) on the <img> itself.
    fireEvent.error(img);

    await waitFor(() => expect(within(card).getByText('VERDURA KITCHEN')).toBeInTheDocument());
    expect(within(card).queryByRole('img', { name: 'Fresh Garden Salad' })).not.toBeInTheDocument();
  });
});

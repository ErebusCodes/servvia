/**
 * THE ORDER TABLET, ON THE NATIVE IDEALPOS PATH.
 *
 * The API-side specs prove what reaches the till. These prove what the SCREEN
 * does, which is a different question with its own way of going wrong:
 *
 *   * does Send to Kitchen actually call the round endpoint, or does it still
 *     believe creating the order was the send?
 *   * can a waiter add a second course to an open table at all - the hard stop
 *     this work exists to remove?
 *   * and, the one that matters most: after a round the till did not answer,
 *     does the screen make pressing Send again IMPOSSIBLE, rather than merely
 *     inadvisable?
 *
 * THAT LAST ONE IS THE WHOLE POINT. An uncertain round may already be on the
 * table. A waiter who taps again puts a second Lamb Shank on a real customer's
 * real bill, and nobody finds out until the docket prints. A red message is not
 * enough; the button has to be dead.
 *
 * A LEGACY VENUE MUST BE COMPLETELY UNAFFECTED, and that is asserted here too -
 * with IDEALPOS_POS_STRATEGY unset the server marks orders `webit`, this screen
 * never calls the round endpoint, and the pre-existing behaviour stands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }),
}));

const useLiveOrdersMock = vi.fn(() => ({
  data: [] as unknown[],
  isRealtimeConnected: true,
  ordersDataIsAuthoritative: true,
}));
vi.mock('../../shared/orders', async () => {
  const actual = await vi.importActual<typeof import('../../shared/orders')>('../../shared/orders');
  return { ...actual, useLiveOrders: () => useLiveOrdersMock() };
});

const { useMenuStore } = await import('../../store/menu.store');
const { useReservationStore } = await import('../../store/reservation.store');
const { useTabletDeviceAuthStore } = await import('../../store/tabletDeviceAuth.store');
const { useAuthStore } = await import('../../store/auth.store');
const { OrderTabletPage } = await import('./OrderTabletPage');

const NZ_TAX = { currency: 'NZD', taxJurisdiction: 'NZ_GST', pricesIncludeTax: true, taxRateBps: 1500 };

interface FetchCall {
  url: string;
  init?: RequestInit;
}

/** One round response, in the exact shape the real handler returns. */
interface RoundReply {
  status: number;
  body: Record<string, unknown>;
}

const ACCEPTED = (sequence: number): RoundReply => ({
  status: 202,
  body: {
    roundId: `round-${sequence}`,
    sequence,
    status: 'sentAwaitingConfirmation',
    message: 'Sent to IdealPOS. Waiting for the till to confirm the round landed on the table.',
    safeToRetry: false,
    requiresReconciliation: false,
    replayed: false,
  },
});

/** The dangerous one: the bytes left and the till said nothing. */
const UNCERTAIN: RoundReply = {
  status: 409,
  body: {
    roundId: 'round-1',
    sequence: 1,
    status: 'uncertain',
    message:
      'This round MAY already be on the table in IdealPOS - the till did not answer clearly. ' +
      'DO NOT send it again. Check the table in IdealPOS before doing anything else.',
    safeToRetry: false,
    requiresReconciliation: true,
    replayed: false,
  },
};

/**
 * The rate limiter's refusal, which runs BEFORE the handler - so nothing was
 * sent - and whose wording is written for an auth route.
 */
const THROTTLED: RoundReply = {
  status: 429,
  body: {
    statusCode: 429,
    message: 'Too many requests, please try again later.',
    error: 'Too Many Requests',
  },
};

/** Provably nothing left the device - the one outcome that invites another try. */
const NEVER_SENT: RoundReply = {
  status: 503,
  body: {
    roundId: 'round-1',
    sequence: 1,
    status: 'failedBeforeSend',
    message:
      'The order was NOT sent - the till could not be reached and nothing left this device. ' +
      'It is safe to send again.',
    safeToRetry: true,
    requiresReconciliation: false,
    replayed: false,
  },
};

/**
 * The backend, as far as this screen can tell.
 *
 * `strategy` is what makes an order native, and it comes from the SERVER on
 * every order this mock hands back - exactly as the real API now does. Nothing
 * in the component is allowed to infer it.
 */
function installFetchMock(options: {
  strategy?: 'webit' | 'native_table_round';
  rounds?: RoundReply[];
  /**
   * What `GET /orders/:id/rounds` reports, read fresh on every poll.
   *
   * A mutable holder rather than a fixed list, because the behaviour under
   * test is a round CHANGING under the screen while nobody touches it - which
   * is the only way an escalation ever happens.
   */
  readback?: { rows: Record<string, unknown>[] };
}) {
  const calls: FetchCall[] = [];
  const strategy = options.strategy ?? 'native_table_round';
  const rounds = options.rounds ? [...options.rounds] : [];
  let roundSeq = 0;

  const order = (id: string, tableId: string, tableNumber: string) => ({
    id,
    venueId: 'venue-1',
    tableId,
    tableNumber,
    serviceMode: 'dine_in',
    takeawayReference: null,
    status: 'confirmed',
    source: 'staff',
    subtotalCents: 7000,
    taxCents: 913,
    totalCents: 7000,
    notes: null,
    submittedAt: new Date().toISOString(),
    items: [],
    posSyncRecord: {
      status: strategy === 'native_table_round' ? 'owned_by_native' : 'not_synced',
      attemptCount: 0,
      nextRetryAt: null,
      errorMessage: null,
      strategy,
    },
  });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url.includes('/tax-config')) return new Response(JSON.stringify(NZ_TAX), { status: 200 });
    if (url.includes('/tables') && !url.includes('/admin/orders')) {
      return new Response(
        JSON.stringify([
          { id: 'real-table-1', tableNumber: '1', name: null, capacity: 4 },
          { id: 'real-table-2', tableNumber: '2', name: null, capacity: 4 },
        ]),
        { status: 200 },
      );
    }

    // The READ side of the round endpoint. Answers with whatever the holder
    // currently says, so a test can escalate a round mid-service.
    if (/\/api\/admin\/orders\/[^/]+\/rounds$/.test(url) && init?.method !== 'POST') {
      return new Response(JSON.stringify({ rounds: options.readback?.rows ?? [] }), {
        status: 200,
      });
    }

    // The round endpoint - the thing under test.
    if (/\/api\/admin\/orders\/[^/]+\/rounds$/.test(url) && init?.method === 'POST') {
      roundSeq += 1;
      const reply = rounds.shift() ?? ACCEPTED(roundSeq);
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }

    if (url.includes('/api/admin/orders') && init?.method === 'POST') {
      const body = JSON.parse((init.body as string) ?? '{}') as { tableId?: string };
      const tableNumber = body.tableId === 'real-table-2' ? '2' : '1';
      return new Response(
        JSON.stringify(order(`order-${tableNumber}`, body.tableId ?? 'real-table-1', tableNumber)),
        { status: 201 },
      );
    }

    if (url.includes('/pos-sync')) {
      return new Response(
        JSON.stringify({
          orderId: 'order-1',
          status: strategy === 'native_table_round' ? 'owned_by_native' : 'not_synced',
        }),
        { status: 200 },
      );
    }
    if (url.includes('/print-jobs')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, order };
}

function roundCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter(
    (c) => /\/api\/admin\/orders\/[^/]+\/rounds$/.test(c.url) && c.init?.method === 'POST',
  );
}

function bodyOf(call: FetchCall): { items: { menuItemId: string }[]; requestKey: string } {
  return JSON.parse(call.init!.body as string);
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

/** Select table T<n>, set covers, and open the order screen. */
async function openTable(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: label }));
  fireEvent.click(await screen.findByRole('button', { name: '+' }));
  fireEvent.click(await screen.findByRole('button', { name: /Start order/i }));
}

/**
 * Tap the menu card, not the cart line.
 *
 * Once an item is in the cart its title appears twice - the menu grid and the
 * cart list. The menu card is always the first in document order; clicking the
 * cart line instead would open the line editor and add nothing.
 */
async function addItem() {
  const matches = await screen.findAllByText('Test Kebab');
  fireEvent.click(matches[0]);
}

async function pressSend() {
  const button = await screen.findByTestId('send-to-kitchen');
  fireEvent.click(button);
}

beforeEach(() => {
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
  useReservationStore.setState({ reservations: [] } as never);
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
  useLiveOrdersMock.mockReturnValue({
    data: [],
    isRealtimeConnected: true,
    ordersDataIsAuthoritative: true,
  });
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

// ═════════════════════════════════════════════════════════════════════════
describe('round one', () => {
  it('creates the order and then SENDS it through the round endpoint', async () => {
    const { calls } = installFetchMock({ strategy: 'native_table_round' });
    renderTablet();

    await openTable('T12 seats');
    await addItem();
    await pressSend();

    await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));

    // Creating the order is not the send on this path. Both calls happen, in
    // that order, and the round call is the one that reaches the till.
    const created = calls.find(
      (c) => c.url.endsWith('/api/admin/orders') && c.init?.method === 'POST',
    );
    expect(created).toBeDefined();
    expect(calls.indexOf(created!)).toBeLessThan(calls.indexOf(roundCalls(calls)[0]));

    // Round one carries NO items: the order was created with its lines
    // already, and sending them again here would double them.
    const body = bodyOf(roundCalls(calls)[0]);
    expect(body.items).toEqual([]);
    expect(typeof body.requestKey).toBe('string');
    expect(body.requestKey.length).toBeGreaterThanOrEqual(16);

    // And the screen says what actually happened - sent, not confirmed.
    const banner = await screen.findByTestId('native-round-banner');
    expect(banner).toHaveAttribute('data-round-status', 'sentAwaitingConfirmation');
    expect(banner.textContent).toMatch(/AWAITING TILL CONFIRMATION/i);
    expect(banner.textContent).not.toMatch(/confirmed by the till/i);
  });

  it('never calls the round endpoint for a legacy (webit) venue', async () => {
    const { calls } = installFetchMock({ strategy: 'webit' });
    renderTablet();

    await openTable('T12 seats');
    await addItem();
    await pressSend();

    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith('/api/admin/orders') && c.init?.method === 'POST'),
      ).toBe(true),
    );
    // The whole legacy path is untouched: creation IS the send, and no round
    // endpoint exists as far as this venue is concerned.
    expect(roundCalls(calls)).toHaveLength(0);
    expect(screen.queryByTestId('native-round-banner')).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a second and third round on an open table', () => {
  it('sends each further course as its own round, carrying only the new lines', async () => {
    const { calls, order } = installFetchMock({ strategy: 'native_table_round' });
    renderTablet();

    await openTable('T12 seats');
    await addItem();
    await pressSend();
    await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));

    // The table is now open with a live order, exactly as the live-orders
    // feed would report it after round one.
    useLiveOrdersMock.mockReturnValue({
      data: [order('order-1', 'real-table-1', '1')],
      isRealtimeConnected: true,
      ordersDataIsAuthoritative: true,
    });

    // ── ROUND 2. The waiter adds a course to the same open table. THIS IS
    //    THE HARD STOP THAT USED TO LIVE HERE. ──
    await addItem();
    await pressSend();
    await waitFor(() => expect(roundCalls(calls)).toHaveLength(2));

    expect(screen.queryByText(/isn't supported/i)).not.toBeInTheDocument();

    const second = bodyOf(roundCalls(calls)[1]);
    expect(second.items).toHaveLength(1);

    // ── ROUND 3. ──
    await addItem();
    await pressSend();
    await waitFor(() => expect(roundCalls(calls)).toHaveLength(3));
    expect(bodyOf(roundCalls(calls)[2]).items).toHaveLength(1);

    // EVERY PRESS MINTS ITS OWN KEY. Reusing one would have the server answer
    // a genuinely new course with the previous round's outcome and send
    // nothing - the food would never reach the kitchen.
    const keys = roundCalls(calls).map((c) => bodyOf(c).requestKey);
    expect(new Set(keys).size).toBe(3);

    // Every round went to the order that owns the table, never to a new one.
    for (const call of roundCalls(calls)) {
      expect(call.url).toContain('/api/admin/orders/order-1/rounds');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('an uncertain round', () => {
  it('surfaces UNCERTAIN and makes pressing Send again impossible, not merely inadvisable', async () => {
    const { calls, order } = installFetchMock({
      strategy: 'native_table_round',
      rounds: [UNCERTAIN],
    });
    renderTablet();

    await openTable('T12 seats');
    await addItem();
    await pressSend();
    await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));

    // ── The screen says the true thing, in the loudest available register. ──
    const banner = await screen.findByTestId('native-round-banner');
    expect(banner).toHaveAttribute('data-requires-reconciliation', 'true');
    expect(banner.textContent).toMatch(/UNCERTAIN/);
    expect(banner.textContent).toMatch(/DO NOT SEND AGAIN/i);

    // ── AND THE BUTTON IS DEAD. This is the assertion that matters. ──
    const button = await screen.findByTestId('send-to-kitchen');
    expect(button).toBeDisabled();
    expect(button.textContent).toMatch(/Resolve the uncertain round/i);

    // Even if something did click it, nothing more may leave.
    useLiveOrdersMock.mockReturnValue({
      data: [order('order-1', 'real-table-1', '1')],
      isRealtimeConnected: true,
      ordersDataIsAuthoritative: true,
    });
    await addItem();
    fireEvent.click(button);
    await new Promise((r) => setTimeout(r, 30));
    expect(roundCalls(calls)).toHaveLength(1);
  });

  it('does NOT block the table after a round that provably never left the device', async () => {
    const { calls } = installFetchMock({
      strategy: 'native_table_round',
      rounds: [NEVER_SENT],
    });
    renderTablet();

    await openTable('T12 seats');
    await addItem();
    await pressSend();
    await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));

    const banner = await screen.findByTestId('native-round-banner');
    expect(banner).toHaveAttribute('data-requires-reconciliation', 'false');
    expect(banner.textContent).toMatch(/NOT SENT/i);

    // Nothing was sent, so trying again is exactly right - and the lines are
    // still unsent, so the button has something to send.
    const button = await screen.findByTestId('send-to-kitchen');
    expect(button).not.toBeDisabled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('the banner tracks the till, not just the send', () => {
  /**
   * THE SEND'S ANSWER HAS A SHELF LIFE, AND NOTHING USED TO NOTICE.
   *
   * `POST /rounds` can never report better than "sent, awaiting the till" - the
   * receiver ACKs before durable processing. Everything after that is
   * reconciliation's: it confirms a round against the till's own token, or,
   * when nothing ever confirms it, escalates it to unresolved so a human looks.
   *
   * Before the readback poll existed, that escalation changed a row this screen
   * never read. So the waiter went on being told "SENT - AWAITING TILL
   * CONFIRMATION" for the rest of the night about a round the server had
   * already given up on - and, worse, the Send button stayed alive.
   */

  /** One escalated round, exactly as the read route reports it. */
  const ESCALATED = (roundId: string, sequence: number) => ({
    roundId,
    sequence,
    state: 'unresolved',
    status: 'unresolved',
    message:
      'This round may be on the table and may not be - nobody knows. ' +
      'DO NOT send it again. Check the table in IdealPOS, or ask a manager.',
    requiresReconciliation: true,
    settled: false,
    sendInitiatedAt: new Date().toISOString(),
    lineCount: 1,
  });

  it('goes red on its own, and kills the button, when the server escalates the round', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const readback = { rows: [] as Record<string, unknown>[] };
      const { calls } = installFetchMock({ strategy: 'native_table_round', readback });
      renderTablet();

      await openTable('T12 seats');
      await addItem();
      await pressSend();
      await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));

      // The send's own answer: blue, and the table is not blocked.
      const sent = await screen.findByTestId('native-round-banner');
      expect(sent).toHaveAttribute('data-round-tone', 'info');
      expect(sent.textContent).toMatch(/AWAITING TILL CONFIRMATION/i);

      // ── Nobody touches the tablet. The till never confirms. The server's
      //    reconciliation sweep gives up and escalates the round. ──
      readback.rows = [ESCALATED('round-1', 1)];
      await vi.advanceTimersByTimeAsync(3200);

      // ── THE POINT. The screen changed its mind without a single tap. ──
      await waitFor(() => {
        const banner = screen.getByTestId('native-round-banner');
        expect(banner).toHaveAttribute('data-requires-reconciliation', 'true');
      });
      const banner = screen.getByTestId('native-round-banner');
      expect(banner).toHaveAttribute('data-round-tone', 'danger');
      expect(banner.textContent).toMatch(/UNCERTAIN/);
      expect(banner.textContent).toMatch(/DO NOT SEND AGAIN/i);

      // And the button is dead, exactly as it would have been had the send
      // itself come back uncertain. A round that became a human's problem five
      // minutes late is no less a human's problem.
      const button = await screen.findByTestId('send-to-kitchen');
      expect(button).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns green only when the till is proven to hold the round', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const readback = { rows: [] as Record<string, unknown>[] };
      const { calls } = installFetchMock({ strategy: 'native_table_round', readback });
      renderTablet();

      await openTable('T12 seats');
      await addItem();
      await pressSend();
      await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));

      // Green is unreachable from a send and reachable only from here -
      // reconciliation having seen the till hold OUR token against OUR device.
      readback.rows = [
        {
          ...ESCALATED('round-1', 1),
          state: 'confirmed',
          status: 'confirmed',
          message: 'On the table in IdealPOS. The till is holding this round.',
          requiresReconciliation: false,
          settled: true,
        },
      ];
      await vi.advanceTimersByTimeAsync(3200);

      await waitFor(() => {
        expect(screen.getByTestId('native-round-banner')).toHaveAttribute(
          'data-round-tone',
          'success',
        );
      });
      expect(screen.getByTestId('native-round-banner').textContent).toMatch(/ON THE TABLE/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('will not let a poll talk a red banner back down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const readback = { rows: [] as Record<string, unknown>[] };
      const { calls } = installFetchMock({
        strategy: 'native_table_round',
        rounds: [UNCERTAIN],
        readback,
      });
      renderTablet();

      await openTable('T12 seats');
      await addItem();
      await pressSend();
      await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));
      expect(await screen.findByTestId('native-round-banner')).toHaveAttribute(
        'data-requires-reconciliation',
        'true',
      );

      // A poll that reports the round as neither alarming nor settled. That is
      // IGNORANCE, and ignorance must not read as reassurance - the round may
      // still be sitting on the customer's tab.
      readback.rows = [
        {
          ...ESCALATED('round-1', 1),
          state: 'awaiting_native_confirmation',
          status: 'awaitingConfirmation',
          message: 'Sent to the till. Waiting for confirmation that it landed.',
          requiresReconciliation: false,
          settled: false,
        },
      ];
      await vi.advanceTimersByTimeAsync(6400);

      // Still red, and the button still dead.
      const banner = screen.getByTestId('native-round-banner');
      expect(banner).toHaveAttribute('data-requires-reconciliation', 'true');
      expect(await screen.findByTestId('send-to-kitchen')).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('switching tables', () => {
  it('never carries one table’s uncertain round onto another table', async () => {
    const { calls, order } = installFetchMock({
      strategy: 'native_table_round',
      rounds: [UNCERTAIN],
    });
    renderTablet();

    await openTable('T12 seats');
    await addItem();
    await pressSend();
    await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));
    expect(await screen.findByTestId('native-round-banner')).toHaveAttribute(
      'data-requires-reconciliation',
      'true',
    );

    // ── Walk to table 2. It has nothing to do with table 1's problem, and
    //    blocking it would take a perfectly good table out of service. ──
    useLiveOrdersMock.mockReturnValue({
      data: [order('order-1', 'real-table-1', '1')],
      isRealtimeConnected: true,
      ordersDataIsAuthoritative: true,
    });
    fireEvent.click(await screen.findByTitle('Back to table map'));
    await openTable('T22 seats');
    await addItem();

    expect(screen.queryByTestId('native-round-banner')).not.toBeInTheDocument();
    expect(await screen.findByTestId('send-to-kitchen')).not.toBeDisabled();

    // And the round it sends is table 2's own order, not table 1's.
    await pressSend();
    await waitFor(() => expect(roundCalls(calls)).toHaveLength(2));
    expect(roundCalls(calls)[1].url).toContain('/api/admin/orders/order-2/rounds');
  });
});

// ════════════════════════════════════════════════════════════════════════
/**
 * SETTLING A STUCK ROUND BY HAND, FROM THE SCREEN.
 *
 * The dangerous half of this dialog is the answer a manager gives when they
 * CANNOT see the round. An earlier version offered "this round is NOT on the
 * table" and put the food back on the order to be sent again - which is a
 * duplicate docket one honest mistake away, because the till accepts an order
 * before it shows up, the printer runs behind, and a manager can be at the
 * wrong table. These tests hold the two answers apart at the pixel.
 */
describe('settling a stuck round by hand', () => {
  /** The docket the server attaches to a round that needs a human. */
  const DOCKET = {
    posTableCode: '5',
    guests: 2,
    lines: [
      { description: 'Test Kebab', quantity: 1, plu: '101', seat: 2 },
    ],
    externalOrderId: 'order-1:r1',
    sentAt: '2026-09-10T08:42:00.000Z',
    tokenPrefix: 'a1b2c3d4...',
  };

  const STUCK = {
    roundId: 'round-1',
    sequence: 1,
    state: 'unresolved',
    status: 'unresolved',
    message:
      'This round may be on the table and may not be - nobody knows. ' +
      'DO NOT send it again. Check the table in IdealPOS, or ask a manager.',
    requiresReconciliation: true,
    settled: false,
    sendInitiatedAt: new Date().toISOString(),
    lineCount: 1,
    attestation: DOCKET,
  };

  /** A manager is signed in, which is who this button is for. */
  function signInAsManager() {
    useAuthStore.setState({
      user: { id: 'u-1', email: 'manager@verdura.test', role: 'manager' },
    } as never);
  }

  /** Drive a table to a round the till never answered, with the docket loaded. */
  async function reachStuckRound(readback: { rows: Record<string, unknown>[] }) {
    await openTable('T12 seats');
    await addItem();
    await pressSend();
    readback.rows = [STUCK];
    await waitFor(() => {
      expect(screen.getByTestId('native-round-banner')).toHaveAttribute(
        'data-requires-reconciliation',
        'true',
      );
    });
  }

  it('shows the manager the whole docket before it asks them to vouch for it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      signInAsManager();
      const readback = { rows: [] as Record<string, unknown>[] };
      installFetchMock({ strategy: 'native_table_round', rounds: [UNCERTAIN], readback });
      renderTablet();
      await reachStuckRound(readback);

      fireEvent.click(await screen.findByTestId('resolve-round-open'));

      // THE POINT. Not a blank textarea under a question - the round as it was
      // sent, so the answer can be a comparison rather than a guess.
      const panel = await screen.findByTestId('resolve-evidence');
      // The IDEALPOS code, which is what is written on the till. The Verdura
      // display number is T1 here, so a panel showing that would fail.
      expect(panel.textContent).toMatch(/table 5/i);
      expect(panel.textContent).toMatch(/Round 1/);
      expect(panel.textContent).toMatch(/2 covers/i);
      expect(panel.textContent).toMatch(/1 .\s*Test Kebab/);
      expect(panel.textContent).toMatch(/101/);
      expect(panel.textContent).toMatch(/seat 2/i);
      expect(panel.textContent).toMatch(/order-1:r1/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers NO answer that sends the round again, and says so next to the one that might look like it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      signInAsManager();
      const readback = { rows: [] as Record<string, unknown>[] };
      installFetchMock({ strategy: 'native_table_round', rounds: [UNCERTAIN], readback });
      renderTablet();
      await reachStuckRound(readback);

      fireEvent.click(await screen.findByTestId('resolve-round-open'));
      const panel = await screen.findByTestId('resolve-round-panel');

      // The removed outcome is GONE - not hidden, not disabled, absent.
      expect(screen.queryByTestId('resolve-outcome-didNotLand')).toBeNull();
      expect(screen.queryByTestId('resolve-outcome-landed')).toBeNull();
      expect(screen.getByTestId('resolve-outcome-present')).toBeTruthy();
      expect(screen.getByTestId('resolve-outcome-notFound')).toBeTruthy();

      // And the "I cannot see it" answer states its own consequence, which is
      // that NOTHING happens - the sentence a manager would otherwise have to
      // infer from a system they do not have.
      const notFound = screen.getByTestId('resolve-outcome-notFound');
      expect(notFound.textContent).toMatch(/nothing changes/i);
      expect(notFound.textContent).toMatch(/NOT sent again/i);
      // Nowhere in the dialog is a promise to re-send anything.
      expect(panel.textContent).not.toMatch(/sent with the next round/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('will not submit until an answer is chosen AND something is written', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      signInAsManager();
      const readback = { rows: [] as Record<string, unknown>[] };
      installFetchMock({ strategy: 'native_table_round', rounds: [UNCERTAIN], readback });
      renderTablet();
      await reachStuckRound(readback);

      fireEvent.click(await screen.findByTestId('resolve-round-open'));
      const submit = await screen.findByTestId('resolve-round-submit');
      expect(submit).toBeDisabled();

      // An answer alone is not enough: the statement is the only evidence this
      // path will ever have.
      fireEvent.click(screen.getByRole('radio', { name: /I can see this round/i }));
      expect(submit).toBeDisabled();

      fireEvent.change(screen.getByTestId('resolve-basis'), {
        target: { value: 'Kebab is on table 5 in IdealPOS, checked against the bill.' },
      });
      expect(submit).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts the outcome the server understands, and never a line-releasing one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      signInAsManager();
      const readback = { rows: [] as Record<string, unknown>[] };
      const { calls } = installFetchMock({
        strategy: 'native_table_round',
        rounds: [UNCERTAIN],
        readback,
      });
      renderTablet();
      await reachStuckRound(readback);

      fireEvent.click(await screen.findByTestId('resolve-round-open'));
      fireEvent.click(screen.getByRole('radio', { name: /I cannot see it/i }));
      fireEvent.change(screen.getByTestId('resolve-basis'), {
        target: { value: 'Nothing on table 5 that I can see, and the printer is up to date.' },
      });
      fireEvent.click(screen.getByTestId('resolve-round-submit'));

      await waitFor(() => {
        expect(
          calls.some((c) => /\/rounds\/1\/resolve$/.test(c.url) && c.init?.method === 'POST'),
        ).toBe(true);
      });
      const call = calls.find((c) => /\/rounds\/1\/resolve$/.test(c.url))!;
      const sent = JSON.parse(call.init!.body as string) as { outcome: string; basis: string };
      expect(sent.outcome).toBe('notFound');
      expect(sent.basis).toMatch(/Nothing on table 5/);

      // AND NOT A SECOND SEND. The whole risk of this dialog is that settling a
      // round becomes a way to re-send one.
      expect(roundCalls(calls)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not offer the button to a waiter - they are told to fetch somebody', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useAuthStore.setState({
        user: { id: 'u-2', email: 'waiter@verdura.test', role: 'cashier' },
      } as never);
      const readback = { rows: [] as Record<string, unknown>[] };
      installFetchMock({ strategy: 'native_table_round', rounds: [UNCERTAIN], readback });
      renderTablet();
      await reachStuckRound(readback);

      expect(screen.queryByTestId('resolve-round-open')).toBeNull();
      // The red banner still says what to do about it.
      expect(screen.getByTestId('native-round-banner').textContent).toMatch(/DO NOT SEND AGAIN/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a round settled by a person in its OWN colour, never the green of a proven one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      signInAsManager();
      const readback = { rows: [] as Record<string, unknown>[] };
      installFetchMock({ strategy: 'native_table_round', rounds: [UNCERTAIN], readback });
      renderTablet();
      await reachStuckRound(readback);

      // The server settles it on a manager's word.
      readback.rows = [
        {
          ...STUCK,
          state: 'resolved_manually',
          status: 'resolvedManually',
          message:
            'A staff member checked IdealPOS and confirmed this round is on the table. ' +
            'It will not be sent again.',
          requiresReconciliation: false,
          settled: true,
          attestation: null,
        },
      ];
      await vi.advanceTimersByTimeAsync(3200);

      await waitFor(() => {
        expect(screen.getByTestId('native-round-banner')).toHaveAttribute(
          'data-requires-reconciliation',
          'false',
        );
      });
      const banner = screen.getByTestId('native-round-banner');
      // VIOLET, NOT GREEN. Green means the till was seen holding our own token;
      // this means a person said they saw the food. A screen that renders them
      // identically has thrown the difference away on the operator's behalf.
      expect(banner).toHaveAttribute('data-round-tone', 'accent');
      expect(banner.textContent).toMatch(/SETTLED BY HAND/i);
      expect(banner.textContent).not.toMatch(/ON THE TABLE IN IDEALPOS/);

      // AND THE TABLE IS FREE AGAIN, which is the operational point of the
      // whole route: the round that was holding the table is settled, so a
      // waiter may add the next course and send it. Asserted by adding an item
      // first - an empty cart disables Send for its own reason, and a test that
      // skipped that step would pass whether or not the table had been freed.
      await addItem();
      await waitFor(() => {
        expect(screen.getByTestId('send-to-kitchen')).not.toBeDisabled();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('a throttled send says what a waiter can act on', () => {
  it('tells them nothing was sent and to wait, not that authentication failed', async () => {
    const { calls } = installFetchMock({
      strategy: 'native_table_round',
      rounds: [THROTTLED],
    });
    renderTablet();

    await openTable('T12 seats');
    await addItem();
    await pressSend();
    await waitFor(() => expect(roundCalls(calls)).toHaveLength(1));

    const banner = await screen.findByTestId('native-round-banner');
    // NOT the guard's own sentence. "Too many requests" and "Authentication is
    // temporarily unavailable" are true of the infrastructure and useless to
    // somebody holding a tablet in a dining room.
    expect(banner.textContent).not.toMatch(/too many requests/i);
    expect(banner.textContent).not.toMatch(/authentication/i);

    // What IS true: the limiter runs before the handler, so no round was
    // opened and nothing left the device. That is the one case where telling
    // staff to press Send again is correct.
    expect(banner.textContent).toMatch(/NOT sent/i);
    expect(banner.textContent).toMatch(/press Send again/i);
    expect(banner).toHaveAttribute('data-requires-reconciliation', 'false');
  });
});

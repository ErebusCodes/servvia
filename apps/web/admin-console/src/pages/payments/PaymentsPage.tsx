import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';
import { DEFAULT_VENUE_ID } from '../../shared/orders';

// ── Story 15-6: native IdealPOS payment-state OBSERVATION and reconciliation ──
//
// This page replaces a prior placeholder built entirely on fabricated
// sample data (fake Stripe/EFTPOS terminals, fake settlements, a "New
// Refund" action, fake transaction rows) that never reflected anything
// this system actually does. Verdura's Order Tablet never processes or
// initiates payment (DL-087) — payment happens later, entirely inside
// native IdealPOS/EFTPOS. This page can only DISPLAY what a supported,
// versioned observation source has genuinely reported; it never contains
// a Pay/Charge/Refund/Void/Card/Cash control, and it never labels an
// order "Paid" without an authoritative observation behind it.

type PaymentObservationState =
  | 'not_observed'
  | 'observation_unsupported'
  | 'pending'
  | 'paid'
  | 'declined'
  | 'cancelled'
  | 'reversed'
  | 'refunded'
  | 'uncertain'
  | 'conflict';

interface PaymentObservationRecord {
  id: string | null;
  orderId: string;
  state: PaymentObservationState;
  provisionalPayableCents: number | null;
  nativeReference: string | null;
  nativeAmountCents: number | null;
  nativeCurrency: string | null;
  tenderMethod: string | null;
  nativeTimestamp: string | null;
  unverifiedAmountCents: number | null;
  unverifiedAmountSource: string | null;
  discrepancyCents: number | null;
  discrepancyState: string;
  lastObservedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  order?: {
    id: string;
    serviceMode: 'dine_in' | 'takeaway';
    takeawayReference: string | null;
    tableId: string | null;
    tableNumber: string | null;
  };
}

const STATE_FILTERS: { value: PaymentObservationState | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'declined', label: 'Declined' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'reversed', label: 'Reversed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'uncertain', label: 'Uncertain' },
  { value: 'conflict', label: 'Needs review' },
  { value: 'observation_unsupported', label: 'Unsupported' },
  { value: 'not_observed', label: 'Not observed' },
];

const STATE_BADGE: Record<PaymentObservationState, { label: string; className: string }> = {
  not_observed: { label: 'Not observed', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  observation_unsupported: { label: 'Unsupported', className: 'bg-gray-100 text-gray-500 border-gray-200' },
  pending: { label: 'Pending', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  paid: { label: 'Paid (observed)', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  declined: { label: 'Declined', className: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  reversed: { label: 'Reversed', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  refunded: { label: 'Refunded', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  uncertain: { label: 'Uncertain', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  conflict: { label: 'Needs review', className: 'bg-red-50 text-red-700 border-red-300' },
};

function formatCents(cents: number | null, currency: string | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: currency ?? 'NZD',
  }).format(cents / 100);
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NZ', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StateBadge({ state }: { state: PaymentObservationState }) {
  const meta = STATE_BADGE[state];
  return (
    <span
      role="status"
      aria-label={`Payment observation status: ${meta.label}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function AcknowledgeButton({ recordId, onDone }: { recordId: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => api.post(`/api/admin/payment-observations/${recordId}/acknowledge`, { note }),
    onSuccess: () => {
      setOpen(false);
      setNote('');
      onDone();
    },
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] font-bold text-gray-600 hover:text-gray-900 underline underline-offset-2 cursor-pointer"
      >
        Mark reviewed
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Review note (required)"
        className="text-[10px] px-2 py-1 border border-gray-300 rounded w-40"
      />
      <button
        disabled={!note.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="text-[10px] font-bold px-2 py-1 bg-gray-900 text-white rounded disabled:opacity-40 cursor-pointer"
      >
        {mutation.isPending ? 'Saving…' : 'Confirm'}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-[10px] font-bold px-2 py-1 text-gray-500 hover:text-gray-800 cursor-pointer"
      >
        Cancel
      </button>
      {mutation.isError && (
        <span className="text-[10px] text-red-600">Could not save — check your permissions.</span>
      )}
    </div>
  );
}

export function PaymentsPage() {
  const [stateFilter, setStateFilter] = useState<PaymentObservationState | 'all'>('all');
  const role = useAuthStore((s) => s.user?.role);
  const canAcknowledge = role === 'owner' || role === 'admin' || role === 'manager';
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['payment-observations', DEFAULT_VENUE_ID, stateFilter],
    queryFn: async () => {
      const params = stateFilter === 'all' ? {} : { state: stateFilter };
      const res = await api.get<PaymentObservationRecord[]>(
        `/api/admin/venues/${DEFAULT_VENUE_ID}/payment-observations`,
        { params },
      );
      return res.data;
    },
    enabled: Boolean(DEFAULT_VENUE_ID),
  });

  const records = useMemo(() => data ?? [], [data]);

  return (
    <div className="p-[18px] flex flex-col gap-[18px] text-gray-900 bg-gray-50 min-h-full">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-sm font-bold text-gray-900">Payment Observation</h1>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 shadow-xs hover:bg-gray-50 hover:border-gray-300 transition-all cursor-pointer disabled:opacity-50"
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p className="text-xs text-gray-500 font-medium max-w-2xl">
          Payment happens directly in native IdealPOS/EFTPOS — the Order Tablet never processes or
          initiates it. This page displays only what a supported, versioned observation source has
          genuinely reported; it never assumes an order is paid because it reached IdealPOS, was sent
          to the kitchen, or simply had time pass.
        </p>
      </div>

      <div
        className="flex items-center gap-1.5 flex-wrap"
        role="tablist"
        aria-label="Filter by payment-observation status"
      >
        {STATE_FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={stateFilter === f.value}
            onClick={() => setStateFilter(f.value)}
            className={`px-2.5 py-1 text-[10px] font-bold rounded-full border cursor-pointer transition-all ${
              stateFilter === f.value
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
        {!DEFAULT_VENUE_ID && (
          <div className="p-6 text-center text-xs text-gray-500 font-semibold">
            No venue is configured for this console (VITE_VENUE_ID unset).
          </div>
        )}
        {DEFAULT_VENUE_ID && isLoading && (
          <div className="p-6 text-center text-xs text-gray-500 font-semibold" role="status">
            Loading payment-observation records…
          </div>
        )}
        {DEFAULT_VENUE_ID && isError && (
          <div className="p-6 text-center text-xs text-red-600 font-semibold" role="alert">
            Could not load payment-observation records. Try refreshing.
          </div>
        )}
        {DEFAULT_VENUE_ID && !isLoading && !isError && records.length === 0 && (
          <div className="p-6 text-center text-xs text-gray-500 font-semibold">
            No payment-observation records for this filter yet.
          </div>
        )}
        {DEFAULT_VENUE_ID && !isLoading && !isError && records.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/75 border-y border-gray-200/50">
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">Order</th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">Service</th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider text-right">
                    Provisional
                  </th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider text-right">
                    Native amount
                  </th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                    Native reference
                  </th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">Tender</th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                    Discrepancy
                  </th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                    Last observed
                  </th>
                  <th className="px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r) => (
                  <tr key={r.orderId} className="hover:bg-gray-50/50 transition-colors align-top">
                    <td className="px-3 py-2 text-xs font-bold text-gray-900 whitespace-nowrap">{r.orderId}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {r.order?.serviceMode === 'takeaway'
                        ? `Takeaway · ${r.order.takeawayReference ?? '—'}`
                        : `Dine-in${r.order?.tableNumber ? ` · Table ${r.order.tableNumber}` : ''}`}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StateBadge state={r.state} />
                      {r.reviewedAt && (
                        <div className="text-[9px] text-gray-400 mt-0.5">Reviewed {formatTime(r.reviewedAt)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums whitespace-nowrap">
                      {formatCents(r.provisionalPayableCents, 'NZD')}
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums whitespace-nowrap">
                      {r.nativeAmountCents !== null ? (
                        formatCents(r.nativeAmountCents, r.nativeCurrency)
                      ) : r.unverifiedAmountCents !== null ? (
                        <span className="text-amber-600" title="Unverified observation — never treated as authoritative">
                          {formatCents(r.unverifiedAmountCents, 'NZD')} (unverified)
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{r.nativeReference ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap capitalize">
                      {r.tenderMethod ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {r.discrepancyState === 'mismatch' ? (
                        <span className="text-red-600 font-bold">
                          Mismatch
                          {r.discrepancyCents !== null
                            ? ` (${r.discrepancyCents > 0 ? '+' : ''}${(r.discrepancyCents / 100).toFixed(2)})`
                            : ''}
                        </span>
                      ) : r.discrepancyState === 'exact_match' ? (
                        <span className="text-emerald-600 font-semibold">Match</span>
                      ) : r.discrepancyState === 'currency_mismatch' ? (
                        <span className="text-red-600 font-bold">Currency mismatch</span>
                      ) : r.discrepancyState === 'missing_native_amount' ? (
                        <span className="text-gray-400">No amount</span>
                      ) : (
                        <span className="text-gray-400">Pending</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{formatTime(r.lastObservedAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.state === 'conflict' && canAcknowledge && r.id && !r.reviewedAt && (
                        <AcknowledgeButton
                          recordId={r.id}
                          onDone={() => queryClient.invalidateQueries({ queryKey: ['payment-observations'] })}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

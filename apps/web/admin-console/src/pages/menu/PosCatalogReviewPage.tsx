import { useEffect, useMemo, useState } from 'react';
import { useMenuStore, type MenuItem } from '../../store/menu.store';
import {
  usePosCatalogStore,
  type PosCandidate,
  type PosConfidenceTier,
  type PosLifecycleStatus,
} from '../../store/posCatalog.store';

// The POS Catalog Review page — the successor to running
// `apply-plu-mapping.ts` by hand for every mapping. A candidate here is
// NEVER a MenuItem row (see PosProductIdentity's own doc comment on the
// backend) and is never mixed into the normal Menu Management item list —
// this page exists specifically because a POS candidate is not a
// published menu item, and linking one never publishes anything: it only
// ever sets PosProductIdentity.menuItemId, never a MenuItem's
// visibleChannels/isAvailable.

const STATUS_LABELS: Record<PosLifecycleStatus, string> = {
  pending_review: 'Pending review',
  active: 'Linked / active',
  hidden: 'Hidden',
  unavailable: 'Unavailable',
  source_missing: 'Source missing',
  source_inactive: 'Source inactive',
};

const TIER_LABELS: Record<PosConfidenceTier, string> = {
  high_confidence_active: 'High confidence',
  likely_active: 'Likely active',
  ambiguous: 'Ambiguous',
  takeaway_duplicate: 'Takeaway duplicate',
  operational_non_menu: 'Operational / non-menu',
  inactive: 'Inactive',
};

const TIER_COLORS: Record<PosConfidenceTier, { bg: string; fg: string; border: string }> = {
  high_confidence_active: { bg: '#f0fdf4', fg: '#15803d', border: '#86efac' },
  likely_active: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
  ambiguous: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  takeaway_duplicate: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  operational_non_menu: { bg: '#f9fafb', fg: '#6b7280', border: '#e5e7eb' },
  inactive: { bg: '#f9fafb', fg: '#6b7280', border: '#e5e7eb' },
};

function formatPrice(cents: number | null): string {
  if (cents == null) return 'unknown';
  return `$${(cents / 100).toFixed(2)}`;
}

function evidenceSummary(evidence: Record<string, unknown>): string {
  const parts: string[] = [];
  if (evidence['hasVisibleGridPlacement']) parts.push('on a visible grid button');
  else if (evidence['hasAnyGridPlacement']) parts.push('on a grid, button not visible');
  else parts.push('no grid placement found');
  if (evidence['isDepartment41']) {
    parts.push(
      evidence['hasDepartment41TwinSameDescription']
        ? 'department 41 with an identical-description twin'
        : 'department 41, no matching twin',
    );
  }
  return parts.join(' · ');
}

function CandidateCard({
  candidate,
  onLinkClick,
  onUnlink,
  unlinkPending,
}: {
  candidate: PosCandidate;
  onLinkClick: () => void;
  onUnlink: () => void;
  unlinkPending: boolean;
}) {
  const tierColor = candidate.confidenceTier ? TIER_COLORS[candidate.confidenceTier] : null;
  const priceLabel = formatPrice(candidate.priceCentsFromPos);
  const isProblem =
    candidate.lifecycleStatus === 'source_missing' || candidate.lifecycleStatus === 'source_inactive';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono font-semibold text-[13.5px] text-gray-900">{candidate.nativeCode}</div>
          <div className="text-[13px] text-gray-700">{candidate.nativeDescription}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {candidate.confidenceTier && tierColor && (
            <span
              className="font-semibold px-2 py-0.5 rounded-full text-[10.5px]"
              style={{ background: tierColor.bg, color: tierColor.fg, border: `1px solid ${tierColor.border}` }}
            >
              {TIER_LABELS[candidate.confidenceTier]}
            </span>
          )}
          <span
            className="font-semibold px-2 py-0.5 rounded-full text-[10.5px]"
            style={{
              background: isProblem ? '#fef2f2' : '#f3f4f6',
              color: isProblem ? '#b91c1c' : '#374151',
              border: `1px solid ${isProblem ? '#fecaca' : '#e5e7eb'}`,
            }}
          >
            {STATUS_LABELS[candidate.lifecycleStatus]}
          </span>
        </div>
      </div>

      <div className="text-[11.5px] text-gray-500">{evidenceSummary(candidate.evidence)}</div>
      <div className="text-[11.5px] text-gray-500">
        POS price: {priceLabel} · Last synced:{' '}
        {candidate.lastSyncedAt ? new Date(candidate.lastSyncedAt).toLocaleString() : 'never'}
      </div>
      {candidate.descriptionDriftDetectedAt && (
        <div
          className="text-[11px] font-semibold px-2 py-1 rounded"
          style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}
        >
          Description changed since last review.
        </div>
      )}

      {candidate.menuItem ? (
        <div className="border-t border-gray-100 pt-2.5 flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-gray-700">
            Linked to <span className="font-semibold">{candidate.menuItem.title}</span>
            {candidate.menuItem.category && ` (${candidate.menuItem.category.name})`}
            {' — '}
            {formatPrice(candidate.menuItem.priceCents)}
          </div>
          <button
            type="button"
            onClick={onUnlink}
            disabled={unlinkPending}
            className="h-8 px-3 rounded-md border border-red-200 bg-white text-red-700 font-semibold text-[12px] hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {unlinkPending ? 'Unlinking…' : 'Unlink'}
          </button>
        </div>
      ) : (
        <div className="border-t border-gray-100 pt-2.5 flex justify-end">
          <button
            type="button"
            onClick={onLinkClick}
            className="h-8 px-3.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[12px] transition-colors"
          >
            Link to a Verdura item…
          </button>
        </div>
      )}
    </div>
  );
}

function LinkModal({
  candidate,
  unlinkedItems,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  candidate: PosCandidate;
  unlinkedItems: MenuItem[];
  onClose: () => void;
  onConfirm: (menuItemId: string) => void;
  pending: boolean;
  error: string;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const selected = unlinkedItems.find((i) => i.id === selectedId) ?? null;

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/45 z-[60]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Link POS candidate to a Verdura menu item"
        className="fixed inset-0 z-[61] flex items-center justify-center p-5"
      >
        <div className="bg-white rounded-xl w-full max-w-lg flex flex-col" style={{ boxShadow: '0 8px 32px rgba(17,24,39,.2)' }}>
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <div className="text-[15px] font-semibold text-gray-900">Link POS candidate</div>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200">
              ✕
            </button>
          </div>

          <div className="p-5 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">IdealPOS</div>
                <div className="font-mono font-semibold text-[13px] text-gray-900">{candidate.nativeCode}</div>
                <div className="text-[12.5px] text-gray-700 mt-1">{candidate.nativeDescription}</div>
                <div className="text-[11.5px] text-gray-500 mt-1">{formatPrice(candidate.priceCentsFromPos)}</div>
                <div className="text-[10.5px] text-gray-400 mt-1.5">{evidenceSummary(candidate.evidence)}</div>
              </div>
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Verdura (selected)</div>
                {selected ? (
                  <>
                    <div className="font-semibold text-[13px] text-gray-900">{selected.title}</div>
                    <div className="text-[12.5px] text-gray-700 mt-1">{formatPrice(Math.round(parseFloat(selected.price || '0') * 100))}</div>
                  </>
                ) : (
                  <div className="text-[12px] text-gray-400">Choose an item →</div>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="pos-link-menu-item-select" className="block text-[12px] font-semibold text-gray-700 mb-1.5">Verdura menu item</label>
              <select
                id="pos-link-menu-item-select"
                value={selectedId}
                onChange={(e) => { setSelectedId(e.target.value); setConfirming(false); }}
                className="w-full h-[38px] border border-gray-300 rounded-md px-3 text-[13.5px] outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20 bg-white"
              >
                <option value="">Select an unlinked item…</option>
                {unlinkedItems.map((i) => (
                  <option key={i.id} value={i.id}>{i.title}</option>
                ))}
              </select>
              {unlinkedItems.length === 0 && (
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Every curated item already has a POS link. Create a new menu item first if you need to link this candidate.
                </p>
              )}
            </div>

            {error && (
              <div className="text-[12px] font-semibold px-3 py-2 rounded-md" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                {error}
              </div>
            )}

            {!confirming ? (
              <button
                type="button"
                disabled={!selectedId}
                onClick={() => setConfirming(true)}
                className="h-10 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[13.5px] disabled:opacity-40 transition-colors"
              >
                Review &amp; confirm link
              </button>
            ) : (
              <div className="border border-amber-200 bg-amber-50 rounded-md p-3.5 flex flex-col gap-2.5">
                <p className="text-[12.5px] text-amber-900">
                  Confirm: link IdealPOS <span className="font-mono font-semibold">{candidate.nativeCode}</span> ({candidate.nativeDescription})
                  to Verdura item <span className="font-semibold">{selected?.title}</span>? This does not publish or change visibility —
                  it only attaches the native POS identity needed for order handoff.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirming(false)}
                    className="h-9 px-3.5 rounded-md border border-gray-300 bg-white text-[12.5px] font-medium text-gray-700 hover:bg-gray-50">
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onConfirm(selectedId)}
                    className="h-9 px-3.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[12.5px] disabled:opacity-50"
                  >
                    {pending ? 'Linking…' : 'Confirm link'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function UnlinkConfirm({ candidate, onClose, onConfirm, pending, error }: {
  candidate: PosCandidate;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: string;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-gray-900/45 z-[60]" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Unlink POS candidate" className="fixed inset-0 z-[61] flex items-center justify-center p-5">
        <div className="bg-white rounded-xl w-full max-w-md p-5 flex flex-col gap-3.5" style={{ boxShadow: '0 8px 32px rgba(17,24,39,.2)' }}>
          <div className="text-[15px] font-semibold text-gray-900">Unlink POS identity?</div>
          <p className="text-[13px] text-gray-600 leading-relaxed">
            This removes the native IdealPOS identity from{' '}
            <span className="font-semibold">{candidate.menuItem?.title}</span>. Order Tablet will not be able to send
            this item to the kitchen until it's linked again. The menu item itself, its presentation, and its order
            history are never deleted.
          </p>
          {error && (
            <div className="text-[12px] font-semibold px-3 py-2 rounded-md" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="h-9 px-3.5 rounded-md border border-gray-300 bg-white text-[12.5px] font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button type="button" disabled={pending} onClick={onConfirm}
              className="h-9 px-3.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold text-[12.5px] disabled:opacity-50">
              {pending ? 'Unlinking…' : 'Unlink'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function PosCatalogReviewPage() {
  const candidates = usePosCatalogStore((s) => s.candidates);
  const loading = usePosCatalogStore((s) => s.loading);
  const loaded = usePosCatalogStore((s) => s.loaded);
  const error = usePosCatalogStore((s) => s.error);
  const actionErrors = usePosCatalogStore((s) => s.actionErrors);
  const actionPending = usePosCatalogStore((s) => s.actionPending);
  const fetchCandidates = usePosCatalogStore((s) => s.fetchCandidates);
  const linkCandidate = usePosCatalogStore((s) => s.link);
  const unlinkCandidate = usePosCatalogStore((s) => s.unlink);
  const clearActionError = usePosCatalogStore((s) => s.clearActionError);

  const items = useMenuStore((s) => s.items);
  const fetchMenu = useMenuStore((s) => s.fetchMenu);
  const menuLoaded = useMenuStore((s) => s.loaded);

  const [statusFilter, setStatusFilter] = useState<PosLifecycleStatus | ''>('pending_review');
  const [tierFilter, setTierFilter] = useState<PosConfidenceTier | ''>('');
  const [linkTarget, setLinkTarget] = useState<PosCandidate | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<PosCandidate | null>(null);

  useEffect(() => {
    fetchCandidates({
      status: statusFilter || undefined,
      tier: tierFilter || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, tierFilter]);

  useEffect(() => {
    if (!menuLoaded) fetchMenu();
  }, [menuLoaded, fetchMenu]);

  const unlinkedItems = useMemo(() => items.filter((i) => !i.posIdentity), [items]);

  const handleConfirmLink = async (menuItemId: string) => {
    if (!linkTarget) return;
    const ok = await linkCandidate(linkTarget.id, menuItemId);
    if (ok) {
      setLinkTarget(null);
      fetchMenu(); // refresh so the MenuItem's posIdentity panel reflects the new link immediately
    }
    // On failure, the modal stays open and shows actionErrors[linkTarget.id] —
    // no optimistic success, no silent failure.
  };

  const handleConfirmUnlink = async () => {
    if (!unlinkTarget) return;
    const ok = await unlinkCandidate(unlinkTarget.id);
    if (ok) {
      setUnlinkTarget(null);
      fetchMenu();
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ padding: 24 }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">POS Catalog Review</h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            Candidates synced from IdealPOS. Nothing here is published automatically — link a candidate to make it
            orderable through Order Tablet, or leave it for later review.
          </p>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PosLifecycleStatus | '')}
          className="h-9 border border-gray-300 rounded-md px-3 text-[13px] bg-white"
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABELS) as PosLifecycleStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as PosConfidenceTier | '')}
          className="h-9 border border-gray-300 rounded-md px-3 text-[13px] bg-white"
        >
          <option value="">All confidence tiers</option>
          {(Object.keys(TIER_LABELS) as PosConfidenceTier[]).map((t) => (
            <option key={t} value={t}>{TIER_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {!loaded && loading && (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Loading POS catalog…</div>
      )}

      {!loaded && error && (
        <div className="flex-1 flex items-center justify-center text-sm text-red-600">{error}</div>
      )}

      {loaded && (
        <div className="flex-1 overflow-y-auto grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', alignContent: 'start' }}>
          {candidates.length === 0 && (
            <div className="text-sm text-gray-400 col-span-full text-center py-10">No candidates match this filter.</div>
          )}
          {candidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              onLinkClick={() => setLinkTarget(c)}
              onUnlink={() => setUnlinkTarget(c)}
              unlinkPending={!!actionPending[c.id]}
            />
          ))}
        </div>
      )}

      {linkTarget && (
        <LinkModal
          candidate={linkTarget}
          unlinkedItems={unlinkedItems}
          onClose={() => { clearActionError(linkTarget.id); setLinkTarget(null); }}
          onConfirm={handleConfirmLink}
          pending={!!actionPending[linkTarget.id]}
          error={actionErrors[linkTarget.id] ?? ''}
        />
      )}

      {unlinkTarget && (
        <UnlinkConfirm
          candidate={unlinkTarget}
          onClose={() => { clearActionError(unlinkTarget.id); setUnlinkTarget(null); }}
          onConfirm={handleConfirmUnlink}
          pending={!!actionPending[unlinkTarget.id]}
          error={actionErrors[unlinkTarget.id] ?? ''}
        />
      )}
    </div>
  );
}

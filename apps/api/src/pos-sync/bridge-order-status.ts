import { POSSyncStatus } from '@prisma/client';

/**
 * The IdealposBridge order-status contract, transcribed field-for-field from
 * `apps/idealpos-bridge/Api/Endpoints.cs` `ToResponseBody()` — the response of
 * `GET /api/orders/{externalOrderId}`.
 *
 * Field origins, traced through the Bridge source, because this is the only
 * evidence Verdura will ever have that IdealPOS did anything:
 *
 * | field                      | origin                                                        |
 * |----------------------------|---------------------------------------------------------------|
 * | `externalOrderId`          | `OrderRecord.ExternalOrderId` — Verdura's own order id          |
 * | `status`                   | `OrderStatus.ToWireString()`                                    |
 * | `table`                    | `OrderRecord.RequestedTable` — what Verdura ASKED for, NOT      |
 * |                            | what IdealPOS did. Never treat this as an observation.          |
 * | `idealposWebPendingOrderId`| `IPSTransaction.dbo.WebPendingOrder.ID`                          |
 * | `idealposPendingSaleId`    | IPSTransaction anchor row id (the order's own web-order sale)    |
 * | `idealposPendingSaleCode`  | that row's `Code`, e.g. `WBORD-600002`                           |
 * | `posServerPendingSaleCode` | `POSServer.dbo.PendingSales.Code` — the ACTUAL table code, and   |
 * |                            | the only observed table identity in the contract                |
 * | `tableMatchesRequest`      | `true` only after `Reconciliation.ConfirmsRequestedTable()`;     |
 * |                            | `null` means NOT DETERMINED, never "checked and mismatched"      |
 * | `tableAssignedNatively`    | the constant `false` — the Webit contract has no table field     |
 *
 * KNOWN CONTRACT GAP — do not paper over it. `Reconciliation.SelectTableSale`
 * matches a POSServer row purely on `Code == requestedTable` at `Pos == 1`.
 * There is no column anywhere in `POSServer.dbo.PendingSales` or
 * `PendingSaleLines` that references a web order, so the Bridge cannot tie a
 * table sale to THIS order. `assigned_to_table` therefore means "exactly one
 * open table sale exists on the table Verdura asked for", not "this order is
 * on that table". A staff-created walk-in on the same table satisfies it
 * identically. That is correlation-grade evidence, and it is why nothing here
 * sets any "table assignment confirmed" claim.
 */
export interface BridgeOrderStatusBody {
  externalOrderId?: string;
  status?: string;
  table?: string | null;
  idealposWebPendingOrderId?: number | string | null;
  idealposPendingSaleId?: number | string | null;
  idealposPendingSaleCode?: string | null;
  anchoredAtUtc?: string | null;
  posServerPendingSaleId?: number | string | null;
  posServerPendingSaleCode?: string | null;
  tableMatchesRequest?: boolean | null;
  processed?: boolean;
  tableOccupiedWarning?: boolean | null;
  strategyUsed?: string | null;
  tableAssignedNatively?: boolean;
  tableAssignmentEffect?: string | null;
  submittedAtUtc?: string | null;
  lastObservedAtUtc?: string | null;
  lastError?: string | null;
}

/** Bridge wire statuses, from `OrderStatusExtensions.ToWireString()`. */
export const BRIDGE_STATUS = {
  received: 'received',
  validated: 'validated',
  submittedToIdealpos: 'submitted_to_idealpos',
  pendingIdealposProcessing: 'pending_idealpos_processing',
  processed: 'processed',
  anchoredInIdealpos: 'anchored_in_idealpos',
  assignedToTable: 'assigned_to_table',
  rejected: 'rejected',
  failed: 'failed',
  uncertain: 'uncertain',
  paid: 'paid',
  closed: 'closed',
} as const;

/**
 * What a read of the Bridge produced. `unavailable` and `malformed` are
 * deliberately distinct from `notFound`: the first two are "we learned
 * nothing", the third is a real answer ("the Bridge has no record").
 * None of them may ever become success.
 */
export type BridgeStatusReadOutcome =
  | { kind: 'ok'; body: BridgeOrderStatusBody }
  | { kind: 'notFound' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'malformed'; reason: string };

/**
 * DI token for the port below. A TypeScript interface cannot itself be an
 * injection token (it does not survive to runtime), so the optional
 * dependency in IdealposConfirmationService is bound through this symbol.
 * Leaving it unbound is a supported configuration: the confirmation sweep
 * then reports `disabled: true` and touches nothing.
 */
export const BRIDGE_ORDER_STATUS_READER = Symbol('BRIDGE_ORDER_STATUS_READER');

/** Port. Kept narrow so the reconciliation logic is transport-agnostic and unit-testable. */
export interface BridgeOrderStatusReader {
  /** MUST NOT throw: a transport failure is an outcome, not an exception. */
  read(externalOrderId: string): Promise<BridgeStatusReadOutcome>;
}

/**
 * The decision this whole module exists to make. Pure: no I/O, no clock, no
 * database — so every rule below is exercised by unit tests rather than
 * asserted to hold in production.
 */
export interface ConfirmationDecision {
  /** `null` means "leave the record exactly as it is". */
  nextStatus: POSSyncStatus | null;
  /** Human-readable justification, logged and surfaced in sweep results. */
  reason: string;
  /** The table code actually OBSERVED in POSServer, when the Bridge resolved one. */
  observedTableCode?: string;
  /**
   * True only when a POSServer table sale was resolved AND its code matches the
   * requested table. Even then this is correlation-grade — see the contract gap
   * documented above.
   */
  tableCorroborated: boolean;
}

function normalise(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Maps a Bridge read onto a POSSyncRecord transition.
 *
 * FAIL-CLOSED POLICY (2026-09-04). NO path in this function reaches `synced`.
 *
 * `synced` is what the tablet renders as full confirmation, so it may be
 * claimed only from a CAUSAL native identity — evidence that ties this
 * specific Verdura order to a specific native IdealPOS sale. No such identity
 * exists on this installation today, and none of the following is a
 * substitute. Each is explicitly disqualified:
 *
 *   - connector acceptance alone         (the connector durably took the job;
 *                                         says nothing about IdealPOS)
 *   - WebOrder `processed` alone         (native IdealPOS consumed the web
 *                                         order; no table, no sale identity)
 *   - the requested table echoed back    (`body.table` is Verdura's own input)
 *   - POSServer table-code correlation   (a walk-in on the same table is
 *                                         indistinguishable — see the
 *                                         assigned_to_table branch)
 *   - absence of an error                (silence is not success)
 *   - timeout / retry exhaustion         (exhaustion is not delivery)
 *
 * This function previously promoted on the fourth of those. It no longer
 * does: `assigned_to_table` with a matching code now records
 * `tableCorroborated: true` and leaves the record awaiting, so the
 * corroboration is still visible to operators and telemetry without being
 * mistaken for confirmation.
 *
 * Consequently `synced` is once again unreachable by any code path, which is
 * what POSSyncStatus's own enum doc has always said. It becomes reachable
 * again only when a real causal identity exists — which is a vendor-dependent
 * question (see the vendor package's questions 3, 4, 5 and 13), not something
 * this module can resolve on its own.
 *
 * `failed` is unaffected: an explicit Bridge `rejected`/`failed` is a real,
 * attempted-and-rejected outcome and remains terminal.
 */
export function decideConfirmation(
  outcome: BridgeStatusReadOutcome,
  requestedTable: string | null | undefined,
): ConfirmationDecision {
  if (outcome.kind === 'unavailable') {
    return {
      nextStatus: null,
      reason: `bridge unavailable (${outcome.reason}) — no evidence either way; leaving awaiting confirmation`,
      tableCorroborated: false,
    };
  }

  if (outcome.kind === 'malformed') {
    return {
      nextStatus: null,
      reason: `bridge returned a malformed body (${outcome.reason}) — refusing to infer anything from it`,
      tableCorroborated: false,
    };
  }

  if (outcome.kind === 'notFound') {
    // The Bridge keeps its order state in its own SQLite store. A 404 after a
    // Bridge reinstall or state loss is not evidence the order failed, and
    // must never become `failed` — that would report a real, delivered order
    // as rejected.
    return {
      nextStatus: null,
      reason:
        'bridge has no record of this externalOrderId (404) — not evidence of failure; leaving awaiting',
      tableCorroborated: false,
    };
  }

  const status = normalise(outcome.body.status).toLowerCase();

  if (status.length === 0) {
    return {
      nextStatus: null,
      reason: 'bridge body carried no status field',
      tableCorroborated: false,
    };
  }

  if (status === BRIDGE_STATUS.rejected || status === BRIDGE_STATUS.failed) {
    const detail = normalise(outcome.body.lastError);
    return {
      nextStatus: POSSyncStatus.failed,
      reason: `bridge reports '${status}'${detail ? `: ${detail}` : ''}`,
      tableCorroborated: false,
    };
  }

  if (status === BRIDGE_STATUS.assignedToTable) {
    const observed = normalise(outcome.body.posServerPendingSaleCode);
    const wanted = normalise(requestedTable);

    if (outcome.body.tableMatchesRequest !== true) {
      return {
        nextStatus: null,
        reason:
          `bridge reports 'assigned_to_table' but tableMatchesRequest is ` +
          `${JSON.stringify(outcome.body.tableMatchesRequest)} (null means NOT DETERMINED) — refusing to claim confirmation`,
        observedTableCode: observed || undefined,
        tableCorroborated: false,
      };
    }

    if (observed.length === 0) {
      return {
        nextStatus: null,
        reason:
          "bridge reports 'assigned_to_table' with tableMatchesRequest=true but no posServerPendingSaleCode — " +
          'the observed table identity is missing, so the claim cannot be checked',
        tableCorroborated: false,
      };
    }

    if (wanted.length === 0) {
      return {
        nextStatus: null,
        reason:
          "bridge reports 'assigned_to_table' but this record carries no requested table to compare against",
        observedTableCode: observed,
        tableCorroborated: false,
      };
    }

    if (observed.toLowerCase() !== wanted.toLowerCase()) {
      // The Bridge already refuses to transition on a mismatch, so reaching
      // here means its view and ours disagree. Trust neither.
      return {
        nextStatus: null,
        reason:
          `bridge reports 'assigned_to_table' on table '${observed}' but this order requested ` +
          `'${wanted}' — mismatch, refusing to confirm`,
        observedTableCode: observed,
        tableCorroborated: false,
      };
    }

    // CORROBORATION, NOT CONFIRMATION — this branch deliberately does not
    // promote. See FAIL-CLOSED POLICY on decideConfirmation below.
    //
    // Everything checked above is satisfied identically by a staff-created
    // walk-in on the same table. `Reconciliation.SelectTableSale` matches a
    // POSServer row on `Code == requestedTable` at `Pos == 1` and nothing
    // else, and no column in POSServer.PendingSales or PendingSaleLines
    // references a web order — so this evidence is table-code correlation,
    // never causation. Read-only measurement of the live venue on 2026-09-04
    // sharpened that: SelectTableSale ignores `Map`, the column that actually
    // separates a table-map sale (Map 1) from a takeaway/web ticket (Map 0),
    // and observed takeaway ticket numbers include 32 — so ticket numbers and
    // table numbers occupy overlapping ranges. A takeaway ticket numbered
    // 1..19 would satisfy every check above.
    return {
      nextStatus: null,
      reason:
        `bridge observed POSServer table sale '${observed}' matching the requested table — ` +
        'table-code corroboration only, not causal proof that THIS order produced that sale; ' +
        'leaving awaiting confirmation',
      observedTableCode: observed,
      tableCorroborated: true,
    };
  }

  // Everything else is a legitimate in-flight or heuristic state.
  //
  // `processed` and `anchored_in_idealpos` DO prove native IdealPOS consumed
  // the order — but they say nothing about a table, and `synced` is what the
  // tablet renders as full confirmation. Claiming it on anchor-only evidence
  // would overstate exactly the thing this integration is least sure of.
  //
  // `paid`/`closed` are documented in the Bridge as HEURISTIC (a PendingSales
  // row disappearing is *inferred* to mean the sale was finalised, never
  // proven against native IPS.exe), so they cannot carry a terminal claim
  // either.
  //
  // `uncertain` is genuinely ambiguous by construction.
  return {
    nextStatus: null,
    reason: `bridge reports '${status}' — real progress, but not confirmation of a table assignment`,
    observedTableCode: normalise(outcome.body.posServerPendingSaleCode) || undefined,
    tableCorroborated: false,
  };
}

/**
 * Pure, deterministic translation from a durable Verdura dine-in order into
 * the exact wire payload VerduraIdealposBridge's `POST /api/orders` expects
 * — {externalOrderId, table, items:[{productCode,quantity}], notes} —
 * confirmed by direct source read of
 * /Users/sarwarkhan/Documents/IdealposBridge/Orders/OrderModels.cs and
 * examples/verdura-client-example.md. No HTTP call, no retry/reconciliation
 * state, no connector — that is deliberately out of scope here (see this
 * module's own doc note below on why). This is the mapping *contract* only:
 * given a durable order and its resolved table/menu-item mapping data, can
 * Verdura build a truthful bridge payload, or must it honestly refuse?
 *
 * Why this exists as its own tiny module rather than inline in a future
 * submission service: uncommitted uncommitted-tree scaffolding (Story 15-5,
 * apps/api/src/pos-sync/idealpos-order-reconciliation.service.ts, inspected
 * read-only, not staged here) was found sending `productCode:
 * item.menuItemId` — a Verdura MenuItem UUID, not a real Idealpos PLU — with
 * its own comment explicitly labelling this "a KNOWN GAP, not a real
 * mapping". That code has nowhere to source a real PLU from, because no
 * persisted mapping field existed. This module is the missing mapping
 * contract: it never guesses, and it fails closed (a typed
 * IdealposMappingError, not a best-effort partial payload) whenever the
 * data needed to build a truthful payload doesn't exist yet.
 *
 * Modifiers are a known, separate, currently-unresolvable gap: the real
 * bridge contract (confirmed by full source grep of the IdealposBridge
 * repo) has no modifier/variant/extra concept anywhere — `OrderLineRequest`
 * is exactly `{productCode, quantity}`. There is no bridge-side field to
 * put modifier data in without inventing one, and squeezing it into the
 * order-level `notes` string would silently misrepresent a structured
 * selection as free text a kitchen may or may not read correctly for
 * billing-relevant items (e.g. a paid extra). Rather than silently drop
 * modifier data or guess at an encoding the bridge was never built to
 * parse, this mapper refuses to build a payload for any order carrying a
 * non-empty modifier selection — see `unsupported_modifiers` below. Closing
 * this gap requires an IdealposBridge contract change, out of this
 * repository's authority to make unilaterally.
 */

export type IdealposMappingFailureReason =
  | 'unmapped_table'
  | 'unmapped_item'
  | 'unsupported_modifiers'
  | 'invalid_quantity'
  | 'takeaway_unsupported_by_bridge';

export class IdealposMappingError extends Error {
  constructor(
    public readonly reason: IdealposMappingFailureReason,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IdealposMappingError';
  }
}

export interface IdealposMappingItemInput {
  menuItemId: string;
  menuItemTitle: string;
  quantity: number;
  /** Raw OrderItem.selectedModifiers JSON — only its emptiness is inspected here. */
  selectedModifiers: unknown;
  /** Table.posProductCode is not real; this is MenuItem.posProductCode. Null = unmapped. */
  posProductCode: string | null;
}

export interface IdealposMappingInput {
  /** The durable Verdura order's own stable id — safe to retry unchanged (see bridge idempotency note below). */
  externalOrderId: string;
  /**
   * 'dine_in' | 'takeaway' — Order.serviceMode (Story 15-13), the single
   * authoritative signal for which failure reason a missing tableCode
   * means. Required (not inferred from tableCode's own nullness) so a
   * dine-in order with a genuinely unmapped table is never confused with
   * a takeaway order, which structurally has no table at all.
   */
  serviceMode: 'dine_in' | 'takeaway';
  /** Table.posTableCode for this order's resolved table. Null = unmapped (dine_in) or not applicable (takeaway). */
  tableCode: string | null;
  items: IdealposMappingItemInput[];
  notes: string | null;
}

export interface IdealposOrderPayload {
  externalOrderId: string;
  table: string;
  items: Array<{ productCode: string; quantity: number }>;
  notes?: string;
}

function hasSelections(selectedModifiers: unknown): boolean {
  return Array.isArray(selectedModifiers) && selectedModifiers.length > 0;
}

/**
 * Builds the bridge payload for one durable order, or throws
 * IdealposMappingError identifying exactly what's missing/unsupported.
 * Deterministic: the same input always produces the same output (or the
 * same rejection) — required for safe retry, since the bridge's own
 * `externalOrderId` is its idempotency key (confirmed: OrderService.cs
 * short-circuits a repeat externalOrderId and never re-calls
 * InsertOrders()) and a retried submission must send byte-identical data,
 * never a re-derived value that could legitimately differ between calls.
 */
export function buildIdealposOrderPayload(input: IdealposMappingInput): IdealposOrderPayload {
  if (!input.tableCode) {
    if (input.serviceMode === 'takeaway') {
      // Confirmed by direct source read of the real bridge's
      // Orders/OrderValidator.cs: `table` is required non-empty, and there
      // is no distinct takeaway endpoint/field today — this is a genuine,
      // typed, reconcilable bridge-contract gap, not a Verdura mapping
      // omission. Never fabricate a table to work around it, and never
      // silently reclassify this as a dine-in order.
      throw new IdealposMappingError(
        'takeaway_unsupported_by_bridge',
        'The real IdealPOS bridge requires a non-empty table and has no takeaway/no-table submission path today — this order cannot be submitted without fabricating a table.',
      );
    }
    throw new IdealposMappingError(
      'unmapped_table',
      "This order's table has no configured POS table code (Table.posTableCode) — cannot submit to IdealPOS without guessing.",
    );
  }

  if (input.items.length === 0) {
    // Unreachable for a real order (order creation itself requires at
    // least one item), but a mapper that silently produced `items: []`
    // for an empty array would be a worse failure mode than refusing.
    throw new IdealposMappingError('unmapped_item', 'Order has no items to submit.');
  }

  const items = input.items.map((item) => {
    if (hasSelections(item.selectedModifiers)) {
      throw new IdealposMappingError(
        'unsupported_modifiers',
        `"${item.menuItemTitle}" has modifier selections, and the IdealPOS bridge contract has no field to represent them — cannot submit without silently dropping customer intent.`,
        { menuItemId: item.menuItemId },
      );
    }
    if (!item.posProductCode) {
      throw new IdealposMappingError(
        'unmapped_item',
        `"${item.menuItemTitle}" has no configured POS product code (MenuItem.posProductCode) — cannot submit to IdealPOS without guessing.`,
        { menuItemId: item.menuItemId },
      );
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new IdealposMappingError(
        'invalid_quantity',
        `"${item.menuItemTitle}" has an invalid quantity (${item.quantity}).`,
        { menuItemId: item.menuItemId },
      );
    }
    return { productCode: item.posProductCode, quantity: item.quantity };
  });

  return {
    externalOrderId: input.externalOrderId,
    table: input.tableCode,
    items,
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

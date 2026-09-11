/**
 * The dine-in POS routing seam.
 *
 * WHAT THIS DECIDES. Which of two mutually exclusive transports carries a
 * dine-in order to IdealPOS:
 *
 *   WEBIT                 — today's certified production path. The API creates
 *                           an `idealpos.submit_order.v1` ConnectorCommand; the
 *                           connector POSTs it to IdealposBridge, which writes
 *                           `dbo.WebPendingOrder`.
 *   NATIVE_IDEALPOS_TABLE — the future path. The API creates an
 *                           `idealpos.native_table_round.v1` ConnectorCommand;
 *                           the connector drives the real native terminal
 *                           workflow (sale entry → items → TABLE MAP → Table N)
 *                           through TerminalRoundService.
 *
 * WHY A SEAM AND NOT A FLIP. The native driver is not certified: it has no
 * runtime selectors, its Windows executor is deliberately fail-closed, and the
 * owning executable is still an assumption pending a Front-desk capture. So the
 * seam exists, is server-controlled, and is inert — the default is and remains
 * WEBIT, and nothing in this file can select NATIVE unless an operator both
 * sets a valid configuration value AND the venue's connector actually reports
 * the native capability.
 *
 * THE ONE RULE EVERYTHING ELSE SERVES. A dine-in order takes exactly ONE route,
 * decided once, and never both. The dangerous failure is not "the native route
 * did not work" — it is "the native route may have already put a docket on
 * Table 5, and then we also sent the order through Webit". There is therefore
 * NO post-boundary fallback anywhere in this design, by construction rather
 * than by discipline: see `resolveDineInRoute`'s stickiness rule below.
 */

/**
 * WHERE THE ROUTE IS PERSISTED, AND WHY THAT PLACE.
 *
 * The route is durable order truth today WITHOUT a new column, because one
 * already carries it: `POSSyncRecord.connectorSubmitCommandId` points at the
 * single command created for that order, and a command's `commandType` is
 * written once and never mutated. Route = `routeOfCommandType(command.type)`.
 *
 * That column has the three properties the route needs, verified by reading
 * every writer of it in the API:
 *   * it is set on first dispatch and thereafter only ever OVERWRITTEN with
 *     another command id — no code path in this codebase nulls it, including
 *     order cancellation, which only reads it;
 *   * the transient-retry path returns a record to `not_synced` WITHOUT
 *     clearing it, so a retried order re-reads its committed route instead of
 *     re-deriving one;
 *   * it is `@unique`, so an order cannot point at two commands at once.
 *
 * A dedicated `POSSyncRecord.dineInRoute` enum column is still the better long
 * -term home and is the recommended follow-up: it would make the route legible
 * without a join, queryable for operations ("which orders are on native?"),
 * and independent of the command lifecycle. It is deliberately NOT added
 * tonight — it needs a migration, and a migration is a production change this
 * work is explicitly not making. Nothing about the seam changes when it lands:
 * `resolveDineInRoute` already takes the persisted route as an input, so the
 * column simply becomes a second, cheaper source for the same value.
 */

/** The two mutually exclusive dine-in transports. Never a bitmask, never a list. */
export enum DineInPosRoute {
  WEBIT = 'WEBIT',
  NATIVE_IDEALPOS_TABLE = 'NATIVE_IDEALPOS_TABLE',
}

/**
 * The connector command type carrying a native table round.
 *
 * No connector build advertises the matching capability today, which is the
 * second, independent gate keeping this route inert: even a venue whose config
 * selected NATIVE cannot have a command created for it until a connector
 * reports `idealpos.native_table_round.v1`.
 */
export const IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE = 'idealpos.native_table_round.v1';
export const IDEALPOS_NATIVE_TABLE_ROUND_SCHEMA_VERSION = 1;
export const IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY = 'idealpos.native_table_round.v1';

/** The configuration key an operator sets to select a route for a venue's dine-in orders. */
export const DINE_IN_ROUTE_CONFIG_KEY = 'IDEALPOS_DINE_IN_ROUTE';

/**
 * Command type → route. This is the function that makes an already-created
 * command the durable record of which route an order took: the command type is
 * written once, is immutable, and is reachable from the order through
 * `POSSyncRecord.connectorSubmitCommandId`.
 *
 * Returns null for a command type that belongs to neither route, so an
 * unrelated command can never be mistaken for a routing decision.
 */
export function routeOfCommandType(commandType: string | null | undefined): DineInPosRoute | null {
  if (commandType === 'idealpos.submit_order.v1') return DineInPosRoute.WEBIT;
  if (commandType === IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE)
    return DineInPosRoute.NATIVE_IDEALPOS_TABLE;
  return null;
}

export interface DineInRouteInputs {
  /**
   * The raw configured value, exactly as read from configuration. `undefined`,
   * `null` and `''` all mean "not configured", which is a valid, documented
   * state meaning WEBIT — not an error.
   */
  readonly configuredValue?: string | null;

  /**
   * The command type of the command already associated with this order, if
   * any. When present it WINS: see the stickiness rule.
   */
  readonly existingCommandType?: string | null;
}

export type DineInRouteDecision =
  | {
      readonly decision: 'route';
      readonly route: DineInPosRoute;
      /** True when the route came from an existing command rather than from configuration. */
      readonly sticky: boolean;
      readonly reason: string;
    }
  | {
      /**
       * Refuse to dispatch at all. Never a route, and specifically never a
       * fallback to the other route.
       */
      readonly decision: 'refuse';
      readonly reason: string;
    };

/**
 * Resolves the route for one dine-in order.
 *
 * THE STICKINESS RULE. If this order already has a command, that command's type
 * IS the route — configuration is not consulted. This is what makes the route
 * durable order truth rather than a value recomputed per sweep tick:
 *
 *   * a connector restart, an API restart, or a config change between attempts
 *     cannot move an in-flight order to the other transport;
 *   * an order whose native round may already have crossed the send boundary
 *     cannot be "rescued" onto Webit by flipping a flag, which is the single
 *     most dangerous edit an operator could make — it is how one order becomes
 *     two dockets on the same table.
 *
 * The route is therefore decided exactly once, on the first dispatch, and is
 * read back from durable state forever after.
 *
 * THE CONFIGURATION RULE. Unset means WEBIT: that is the documented default and
 * production sets nothing. A value that is set but UNRECOGNIZED is an operator
 * error, and is refused rather than defaulted. Defaulting there would be worse
 * than it looks — an operator who typed `NATIVE_IDEALPOS_TABEL` during
 * certification would believe they were exercising the native path while every
 * order quietly went through Webit, and the certification would be worthless.
 * Because production leaves the key unset, this branch cannot change production
 * behaviour.
 */
export function resolveDineInRoute(inputs: DineInRouteInputs): DineInRouteDecision {
  const { configuredValue, existingCommandType } = inputs;

  // ── Stickiness: durable state outranks configuration, always. ──
  if (existingCommandType != null && existingCommandType !== '') {
    const existing = routeOfCommandType(existingCommandType);
    if (existing !== null) {
      return {
        decision: 'route',
        route: existing,
        sticky: true,
        reason:
          `this order is already committed to ${existing} by its existing command ` +
          `('${existingCommandType}'); configuration is not consulted for an order already in flight`,
      };
    }
    // A command exists but belongs to neither route. Something else owns this
    // record; choosing a route now could add a second transport to an order
    // that already has one.
    return {
      decision: 'refuse',
      reason:
        `this order is associated with command type '${existingCommandType}', which is neither dine-in route — ` +
        'refusing to select a route rather than risk adding a second transport to an order that already has one',
    };
  }

  // ── No command yet: configuration decides, once. ──
  if (configuredValue == null || configuredValue.trim() === '') {
    return {
      decision: 'route',
      route: DineInPosRoute.WEBIT,
      sticky: false,
      reason: `${DINE_IN_ROUTE_CONFIG_KEY} is not set; defaulting to the certified WEBIT path`,
    };
  }

  const normalized = configuredValue.trim().toUpperCase();
  if (normalized === DineInPosRoute.WEBIT) {
    return {
      decision: 'route',
      route: DineInPosRoute.WEBIT,
      sticky: false,
      reason: `${DINE_IN_ROUTE_CONFIG_KEY} selected WEBIT`,
    };
  }
  if (normalized === DineInPosRoute.NATIVE_IDEALPOS_TABLE) {
    return {
      decision: 'route',
      route: DineInPosRoute.NATIVE_IDEALPOS_TABLE,
      sticky: false,
      reason: `${DINE_IN_ROUTE_CONFIG_KEY} selected NATIVE_IDEALPOS_TABLE`,
    };
  }

  return {
    decision: 'refuse',
    reason:
      `${DINE_IN_ROUTE_CONFIG_KEY} is set to '${configuredValue}', which is not a recognized route ` +
      `(expected ${DineInPosRoute.WEBIT} or ${DineInPosRoute.NATIVE_IDEALPOS_TABLE}). Refusing to dispatch: ` +
      'silently defaulting would hide a misconfiguration behind apparently-normal behaviour',
  };
}

/**
 * The command type a route dispatches. Exhaustive over the enum, so adding a
 * third route is a compile error here rather than a silent no-op at the call
 * site.
 */
export function commandTypeForRoute(route: DineInPosRoute): string {
  switch (route) {
    case DineInPosRoute.WEBIT:
      return 'idealpos.submit_order.v1';
    case DineInPosRoute.NATIVE_IDEALPOS_TABLE:
      return IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE;
  }
}

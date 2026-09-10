/**
 * WHICH POS PIPELINE OWNS AN ORDER. Decided once, written down, never revisited.
 *
 * THE FAILURE THIS FILE EXISTS TO MAKE IMPOSSIBLE. Verdura now has two ways to
 * put a dine-in order into IdealPOS:
 *
 *   WEBIT               the certified path. `POSSyncRecord(not_synced)` is
 *                       created with the order; `IdealposOrderDispatcherService`
 *                       sweeps it up, creates an `idealpos.submit_order.v1`
 *                       ConnectorCommand, and the connector POSTs it to
 *                       IdealposBridge, which writes `dbo.WebPendingOrder`.
 *   NATIVE_TABLE_ROUND  the handheld path. `NativeTableRoundService` opens a
 *                       round and writes an Order2 packet straight at the
 *                       till's WaiterPad listener over TCP.
 *
 * Those two pipelines share NOTHING. They have different transports, different
 * confirmation evidence, different retry semantics and different owners. What
 * they did share, until this file, was a candidate set: both dispatcher sweeps
 * select on `POSSyncRecord.status = not_synced`, and the native service does
 * not touch `POSSyncRecord` at all. So a native round could land on Table 5,
 * and five seconds later the Webit sweep could pick the same order up and send
 * it again through the Bridge - one restaurant order, two dockets, two bills,
 * and nobody the wiser until the customer disputes the total.
 *
 * That is not a bug you fix by remembering to check a flag. It is fixed by
 * making the two pipelines' candidate sets provably disjoint in the database.
 *
 * THE INVARIANT:
 *
 *     Every order that has a POSSyncRecord has exactly ONE strategy, chosen in
 *     the same transaction that creates the order, and no code path anywhere
 *     changes it afterwards.
 *
 * WHY THAT PLACE AND NOT A LATER ONE. Every alternative decision point admits a
 * race. Decide at dispatch time and two workers can decide differently. Decide
 * in the controller and a restart loses it. Decide from configuration on each
 * read and an operator editing an env var mid-service re-routes orders that are
 * already in flight - the single most dangerous edit available, because it is
 * how an order that may already be on the native tab gets "rescued" onto Webit.
 * Deciding inside the creating transaction has none of those properties: there
 * is exactly one writer, it runs exactly once, and it commits atomically with
 * the order itself. There is no second claim to lose, so there is no race to
 * resolve.
 *
 * HOW EXCLUSIVITY IS ENFORCED, IN THREE INDEPENDENT LAYERS. Any one of them
 * would do; all three are present because the cost of the failure is a wrong
 * bill in front of a real customer.
 *
 *   1. STATUS. A native-owned record is created at `owned_by_native`, which is
 *      not `not_synced`. Both sweeps' existing candidate queries already
 *      require `not_synced`, so a native order is outside their candidate set
 *      even for code that has never heard of this file.
 *   2. STRATEGY COLUMN. Both sweeps additionally filter `strategy: webit`, and
 *      `IdealposOrderDispatcherService` re-checks it per row AFTER claiming, so
 *      a row that somehow reached the candidate set is still refused before any
 *      ConnectorCommand can be created.
 *   3. THE NATIVE SERVICE'S OWN GUARD. `NativeTableRoundService.openRound`
 *      refuses an order whose record says `webit`, so the exclusion runs in
 *      both directions rather than only protecting the native path.
 *
 * FAIL CLOSED, NEVER FAIL OVER. If a venue is configured for the native route
 * and the native writer is not actually usable - feature off, host missing,
 * identity invalid - this file returns `refuse`, and order creation fails. It
 * does NOT quietly return `webit`. Falling back would mean an operator who
 * believed they were running the native handheld workflow was in fact running
 * Webit, discovering it only from a docket that printed the wrong way. A
 * refused order is a visible problem at the tablet, which is a problem someone
 * fixes. A silent transport switch is a problem nobody sees.
 */

import { PosSubmissionStrategy, ServiceMode } from '@prisma/client';

/**
 * The two mutually exclusive POS submission pipelines. Never a list, never a
 * bitmask.
 *
 * RE-EXPORTED FROM THE GENERATED CLIENT RATHER THAN DECLARED HERE. A
 * hand-written TypeScript enum with the same member names would compile, read
 * identically, and silently diverge from the database the first time someone
 * renamed a value on one side only. There is one definition, it lives in
 * `schema.prisma`, and this is a convenience alias so callers can import the
 * decision and the type it returns from the same module.
 */
export { PosSubmissionStrategy };

/**
 * The configuration key selecting a venue's dine-in strategy.
 *
 * Deliberately a DIFFERENT key from `dine-in-route.ts`'s
 * `IDEALPOS_DINE_IN_ROUTE`, which selects between two CONNECTOR-mediated routes
 * and is a separate, still-inert seam. Sharing one key would make a value set
 * for one mechanism silently arm the other.
 */
export const POS_STRATEGY_CONFIG_KEY = 'IDEALPOS_POS_STRATEGY';

export type PosStrategyDecision =
  | {
      readonly decision: 'strategy';
      readonly strategy: PosSubmissionStrategy;
      readonly reason: string;
    }
  | {
      /**
       * Create nothing. Specifically NOT a fallback to the other strategy - the
       * caller must surface this to staff, not route around it.
       */
      readonly decision: 'refuse';
      readonly reason: string;
    };

export interface PosStrategyInputs {
  /**
   * The raw configured value, exactly as read. `undefined`, `null` and `''` all
   * mean "not configured", which is a valid documented state meaning WEBIT -
   * not an error. Production sets nothing, so production is unchanged.
   */
  readonly configuredValue?: string | null;

  /** dine_in or takeaway. Only dine_in can ever be native: Order2 addresses a table. */
  readonly serviceMode: ServiceMode;

  /**
   * Whether the native writer resolved a complete, valid configuration at
   * startup - i.e. whether a packet could actually leave this host. False when
   * the feature is off AND when it is on but misconfigured; the caller cannot
   * tell those apart and must not try, because the correct handling is
   * identical.
   */
  readonly nativeWriterUsable: boolean;

  /** Why the writer is unusable, for the refusal message. Ignored when it is usable. */
  readonly nativeWriterReasons?: readonly string[];
}

/**
 * Choose the strategy for one order.
 *
 * Pure: no clock, no database, no environment read of its own. Everything it
 * decides from is an argument, so every branch below is reachable from a test
 * without standing up a venue.
 */
export function decidePosSubmissionStrategy(inputs: PosStrategyInputs): PosStrategyDecision {
  const { configuredValue, serviceMode, nativeWriterUsable, nativeWriterReasons } = inputs;

  // -- Unset: today's production state, and today's production behaviour. --
  if (configuredValue == null || configuredValue.trim() === '') {
    return {
      decision: 'strategy',
      strategy: PosSubmissionStrategy.webit,
      reason: `${POS_STRATEGY_CONFIG_KEY} is not set; the certified Webit path owns this order`,
    };
  }

  const normalized = configuredValue.trim().toLowerCase();

  if (normalized === PosSubmissionStrategy.webit) {
    return {
      decision: 'strategy',
      strategy: PosSubmissionStrategy.webit,
      reason: `${POS_STRATEGY_CONFIG_KEY} selected webit`,
    };
  }

  if (normalized === PosSubmissionStrategy.native_table_round) {
    // A takeaway order has no table, and Order2's <Table> element is not
    // optional. This is not a fallback: takeaway was never eligible for the
    // native route, so routing it to Webit adds no second transport to
    // anything. The dine-in exclusivity invariant is untouched.
    if (serviceMode !== ServiceMode.dine_in) {
      return {
        decision: 'strategy',
        strategy: PosSubmissionStrategy.webit,
        reason:
          `${POS_STRATEGY_CONFIG_KEY} selected native_table_round, but this order is ` +
          `${serviceMode}. The native handheld protocol addresses a table and a takeaway ` +
          'order has none, so it takes the Webit path it has always taken. No table-bound ' +
          'order is affected by this branch.',
      };
    }

    // Fail closed. See the file header: a silent switch to Webit here is how an
    // operator ends up certifying a path they are not running.
    if (!nativeWriterUsable) {
      const detail = (nativeWriterReasons ?? []).join('; ') || 'no reason was reported';
      return {
        decision: 'refuse',
        reason:
          `${POS_STRATEGY_CONFIG_KEY} selects native_table_round, but the native writer ` +
          `cannot send: ${detail}. Refusing this order rather than silently routing it ` +
          'through Webit - a transport switch nobody asked for is worse than a visible ' +
          'refusal at the tablet.',
      };
    }

    return {
      decision: 'strategy',
      strategy: PosSubmissionStrategy.native_table_round,
      reason: `${POS_STRATEGY_CONFIG_KEY} selected native_table_round and the native writer is usable`,
    };
  }

  // Set but unrecognised. Refusing beats defaulting: an operator who typed
  // `NATIVE_TABLE_ROUNS` during certification would otherwise believe they were
  // exercising the native path while every order went through Webit, and the
  // certification would be worthless.
  return {
    decision: 'refuse',
    reason:
      `${POS_STRATEGY_CONFIG_KEY} is set to '${configuredValue}', which is not a recognised ` +
      `strategy (expected '${PosSubmissionStrategy.webit}' or ` +
      `'${PosSubmissionStrategy.native_table_round}'). Refusing to create this order: ` +
      'defaulting would hide a misconfiguration behind apparently-normal behaviour.',
  };
}

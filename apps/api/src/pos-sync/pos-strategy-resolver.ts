/**
 * The one place the running application asks "who owns this order?".
 *
 * `decidePosSubmissionStrategy` is pure and knows nothing about Nest, env vars
 * or the WaiterPad writer. This is the thin injectable that feeds it the two
 * real-world inputs - the operator's configured value, and whether the native
 * writer could actually send a packet if asked.
 *
 * WHY IT RESOLVES THE WRITER CONFIG ITSELF RATHER THAN ASKING THE WRITER.
 * `waiterpad-writer.provider.ts` deliberately hands consumers an opaque
 * `ITableRoundWriter` with no way to ask which implementation they received,
 * because a consumer that can tell the difference eventually branches on it,
 * and a branch is where a fallback gets added. That property is worth keeping.
 * So this resolver runs the SAME pure `resolveWaiterPadConfig` over the SAME
 * ConfigService keys and reaches the same conclusion independently. Two readers
 * of one pure function over one configuration cannot disagree.
 *
 * IT IS ALSO WHY THIS HAS NO DEPENDENCY ON PosSyncModule. `OrdersModule` cannot
 * import `PosSyncModule` - that module already imports OrdersModule for
 * OrdersGateway, and the edge would be circular. This provider needs only
 * ConfigService, so OrdersModule registers it directly.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ServiceMode } from '@prisma/client';

import {
  decidePosSubmissionStrategy,
  POS_STRATEGY_CONFIG_KEY,
  type PosStrategyDecision,
} from './pos-submission-strategy';
import { resolveWaiterPadConfig } from './waiterpad/waiterpad-config';
import { readWaiterPadEnv } from './waiterpad/waiterpad-writer.provider';

@Injectable()
export class PosStrategyResolver {
  private readonly logger = new Logger(PosStrategyResolver.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Whether a native Order2 packet could leave this host at all.
   *
   * Re-read on every call rather than cached at construction. A cached value
   * would be wrong for the whole process lifetime after a config reload, and
   * the read is a handful of `config.get` calls over an in-memory map - there
   * is nothing to save.
   */
  nativeWriterUsable(): { usable: boolean; reasons: readonly string[] } {
    const resolution = resolveWaiterPadConfig(readWaiterPadEnv(this.config));
    return resolution.enabled
      ? { usable: true, reasons: [] }
      : { usable: false, reasons: resolution.reasons };
  }

  /**
   * Decide the strategy for one order about to be created.
   *
   * Returns the decision rather than throwing, because the two outcomes need
   * different handling by the caller: a strategy is written into the order's
   * transaction, a refusal must become a staff-visible rejection BEFORE any
   * order row exists.
   */
  decide(serviceMode: ServiceMode): PosStrategyDecision {
    const { usable, reasons } = this.nativeWriterUsable();
    const decision = decidePosSubmissionStrategy({
      configuredValue: this.config.get<string>(POS_STRATEGY_CONFIG_KEY),
      serviceMode,
      nativeWriterUsable: usable,
      nativeWriterReasons: reasons,
    });

    if (decision.decision === 'refuse') {
      // An operator asked for something the system cannot safely do. This is
      // the loud half of failing closed - the quiet half is that no order row
      // is created, which staff see immediately at the tablet.
      this.logger.error(`Refusing to create an order: ${decision.reason}`);
    }

    return decision;
  }
}

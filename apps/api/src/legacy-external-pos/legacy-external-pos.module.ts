import { Module } from '@nestjs/common';
import { ConnectorModule } from '../connector/connector.module';
import { PosStrategyResolver } from '../pos-sync/pos-strategy-resolver';
import { LegacyExternalPosHandoff } from './legacy-external-pos-handoff';

/**
 * TEMPORARY. Isolates the IdealPOS handoff from canonical order creation
 * until the integration is retired (see ./README.md).
 *
 * Must never import OrdersModule or PosSyncModule: PosSyncModule already
 * imports OrdersModule, and OrdersModule imports this module, so either edge
 * would be circular. PosStrategyResolver depends only on ConfigService, which
 * is why it is registered here rather than imported from PosSyncModule.
 */
@Module({
  imports: [ConnectorModule],
  providers: [PosStrategyResolver, LegacyExternalPosHandoff],
  exports: [LegacyExternalPosHandoff],
})
export class LegacyExternalPosModule {}

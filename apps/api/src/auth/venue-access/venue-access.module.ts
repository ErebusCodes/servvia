import { Global, Module } from '@nestjs/common';
import { VenueAccessGuard } from './venue-access.guard';
import { VenueAccessService } from './venue-access.service';

/** Story 2.10: staff venue access, available to every controller. */
@Global()
@Module({
  providers: [VenueAccessService, VenueAccessGuard],
  exports: [VenueAccessService, VenueAccessGuard],
})
export class VenueAccessModule {}

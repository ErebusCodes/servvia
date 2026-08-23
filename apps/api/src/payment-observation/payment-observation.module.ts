import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentObservationController } from './payment-observation.controller';
import { PaymentObservationFixtureInjectionController } from './payment-observation-fixture-injection.controller';
import { PaymentObservationService } from './payment-observation.service';

@Module({
  imports: [AuthModule],
  controllers: [PaymentObservationController, PaymentObservationFixtureInjectionController],
  providers: [PaymentObservationService],
  exports: [PaymentObservationService],
})
export class PaymentObservationModule {}

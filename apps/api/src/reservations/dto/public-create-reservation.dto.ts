import { IsIn, IsOptional } from 'class-validator';
import { CreateReservationDto } from './create-reservation.dto';

/**
 * The customer-facing reservation payload. Identical to CreateReservationDto
 * except payment method is restricted to the two deferred-payment options
 * DL-048 allows for online booking (card integration is explicitly out of
 * scope for MVP) — enforced here at the validation layer, not just hidden in
 * the UI, so this can never be bypassed by calling the API directly.
 */
export class PublicCreateReservationDto extends CreateReservationDto {
  @IsOptional()
  @IsIn(['bank_transfer', 'pay_at_restaurant'])
  declare paymentMethod?: 'bank_transfer' | 'pay_at_restaurant';
}

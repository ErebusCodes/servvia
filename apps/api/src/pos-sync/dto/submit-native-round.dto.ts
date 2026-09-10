import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { CreateOrderItemDto } from '../../orders/dto/create-order.dto';

/**
 * One press of Send to Kitchen on the Order Tablet, for a native IdealPOS venue.
 *
 * WHAT A REQUEST MEANS. "Add these lines to this order, then send everything on
 * it that no round has carried yet." Round one sends an empty `items` - the
 * order was created with its lines already. Round two carries the mains the
 * waiter has just typed and nothing else.
 *
 * `items` MAY BE EMPTY, and that is not a client bug. It is the first round of
 * an order, and it is also a legitimate retry of a round that failed before
 * anything left the device.
 */
export class SubmitNativeRoundDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  /**
   * The client's own key for THIS press of the button, minted once when the
   * press happens and reused byte-for-byte by any retry of the same press.
   *
   * IT IS THE DOUBLE-TAP GUARD, and it is required rather than optional
   * because there is no safe default: a missing key means two taps become two
   * rounds and a customer gets two of everything. `NativeTableRound.requestKey`
   * is unique, so the second tap loses at the database and is answered with the
   * first tap's round.
   *
   * A NEW round needs a NEW key. Reusing the previous round's key would be
   * answered with that round's outcome and would send nothing - which is
   * exactly right for a repeated tap and exactly wrong for a genuinely new
   * course.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  @MaxLength(255)
  requestKey: string;
}

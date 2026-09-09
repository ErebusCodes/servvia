import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceMode } from '@prisma/client';
import { CreateOrderItemDto } from './create-order.dto';

/**
 * Order creation for staff-operated surfaces (Order Tablet, future POS).
 * Deliberately separate from CreateOrderDto: never prepaid at submission
 * time (no stripePaymentIntentId) — payment happens later, entirely in
 * native IdealPOS/EFTPOS.
 *
 * Story 15-13: `serviceMode` is the single authoritative dine-in/takeaway
 * signal — `tableId` is present (and required) only for `dine_in`; for
 * `takeaway` it must be omitted, never fabricated. This DTO only validates
 * each field's own shape when present; the mode-dependent presence/absence
 * rule itself is enforced in `OrdersService.createStaffOrder` (this
 * codebase's established pattern — see that method's own doc comment —
 * rather than a conditional class-validator decorator chain), so the
 * rejection message can carry the same detail the service's other
 * business-rule rejections already do.
 */
export class CreateStaffOrderDto {
  @IsUUID()
  venueId: string;

  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsEnum(ServiceMode)
  serviceMode: ServiceMode;

  /**
   * Covers, as the waiter set them when opening the table.
   *
   * Optional because takeaway has none and an older tablet build does not send
   * it, and NOT inferred when absent. The Order Tablet used to write the count
   * into `notes` as the free text "Guests: N" and read it back with a
   * hardcoded fallback of 2 - fine for a summary line, not fine for `<Guests>`
   * in a native Order2 round, where the till takes the number as fact and it
   * lands on a real bill.
   */
  @IsInt()
  @Min(1)
  @Max(99)
  @IsOptional()
  guests?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  /** See CreateOrderDto.idempotencyKey — Story 6-1 applies the same guarantee to staff-tablet orders. */
  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  @MaxLength(255)
  idempotencyKey: string;
}

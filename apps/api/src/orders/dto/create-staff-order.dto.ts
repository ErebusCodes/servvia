import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

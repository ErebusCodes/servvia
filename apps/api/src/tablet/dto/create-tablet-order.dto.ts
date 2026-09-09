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
import { CreateOrderItemDto } from '../../orders/dto/create-order.dto';

/**
 * Restricted/customer-context order submission (story 15-1, DL-081) —
 * deliberately narrower than CreateStaffOrderDto: no venueId field, because
 * a bare device token's venue comes only from its own token claim, never
 * from client-supplied input (see TabletOrdersController).
 *
 * Story 15-13: `serviceMode`/`tableId` follow the identical contract as
 * `CreateStaffOrderDto` — see that DTO's doc comment.
 */
export class CreateTabletOrderDto {
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsEnum(ServiceMode)
  serviceMode!: ServiceMode;

  /** Covers. Same contract as `CreateStaffOrderDto.guests` - see that DTO. */
  @IsInt()
  @Min(1)
  @Max(99)
  @IsOptional()
  guests?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  @MaxLength(255)
  idempotencyKey!: string;
}

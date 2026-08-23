import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';
import { ReservationGuestDto } from './reservation-guest.dto';

export class CreateReservationDto {
  @IsUUID()
  venueId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  guestName: string;

  @IsEmail()
  guestEmail: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  guestPhone?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  partySize: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  reservationDate: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  reservationTime: string;

  @IsUUID()
  @IsOptional()
  tableId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  occasion?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  specialRequests?: string;

  // Per DL-048, card payment is deferred for MVP — the full Prisma enum is
  // accepted here (the staff-facing admin/reservations path may legitimately
  // record a card/cash payment taken by other means); the public customer
  // endpoint (public-create-reservation.dto.ts) tightens this to
  // bank_transfer | pay_at_restaurant only.
  @IsOptional()
  @IsIn(['card', 'bank_transfer', 'pay_at_restaurant', 'cash'] satisfies PaymentMethod[])
  paymentMethod?: PaymentMethod;

  // Optional pre-order snapshot from the booking wizard's menu step — stored
  // as-is (Json column); not re-priced/re-validated against the live menu
  // here since payment for it is always deferred to bank-transfer/
  // pay-at-restaurant, never charged automatically.
  @IsOptional()
  menuSelections?: unknown;

  @IsOptional()
  @IsNumber()
  @Min(0)
  menuTotal?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReservationGuestDto)
  guests?: ReservationGuestDto[];
}

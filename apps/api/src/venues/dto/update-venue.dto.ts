import {
  IsString,
  IsOptional,
  IsObject,
  IsInt,
  Min,
  IsEmail,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { POSAdapterType } from '@prisma/client';

export class UpdateVenueDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsObject()
  address?: Record<string, any>;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  taxJurisdiction?: string;

  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;

  @IsOptional()
  @IsObject()
  operatingHours?: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(0)
  seatingCapacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  coversPerSlot?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  reservationSlotMinutes?: number;

  @IsOptional()
  @IsEnum(POSAdapterType)
  posAdapterType?: POSAdapterType;

  @IsOptional()
  @IsObject()
  posConfig?: Record<string, any>;
}

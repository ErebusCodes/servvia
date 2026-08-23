import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsInt,
  Min,
  IsEmail,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { POSAdapterType } from '@prisma/client';

export class CreateVenueDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  slug!: string;

  @IsObject()
  @IsNotEmpty()
  address!: Record<string, any>;

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

  @IsObject()
  @IsNotEmpty()
  operatingHours!: Record<string, any>;

  @IsInt()
  @Min(0)
  seatingCapacity!: number;

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

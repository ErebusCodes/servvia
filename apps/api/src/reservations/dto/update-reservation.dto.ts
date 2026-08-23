import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateReservationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @IsOptional()
  guestName?: string;

  @IsEmail()
  @IsOptional()
  guestEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  guestPhone?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  partySize?: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  reservationDate?: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  @IsOptional()
  reservationTime?: string;

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
}

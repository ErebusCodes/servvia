import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReservationGuestDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryPreferences?: string[];
}

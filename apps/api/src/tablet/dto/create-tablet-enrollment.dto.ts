import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTabletEnrollmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;
}

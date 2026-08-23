import { IsString, IsOptional, IsInt, Min, IsBoolean, MaxLength } from 'class-validator';

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  tableNumber?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // See CreateTableDto.posTableCode.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  posTableCode?: string;
}

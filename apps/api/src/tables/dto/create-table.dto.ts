import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  tableNumber!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // Exact native POS table identifier (for IdealPOS: TableMapSetups.Caption,
  // fetched from the bridge's own GET /api/tables) — never derived from
  // tableNumber. 200-char bound is a sane sanity limit, not a confirmed
  // bridge constraint (the bridge's own documented length limit is on
  // `externalOrderId`, not `table` — OrderValidator.cs).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  posTableCode?: string;
}

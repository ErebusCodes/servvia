import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Typed shape for the entries inside `MenuItem.modifierGroups` (still a raw
 * JSON column per DL-017 — this is authoring/consumption-boundary typing,
 * not a schema migration). `id` is optional on input: the service assigns a
 * `crypto.randomUUID()` to any group/option an author submits without one
 * (a genuinely new entry), and preserves any id the author does supply
 * (an edit to an existing entry) — see `menu-items.service.ts`.
 */
export class ModifierOptionDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  // Non-negative only: nothing in the documented domain model calls for a
  // negative modifier price adjustment (that would be a discount wearing a
  // modifier's clothes) — see the story's promotion-scope decision.
  @IsInt()
  @Min(0)
  priceDeltaCents!: number;

  @IsBoolean()
  isAvailable!: boolean;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ModifierGroupDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsBoolean()
  required!: boolean;

  @IsInt()
  @Min(0)
  minSelections!: number;

  @IsInt()
  @Min(1)
  maxSelections!: number;

  @ValidateNested({ each: true })
  @Type(() => ModifierOptionDto)
  @ArrayMinSize(1)
  options!: ModifierOptionDto[];
}

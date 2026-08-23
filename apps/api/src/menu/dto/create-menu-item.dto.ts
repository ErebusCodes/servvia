import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsObject,
  IsArray,
  IsUUID,
  Matches,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IMAGE_URL_PATTERN, IMAGE_URL_MESSAGE } from './image-url.pattern';
import { ModifierGroupDto } from './modifier-group.dto';

export class CreateMenuItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @IsUUID()
  categoryId!: string;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subCategory?: string;

  @IsOptional()
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  imageUrl?: string;

  @IsOptional()
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  imageThumbnailUrl?: string;

  @IsOptional()
  @IsObject()
  nutritionalDetails?: Record<string, object>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModifierGroupDto)
  modifierGroups?: ModifierGroupDto[];

  @IsOptional()
  @IsBoolean()
  isSpicy?: boolean;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  // Exact native POS product/stock-item code (for IdealPOS: the `code`
  // field of GET /api/products) — never derived from this item's id or
  // title; the bridge does no name-based product matching.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  posProductCode?: string;
}

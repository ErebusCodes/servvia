import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsObject,
  IsArray,
  IsEnum,
  IsUUID,
  Matches,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MenuChannel } from '@prisma/client';
import { IMAGE_URL_PATTERN, IMAGE_URL_MESSAGE } from './image-url.pattern';
import { ModifierGroupDto } from './modifier-group.dto';

export class UpdateMenuItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  priceCents?: number;

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

  // See CreateMenuItemDto.posProductCode — DEPRECATED, retained until
  // Phase E; Admin Console no longer presents a free-text control for it.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  posProductCode?: string;

  // See CreateMenuItemDto.visibleChannels. `undefined` (omitted from this
  // PATCH) must leave the stored value untouched — see
  // MenuItemsService#update's explicit undefined-passthrough handling.
  @IsOptional()
  @IsArray()
  @IsEnum(MenuChannel, { each: true })
  visibleChannels?: MenuChannel[];

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

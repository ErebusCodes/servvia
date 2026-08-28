import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  IsEnum,
  Matches,
  Min,
} from 'class-validator';
import { MenuChannel } from '@prisma/client';
import { IMAGE_URL_PATTERN, IMAGE_URL_MESSAGE } from './image-url.pattern';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // See CreateCategoryDto.visibleChannels. `undefined` (field omitted from
  // this PATCH) must leave the stored value untouched — see
  // CategoriesService#update's explicit undefined-passthrough handling.
  @IsOptional()
  @IsArray()
  @IsEnum(MenuChannel, { each: true })
  visibleChannels?: MenuChannel[];
}

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

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

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

  // Menu Management: which customer/staff-facing surfaces this category
  // may render on. Deliberately omitted-by-default (never defaulted to
  // "all channels" here) — a freshly created category stays invisible
  // everywhere until a human explicitly publishes it, matching the
  // schema's own deny-by-default `@default([])`.
  @IsOptional()
  @IsArray()
  @IsEnum(MenuChannel, { each: true })
  visibleChannels?: MenuChannel[];
}

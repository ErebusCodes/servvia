import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MediaAssetPurpose } from '@prisma/client';

export class RequestUploadDto {
  @IsUUID()
  venueId!: string;

  @IsEnum(MediaAssetPurpose)
  purpose!: MediaAssetPurpose;

  @IsString()
  @MaxLength(255)
  originalFilename!: string;

  @IsString()
  @Matches(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/, { message: 'mimeType must be a valid MIME type' })
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(500 * 1024 * 1024)
  sizeBytes!: number;

  /** sha256, hex-encoded — declared before upload, verified after. */
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: 'checksum must be a lowercase hex sha256 digest' })
  checksum!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  altText?: string;
}

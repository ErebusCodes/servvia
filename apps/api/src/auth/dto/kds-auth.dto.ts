import { IsString, IsUUID } from 'class-validator';
import { IsPinLength } from '../validators/pin-length.validator';

export class KdsAuthDto {
  @IsUUID()
  venueId!: string;

  @IsString()
  @IsPinLength()
  pin!: string;
}

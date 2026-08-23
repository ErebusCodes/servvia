import { IsString } from 'class-validator';
import { IsPinLength } from '../../auth/validators/pin-length.validator';

export class TabletUnlockDto {
  @IsString()
  @IsPinLength()
  pin!: string;
}

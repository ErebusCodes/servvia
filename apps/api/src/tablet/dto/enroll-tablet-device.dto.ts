import { IsString, MinLength } from 'class-validator';

export class EnrollTabletDeviceDto {
  @IsString()
  @MinLength(1)
  bootstrapToken!: string;
}

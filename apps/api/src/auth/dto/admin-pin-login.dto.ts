import { IsString, Length, Matches } from 'class-validator';

export class AdminPinLoginDto {
  @IsString()
  @Length(3, 12)
  @Matches(/^\d+$/)
  pin!: string;
}

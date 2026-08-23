import { IsString, Length, Matches } from 'class-validator';

export class SetStaffPinDto {
  @IsString()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'pin must contain only digits' })
  pin!: string;
}

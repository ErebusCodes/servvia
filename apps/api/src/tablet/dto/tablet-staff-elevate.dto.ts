import { IsString, Length } from 'class-validator';

export class TabletStaffElevateDto {
  @IsString()
  @Length(4, 8)
  staffPin!: string;
}

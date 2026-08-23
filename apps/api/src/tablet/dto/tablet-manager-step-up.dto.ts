import { IsString, Length } from 'class-validator';

export class TabletManagerStepUpDto {
  @IsString()
  @Length(4, 8)
  managerPin!: string;
}

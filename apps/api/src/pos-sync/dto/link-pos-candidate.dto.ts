import { IsUUID } from 'class-validator';

export class LinkPosCandidateDto {
  @IsUUID()
  menuItemId!: string;
}

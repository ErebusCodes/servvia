import { IsUUID } from 'class-validator';

export class AssociateMenuItemDto {
  @IsUUID()
  menuItemId!: string;
}

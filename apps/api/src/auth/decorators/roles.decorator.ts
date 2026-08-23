import { SetMetadata, CustomDecorator } from '@nestjs/common';
import { StaffRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: StaffRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);

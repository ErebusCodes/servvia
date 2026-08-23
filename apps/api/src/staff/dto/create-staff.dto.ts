import { StaffRole } from '@prisma/client';

export class CreateStaffDto {
  organizationId: string;
  email: string;
  name: string;
  password: string;
  role: StaffRole;
}

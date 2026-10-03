import { StaffRole } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/** Reserved for synthetic system actors; never a staff member's address. */
const NOT_A_SYSTEM_ADDRESS = /^(?!.*@verdura\.internal$).*$/i;

export class CreateStaffAccountDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  @Matches(NOT_A_SYSTEM_ADDRESS, { message: 'email must be a real staff address' })
  email!: string;

  @IsEnum(StaffRole)
  role!: StaffRole;

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  venueIds!: string[];
}

export class UpdateStaffAccountDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;
}

/**
 * Story 8.1: a staff member sets their own password with a setup code.
 * Length bounds: at least 12 characters (NIST SP 800-63B requires at least
 * 8; 12 is this service's floor), at most 128 to bound hashing work.
 */
export class CredentialSetupDto {
  @IsString()
  @Length(10, 200)
  code!: string;

  @IsString()
  @Length(12, 128)
  password!: string;
}

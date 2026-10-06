import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Bounded so a request cannot make the server hash an arbitrarily large
  // input; generous, so no existing password is refused (new passwords are
  // at most 128, Story 8.1).
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}

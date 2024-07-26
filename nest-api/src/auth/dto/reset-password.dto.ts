import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { Match } from '../validators/match.decorator';

const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[A-Za-z])(?=.*\d).+$/;

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  @IsString()
  token!: string;

  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message: 'Password must contain both characters and numbers, with at least one uppercase and one lowercase letter.',
  })
  password!: string;

  @Match('password', { message: 'Passwords do not match.' })
  confirmPassword!: string;
}

import { IsNotEmpty, Matches, MinLength } from 'class-validator';
import { Match } from '../validators/match.decorator';

const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[A-Za-z])(?=.*\d).+$/;

export class ChangePasswordDto {
  @IsNotEmpty({ message: 'Password is required.' })
  currentPassword!: string;

  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message: 'Password must contain both characters and numbers, with at least one uppercase and one lowercase letter.',
  })
  newPassword!: string;

  @Match('newPassword', { message: 'Passwords do not match.' })
  confirmPassword!: string;
}

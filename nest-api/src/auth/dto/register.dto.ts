import { IsBoolean, IsDateString, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Gender } from '../gender.enum';
import { Match } from '../validators/match.decorator';

const PHONE_REGEX = /^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/;
// Mirrors RegisterDtoValidation's four separate password rules combined into one regex.
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[A-Za-z])(?=.*\d).+$/;

/**
 * Core (non-invitation) subset of MedExchange.Common...RegisterDto. Invitation-based registration,
 * the dev-only RegistrationCode gate, and email-confirmation sending are deferred (see
 * AuthService.RegisterAsync's invitations.EntityId branch, which this DTO/flow does not cover).
 *
 * Validation rules/messages are ported from RegisterDtoValidation (FluentValidation) so client-side
 * error text matches, even though .NET enforces these via automatic pre-action model validation
 * while here they run through Nest's ValidationPipe — the JSON error envelope differs.
 */
export class RegisterDto {
  @IsNotEmpty({ message: 'First Name is required.' })
  firstName!: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsNotEmpty({ message: 'Last Name is required.' })
  lastName!: string;

  @IsNotEmpty({ message: 'Email Address is required.' })
  @IsEmail({}, { message: 'Invalid email address.' })
  email!: string;

  @IsNotEmpty({ message: 'Phone number is required.' })
  @Matches(PHONE_REGEX, { message: 'Please enter a valid phone number.' })
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  suffix?: string;

  @IsDateString({}, { message: 'Invalid Date of Birth.' })
  dateOfBirth!: string;

  @IsEnum(Gender, { message: 'Invalid Gender.' })
  gender!: Gender;

  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message: 'Password must contain both characters and numbers, with at least one uppercase and one lowercase letter.',
  })
  password!: string;

  @Match('password', { message: 'Passwords do not match.' })
  confirmPassword!: string;

  @IsOptional()
  @IsBoolean()
  receiveSmsMessages?: boolean;
}

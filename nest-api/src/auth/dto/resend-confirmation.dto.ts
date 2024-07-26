import { IsEmail, IsNotEmpty } from 'class-validator';

export class ResendConfirmationEmailDto {
  @IsNotEmpty()
  @IsEmail()
  email!: string;
}

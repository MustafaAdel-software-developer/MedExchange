import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ExternalAuthDto {
  @IsNotEmpty()
  @IsIn(['GOOGLE', 'MICROSOFT'])
  provider!: 'GOOGLE' | 'MICROSOFT';

  @IsNotEmpty()
  @IsString()
  idToken!: string;

  @IsOptional()
  @IsString()
  accessToken?: string;
}

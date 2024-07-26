import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshTokenRequestDto {
  @IsNotEmpty()
  refreshToken!: string;

  /** Optional admin user id when refreshing under impersonation (mirrors RefreshTokenDto.ImpersonatedBy). */
  @IsOptional()
  @IsString()
  impersonatedBy?: string | null;
}

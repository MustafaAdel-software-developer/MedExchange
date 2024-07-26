import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthorizeEntityTokenGuard } from './guards/authorize-entity-token.guard';
import { AuthorizeEntityDataGuard } from './guards/authorize-entity-data.guard';
import { AuthorizeAdminEntityDataGuard } from './guards/authorize-admin-entity-data.guard';
import { AuthorizeUserDataGuard } from './guards/authorize-user-data.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordHasherService } from './password-hasher.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({}), MailModule],
  controllers: [AuthController],
  providers: [
    TokenService,
    PasswordHasherService,
    JwtAuthGuard,
    RefreshTokenService,
    AuthService,
    AuthorizeUserDataGuard,
    AuthorizeEntityTokenGuard,
    AuthorizeEntityDataGuard,
    AuthorizeAdminEntityDataGuard,
  ],
  exports: [
    TokenService,
    PasswordHasherService,
    JwtAuthGuard,
    RefreshTokenService,
    AuthService,
    AuthorizeUserDataGuard,
    AuthorizeEntityTokenGuard,
    AuthorizeEntityDataGuard,
    AuthorizeAdminEntityDataGuard,
  ],
})
export class AuthModule {}

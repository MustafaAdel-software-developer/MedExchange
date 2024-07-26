import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { GUID_EMPTY } from './auth-enums';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ExternalAuthDto } from './dto/external-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenRequestDto } from './dto/refresh-token-request.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationEmailDto } from './dto/resend-confirmation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthorizeEntityTokenGuard } from './guards/authorize-entity-token.guard';
import { AuthorizeUserDataGuard } from './guards/authorize-user-data.guard';

/**
 * Node port of Controllers/AuthenticationController.cs (core + entity token + email/reset/external) + Users GetUserById.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const { success, body } = await this.authService.login(dto, false);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('system-admin-login')
  @HttpCode(HttpStatus.OK)
  async systemAdminLogin(@Body() dto: LoginDto) {
    const { success, body } = await this.authService.login(dto, true);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @Body() dto: RegisterDto,
    @Query('EntityId') entityId?: string,
    @Query('InvitationId') invitationId?: string,
    @Query('InvitationDate') invitationDate?: string,
    @Query('staffRole') staffRole?: string,
    @Query('IsProvider') isProvider?: string,
  ) {
    const invitation =
      entityId || invitationId
        ? { entityId, invitationDate, staffRole, isProvider, invitationId }
        : undefined;
    const { success, body } = await this.authService.register(dto, invitation);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Get('confirm-email')
  @HttpCode(HttpStatus.OK)
  async confirmEmail(
    @Query('email') email: string,
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.confirmEmail(email, token);
    if (!result.success) {
      throw new HttpException(
        { status: 'Error', message: result.statusMessage ?? result.pathOrMessage },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (result.cookieValue) {
      res.cookie('userData', result.cookieValue, {
        httpOnly: false,
        secure: true,
        maxAge: 60 * 60 * 1000,
        sameSite: 'lax',
      });
    }
    return result.pathOrMessage;
  }

  @Post('resend-confirmation-email')
  @HttpCode(HttpStatus.OK)
  async resendConfirmationEmail(@Body() dto: ResendConfirmationEmailDto) {
    const { success, body } = await this.authService.resendConfirmationEmail(dto.email);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Query('email') email: string) {
    const { success, body } = await this.authService.forgotPassword(email, false);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('system-admin-forgot-password')
  @HttpCode(HttpStatus.OK)
  async systemAdminForgotPassword(@Query('email') email: string) {
    const { success, body } = await this.authService.forgotPassword(email, true);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const { success, body } = await this.authService.resetPassword(dto, false);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('system-admin-reset-password')
  @HttpCode(HttpStatus.OK)
  async systemAdminResetPassword(@Body() dto: ResetPasswordDto) {
    const { success, body } = await this.authService.resetPassword(dto, true);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('external-login')
  @HttpCode(HttpStatus.OK)
  async externalLogin(
    @Body() dto: ExternalAuthDto,
    @Query('EntityId') entityId?: string,
    @Query('InvitationId') invitationId?: string,
    @Query('InvitationDate') invitationDate?: string,
    @Query('staffRole') staffRole?: string,
    @Query('IsProvider') isProvider?: string,
  ) {
    const invitation =
      entityId || invitationId
        ? { entityId, invitationDate, staffRole, isProvider, invitationId }
        : undefined;
    const { success, body } = await this.authService.externalLogin(dto, invitation);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  /** Mirrors POST Authentication/RefreshToken/{entityId}. Also accepts POST /auth/refresh-token (empty guid). */
  @Post('refresh-token/:entityId')
  @HttpCode(HttpStatus.OK)
  async refreshTokenWithEntity(@Param('entityId') entityId: string, @Body() dto: RefreshTokenRequestDto) {
    const { success, body } = await this.authService.refreshToken(entityId, dto.refreshToken, dto.impersonatedBy);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body() dto: RefreshTokenRequestDto) {
    const { success, body } = await this.authService.refreshToken(GUID_EMPTY, dto.refreshToken, dto.impersonatedBy);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  /** Mirrors POST Authentication/GetToken/{entityId}/{dashboardView}. */
  @Post('get-token/:entityId/:dashboardView')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AuthorizeEntityTokenGuard)
  async getToken(
    @Req() req: AuthenticatedRequest,
    @Param('entityId') entityId: string,
    @Param('dashboardView', ParseIntPipe) dashboardView: number,
  ) {
    const { success, body } = await this.authService.getEntityToken(req.currentUser.Id, entityId, dashboardView);
    return success ? body : withStatus(body, HttpStatus.BAD_REQUEST);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logOut(@Req() req: AuthenticatedRequest, @Body() dto: RefreshTokenRequestDto) {
    const jti = req.user.jti as string;
    const { success, message } = await this.authService.logOut(dto.refreshToken, jti);
    return withStatus({ status: success ? 'Success' : 'Error', message }, success ? HttpStatus.OK : HttpStatus.BAD_REQUEST);
  }

  @Put('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    const { success, message } = await this.authService.changePassword(req.currentUser.Id, dto);
    return withStatus({ status: success ? 'Success' : 'Error', message }, success ? HttpStatus.OK : HttpStatus.BAD_REQUEST);
  }

  @Get('users/:userId')
  @UseGuards(JwtAuthGuard, AuthorizeUserDataGuard)
  async getUserById(@Param('userId') userId: string) {
    return this.authService.getUserById(userId);
  }
}

function withStatus<T extends object>(body: T, status: HttpStatus): T {
  if (status === HttpStatus.OK) return body;
  throw new HttpException(body, status);
}

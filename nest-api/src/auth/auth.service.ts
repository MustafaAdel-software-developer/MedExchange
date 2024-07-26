import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID } from 'crypto';
import { Users } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { GUID_EMPTY, isEmptyGuid } from './auth-enums';
import { AuthResponseDto, emptyAuthResponse } from './auth-response';
import { buildTokenClaims } from './build-core-claims';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ExternalAuthDto } from './dto/external-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { createPasswordResetToken, verifyPasswordResetToken } from './password-reset-token';
import { PasswordHasherService, PasswordVerificationResult } from './password-hasher.service';
import { RefreshTokenService } from './refresh-token.service';
import { getJwtSettings } from './jwt-config';
import { TokenService } from './token.service';

export interface AuthResult {
  success: boolean;
  body: AuthResponseDto;
}

export interface InvitationQuery {
  entityId?: string;
  invitationId?: string;
  invitationDate?: string;
  staffRole?: string;
  isProvider?: string;
}

/**
 * Node port of AuthService (MedExchange.DAL) core + entity-token + email confirm/reset slice.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto, isSysAdmin: boolean): Promise<AuthResult> {
    const user = await this.prisma.users.findFirst({ where: { Email: dto.email, IsAdmin: isSysAdmin } });
    if (!user) return { success: false, body: emptyAuthResponse({ message: 'Invalid login' }) };

    if (user.IsAdmin && !user.IsEnabled) return { success: false, body: emptyAuthResponse({ message: 'Invalid login' }) };
    if (!user.IsAdmin && isSysAdmin) return { success: false, body: emptyAuthResponse({ message: 'Invalid login' }) };
    if (user.IsAdmin && !isSysAdmin) return { success: false, body: emptyAuthResponse({ message: 'Invalid login' }) };

    if (!user.PasswordHash || this.passwordHasher.verifyHashedPassword(user.PasswordHash, dto.password) === PasswordVerificationResult.Failed) {
      return { success: false, body: emptyAuthResponse({ message: 'Invalid login' }) };
    }
    if (!user.EmailConfirmed) {
      return { success: false, body: emptyAuthResponse({ message: 'Email needs to be confirmed', email: dto.email }) };
    }

    const { entityId, lastDashboardView } = await this.resolveDefaultPractice(user.Id);
    const isCompletedRegister = user.Gender !== 0;
    const body = await this.issueTokenResponse(user, {
      isNew: false,
      isCompletedRegister,
      entityId,
    });
    return { success: true, body: { ...body, lastDashboardView } };
  }

  /** Core (no-invitation) branch of AuthService.RegisterAsync; sends confirmation email. */
  async register(dto: RegisterDto, invitation?: InvitationQuery): Promise<AuthResult> {
    if (!isValidAdultDob(dto.dateOfBirth)) {
      return { success: false, body: emptyAuthResponse({ message: 'Invalid Date of Birth.' }) };
    }

    if (invitation?.entityId) {
      // ASP.NET invitation query values are DataProtector-encrypted; Nest only accepts raw UUIDs until protector is ported.
      if (!isUuid(invitation.entityId)) {
        return {
          success: false,
          body: emptyAuthResponse({
            message: 'Invitation registration requires ASP.NET DataProtector-compatible query params (not yet ported). Use a raw EntityId UUID or register without invitation.',
          }),
        };
      }
      return this.registerWithInvitation(dto, invitation.entityId, invitation);
    }

    const emailTaken = await this.prisma.users.findFirst({ where: { Email: dto.email, IsAdmin: false } });
    if (emailTaken) return { success: false, body: emptyAuthResponse({ message: 'Email already exists.' }) };

    const phoneTaken = await this.prisma.users.findFirst({ where: { PhoneNumber: dto.phoneNumber } });
    if (phoneTaken) return { success: false, body: emptyAuthResponse({ message: 'Phone number already exists.' }) };

    const now = new Date();
    const userName = `${dto.firstName.trim().replace(/\s+/g, '')}${dto.lastName.trim().replace(/\s+/g, '')}${randomInt(100000, 999999)}`;
    const verificationCode = String(randomInt(100000, 999999));

    const user = await this.prisma.users.create({
      data: {
        Id: randomUUID(),
        UserName: userName,
        NormalizedUserName: userName.toUpperCase(),
        Email: dto.email,
        NormalizedEmail: dto.email.toUpperCase(),
        EmailConfirmed: false,
        PasswordHash: this.passwordHasher.hashPassword(dto.password),
        SecurityStamp: randomUUID(),
        ConcurrencyStamp: randomUUID(),
        PhoneNumber: dto.phoneNumber,
        PhoneNumberConfirmed: false,
        TwoFactorEnabled: false,
        LockoutEnabled: true,
        AccessFailedCount: 0,
        FirstName: dto.firstName,
        MiddleName: dto.middleName ?? null,
        LastName: dto.lastName,
        Suffix: dto.suffix ?? null,
        DateOfBirth: new Date(dto.dateOfBirth),
        Gender: dto.gender,
        IsAdmin: false,
        IsDeleted: false,
        CreatedAt: now,
        IsEnabled: false,
        VerificationCode: verificationCode,
        VerificationCodeCreatedAt: now,
        ReceiveSmsMessages: dto.receiveSmsMessages ?? false,
        TwilioOptedIn: true,
        ConnectionId: '',
      },
    });

    // .NET returns tokens but IsAuthenticated=false until email confirmed; ClientApp still stores them.
    const body = await this.issueTokenResponse(user, { isNew: false, isCompletedRegister: true, entityId: GUID_EMPTY });
    await this.sendConfirmationEmail(user.Email!, verificationCode);
    return {
      success: true,
      body: {
        ...body,
        email: user.Email,
        isAuthenticated: false,
        message: 'User created successfully.',
      },
    };
  }

  /**
   * Invitation register when EntityId is a raw UUID (Nest-friendly). Encrypted invitation
   * query strings from .NET email links are not supported until DataProtector is ported.
   */
  private async registerWithInvitation(dto: RegisterDto, entityId: string, invitation: InvitationQuery): Promise<AuthResult> {
    const entity = await this.prisma.entity.findFirst({ where: { Id: entityId, IsEnabled: true } });
    if (!entity) return { success: false, body: emptyAuthResponse({ message: 'Invalid entity id' }) };

    const invite = await this.prisma.invitations.findFirst({
      where: {
        EntityId: entityId,
        InvitedUserEmail: dto.email,
        ApplicationUserId: null,
        ...(invitation.staffRole && isUuid(invitation.staffRole) === false && !Number.isNaN(Number(invitation.staffRole))
          ? { StaffRole: Number(invitation.staffRole) }
          : {}),
      },
      orderBy: { InvitationDate: 'desc' },
    });
    if (!invite) {
      return { success: false, body: emptyAuthResponse({ message: 'Your entity does not sent any invitations' }) };
    }

    const emailTaken = await this.prisma.users.findFirst({ where: { Email: dto.email, IsAdmin: false } });
    if (emailTaken) return { success: false, body: emptyAuthResponse({ message: 'Email already exists.' }) };

    const now = new Date();
    const userName = `${dto.firstName.trim().replace(/\s+/g, '')}${dto.lastName.trim().replace(/\s+/g, '')}${randomInt(100000, 999999)}`;
    const user = await this.prisma.users.create({
      data: {
        Id: randomUUID(),
        UserName: userName,
        NormalizedUserName: userName.toUpperCase(),
        Email: dto.email,
        NormalizedEmail: dto.email.toUpperCase(),
        EmailConfirmed: true,
        PasswordHash: this.passwordHasher.hashPassword(dto.password),
        SecurityStamp: randomUUID(),
        ConcurrencyStamp: randomUUID(),
        PhoneNumber: dto.phoneNumber,
        PhoneNumberConfirmed: false,
        TwoFactorEnabled: false,
        LockoutEnabled: true,
        AccessFailedCount: 0,
        FirstName: dto.firstName,
        MiddleName: dto.middleName ?? null,
        LastName: dto.lastName,
        Suffix: dto.suffix ?? null,
        DateOfBirth: new Date(dto.dateOfBirth),
        Gender: dto.gender,
        IsAdmin: false,
        IsDeleted: false,
        CreatedAt: now,
        IsEnabled: false,
        VerificationCode: String(randomInt(100000, 999999)),
        VerificationCodeCreatedAt: now,
        ReceiveSmsMessages: dto.receiveSmsMessages ?? false,
        TwilioOptedIn: true,
        ConnectionId: '',
      },
    });

    const entityUser = await this.prisma.entityUsers.create({
      data: {
        Id: randomUUID(),
        ApplicationUserId: user.Id,
        EntityId: entityId,
        IsApproved: true,
        IsCertified: true,
        IsEnabled: true,
        IsOwner: false,
        IsProvider: invite.IsProvider ?? false,
        CreatedAt: now,
        IsDeleted: false,
        LastCertifiedDate: now,
      },
    });

    const roleName = invite.StaffRole != null ? roleEnumToName(invite.StaffRole) : 'Staff';
    const role = await this.prisma.roles.findFirst({ where: { Name: roleName ?? 'Staff' } });
    if (role) {
      try {
        await this.prisma.userRoles.create({
          data: {
            UserId: user.Id,
            RoleId: role.Id,
            EntityId: entityId,
            IsDeleted: false,
            CreatedAt: now,
            IsEnabled: true,
          },
        });
      } catch {
        // Schema has a unique on EntityId (introspected); multi-staff may already occupy it.
      }
    }

    await this.prisma.invitations.update({
      where: { Id: invite.Id },
      data: { ApplicationUserId: user.Id, JoiningDate: now },
    });

    void entityUser;
    const body = await this.issueTokenResponse(user, { isNew: false, isCompletedRegister: true, entityId });
    return {
      success: true,
      body: {
        ...body,
        email: user.Email,
        isAuthenticated: false,
        entityExist: true,
        isInvitedAsAProvider: invite.IsProvider ?? false,
        entityUserRole: String(invite.StaffRole),
        message: 'User created successfully.',
      },
    };
  }

  /**
   * Node port of ConfirmEmail (6-digit VerificationCode, ≤24h).
   * Success body is a SPA path string like .NET Ok("/login") / Ok("verifySuccess?UI=...").
   * Non-entity users also get a userData cookie (same shape ClientApp VerifyEmail expects).
   */
  async confirmEmail(
    email: string,
    token: string,
  ): Promise<{ success: boolean; pathOrMessage: string; statusMessage?: string; cookieValue?: string }> {
    if (!email || !token) {
      return { success: false, pathOrMessage: 'Invalid email confirmation url', statusMessage: 'Invalid email confirmation url' };
    }
    const user = await this.prisma.users.findFirst({ where: { Email: email, IsAdmin: false } });
    if (!user) return { success: false, pathOrMessage: 'User not found', statusMessage: 'User not found' };
    if (user.EmailConfirmed) {
      return { success: false, pathOrMessage: 'this email already confirmed', statusMessage: 'this email already confirmed' };
    }
    if (!(token.length === 6 && /^\d+$/.test(token))) {
      return { success: false, pathOrMessage: 'Invalid', statusMessage: 'Invalid' };
    }
    const createdAt = user.VerificationCodeCreatedAt?.getTime() ?? 0;
    if (user.VerificationCode !== token || Date.now() - createdAt > 24 * 60 * 60 * 1000) {
      return { success: false, pathOrMessage: 'Email is not verified', statusMessage: 'Email is not verified' };
    }

    await this.prisma.users.update({ where: { Id: user.Id }, data: { EmailConfirmed: true } });

    const inEntity = await this.prisma.entityUsers.findFirst({ where: { ApplicationUserId: user.Id } });
    const inJoin = await this.prisma.joiningRequests.findFirst({ where: { ApplicationUserId: user.Id } });
    if (inEntity || inJoin) return { success: true, pathOrMessage: '/login' };

    const tokens = await this.issueTokenResponse(user, { isNew: false, isCompletedRegister: true, entityId: GUID_EMPTY });
    const accessExp =
      tokens.accessTokenExpiresAt instanceof Date
        ? tokens.accessTokenExpiresAt.toISOString()
        : String(tokens.accessTokenExpiresAt ?? '');
    const refreshExp =
      tokens.refreshTokenExpiresAt instanceof Date
        ? tokens.refreshTokenExpiresAt.toISOString()
        : String(tokens.refreshTokenExpiresAt ?? '');
    const cookieValue =
      `UserId:'${user.Id}' Email:'${user.Email}' FirstName:'${user.FirstName}' LastName:'${user.LastName}' ` +
      `JwToken:'${tokens.token}' AccessTokenExpiresAt:'${accessExp}' ` +
      `RefreshToken:'${tokens.refreshToken}' RefreshTokenExpiresAt:'${refreshExp}' `;
    return { success: true, pathOrMessage: `verifySuccess?UI=${user.Id}`, cookieValue };
  }

  async resendConfirmationEmail(email: string): Promise<AuthResult> {
    const user = await this.prisma.users.findFirst({ where: { Email: email, IsAdmin: false } });
    if (!user) return { success: false, body: emptyAuthResponse({ message: 'User not found' }) };
    if (user.EmailConfirmed) return { success: false, body: emptyAuthResponse({ message: 'this email already confirmed' }) };

    const code = String(randomInt(100000, 999999));
    await this.prisma.users.update({
      where: { Id: user.Id },
      data: { VerificationCode: code, VerificationCodeCreatedAt: new Date() },
    });
    await this.sendConfirmationEmail(email, code);
    return {
      success: true,
      body: emptyAuthResponse({
        message: 'Pending confirm email',
        email,
        isAuthenticated: false,
      }),
    };
  }

  async forgotPassword(email: string, isAdmin: boolean): Promise<AuthResult> {
    const user = await this.prisma.users.findFirst({ where: { Email: email, IsAdmin: isAdmin } });
    if (!user) return { success: false, body: emptyAuthResponse({ message: 'Invalid login' }) };
    if (!user.PasswordHash) {
      return {
        success: false,
        body: emptyAuthResponse({
          message: "Can't change your password because you logged in using an external login, and you don't have password.",
        }),
      };
    }
    if (!user.EmailConfirmed) {
      return { success: false, body: emptyAuthResponse({ message: 'Invalid sending email or email must be confirmed' }) };
    }

    const { secret } = getJwtSettings(this.config);
    const token = createPasswordResetToken(user.Id, user.SecurityStamp, secret);
    const frontend = this.config.get<string>('FRONTEND_URL') ?? 'https://localhost:44413';
    const path = isAdmin ? '/admin/resetPassword' : '/resetPassword';
    const link = `${frontend}${path}?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    await this.mail.sendMail({
      to: email,
      subject: 'Forgot Password Link',
      html: `<p>To reset your password, <a href="${link}">click here</a>.</p>`,
      text: `Reset your password: ${link}`,
    });

    return {
      success: true,
      body: emptyAuthResponse({
        message: `Password change request has been sent to ${email}`,
        email,
      }),
    };
  }

  async resetPassword(
    dto: { email: string; token: string; password: string; confirmPassword: string },
    isAdmin: boolean,
  ): Promise<AuthResult> {
    if (dto.password !== dto.confirmPassword) {
      return { success: false, body: emptyAuthResponse({ message: 'Passwords do not match.' }) };
    }
    const user = await this.prisma.users.findFirst({ where: { Email: dto.email, IsAdmin: isAdmin } });
    if (!user) return { success: false, body: emptyAuthResponse({ message: 'User not found' }) };

    const { secret } = getJwtSettings(this.config);
    if (!verifyPasswordResetToken(dto.token, user.Id, user.SecurityStamp, secret)) {
      return { success: false, body: emptyAuthResponse({ message: 'Invalid token', isAuthenticated: false }) };
    }

    await this.prisma.users.update({
      where: { Id: user.Id },
      data: {
        PasswordHash: this.passwordHasher.hashPassword(dto.password),
        SecurityStamp: randomUUID(),
      },
    });
    await this.refreshTokens.revokeAllForUser(user.Id);

    return {
      success: true,
      body: emptyAuthResponse({
        message: 'Your password has been successfully updated',
        isAuthenticated: true,
      }),
    };
  }

  private async sendConfirmationEmail(email: string, code: string): Promise<void> {
    await this.mail.sendMail({
      to: email,
      subject: 'Confirm your email',
      html: `<p>Your MedExchange verification code is <strong>${code}</strong>. It expires in 24 hours.</p>`,
      text: `Your MedExchange verification code is ${code}. It expires in 24 hours.`,
    });
  }

  /**
   * Node port of ExternalLogin (Google tokeninfo / Microsoft Graph). Invitation query params
   * only accepted as raw UUIDs until ASP.NET DataProtector is ported.
   */
  async externalLogin(dto: ExternalAuthDto, invitation?: InvitationQuery): Promise<AuthResult> {
    const payload = dto.provider === 'GOOGLE' ? await this.verifyGoogleToken(dto.idToken) : await this.verifyMicrosoftToken(dto);
    if (!payload) {
      return { success: false, body: emptyAuthResponse({ message: 'Invalid external authentication' }) };
    }

    const passwordUser = await this.prisma.users.findFirst({
      where: { Email: payload.email, IsAdmin: false, PasswordHash: { not: null } },
    });
    if (passwordUser) {
      return {
        success: false,
        body: emptyAuthResponse({
          message: 'An account with this email already exists using password login. Use email/password instead.',
        }),
      };
    }

    if (invitation?.entityId && !isUuid(invitation.entityId)) {
      return {
        success: false,
        body: emptyAuthResponse({
          message:
            'Invitation registration requires ASP.NET DataProtector-compatible query params (not yet ported). Use a raw EntityId UUID or sign in without invitation.',
        }),
      };
    }

    let invite: { Id: string; StaffRole: number; IsProvider: boolean; InvitedUserEmail: string | null } | null = null;
    if (invitation?.entityId) {
      const entity = await this.prisma.entity.findFirst({ where: { Id: invitation.entityId, IsEnabled: true } });
      if (!entity) return { success: false, body: emptyAuthResponse({ message: 'Invalid entity id' }) };
      invite = await this.prisma.invitations.findFirst({
        where: {
          EntityId: invitation.entityId,
          ApplicationUserId: null,
          InvitedUserEmail: payload.email,
        },
        orderBy: { InvitationDate: 'desc' },
      });
      if (!invite) {
        return { success: false, body: emptyAuthResponse({ message: 'Your entity does not sent any invitations' }) };
      }
      if (invite.InvitedUserEmail !== payload.email) {
        return { success: false, body: emptyAuthResponse({ message: 'Not the invited email' }) };
      }
    }

    let user =
      (await this.prisma.userLogins
        .findFirst({
          where: { LoginProvider: dto.provider, ProviderKey: payload.subject },
          include: { Users: true },
        })
        .then((r) => r?.Users ?? null)) ??
      (await this.prisma.users.findFirst({ where: { Email: payload.email, IsAdmin: false } }));

    let isNew = false;
    if (!user) {
      isNew = true;
      const now = new Date();
      const userName = (payload.userName || payload.email).replace(/\s+/g, '');
      user = await this.prisma.users.create({
        data: {
          Id: randomUUID(),
          UserName: userName,
          NormalizedUserName: userName.toUpperCase(),
          Email: payload.email,
          NormalizedEmail: payload.email.toUpperCase(),
          EmailConfirmed: true,
          PasswordHash: null,
          SecurityStamp: randomUUID(),
          ConcurrencyStamp: randomUUID(),
          PhoneNumberConfirmed: false,
          TwoFactorEnabled: false,
          LockoutEnabled: true,
          AccessFailedCount: 0,
          FirstName: (payload.givenName || 'User').replace(/\s+/g, ''),
          LastName: payload.familyName ? payload.familyName.replace(/\s+/g, '') : null,
          DateOfBirth: new Date('1900-01-01T00:00:00.000Z'),
          Gender: 0,
          IsAdmin: false,
          IsDeleted: false,
          CreatedAt: now,
          IsEnabled: true,
          VerificationCode: String(randomInt(100000, 999999)),
          VerificationCodeCreatedAt: now,
          ReceiveSmsMessages: false,
          TwilioOptedIn: true,
          ConnectionId: '',
        },
      });
      await this.prisma.userLogins.create({
        data: {
          LoginProvider: dto.provider,
          ProviderKey: payload.subject,
          ProviderDisplayName: dto.provider,
          UserId: user.Id,
        },
      });
    } else {
      const existingLogin = await this.prisma.userLogins.findFirst({
        where: { UserId: user.Id, LoginProvider: dto.provider, ProviderKey: payload.subject },
      });
      if (!existingLogin) {
        await this.prisma.userLogins.create({
          data: {
            LoginProvider: dto.provider,
            ProviderKey: payload.subject,
            ProviderDisplayName: dto.provider,
            UserId: user.Id,
          },
        });
      }
    }

    if (invite && invitation?.entityId) {
      const now = new Date();
      await this.prisma.entityUsers.create({
        data: {
          Id: randomUUID(),
          ApplicationUserId: user.Id,
          EntityId: invitation.entityId,
          IsApproved: true,
          IsCertified: true,
          IsEnabled: true,
          IsOwner: false,
          IsProvider: invite.IsProvider ?? false,
          CreatedAt: now,
          IsDeleted: false,
          LastCertifiedDate: now,
        },
      });
      const roleName = roleEnumToName(invite.StaffRole) ?? 'Staff';
      const role = await this.prisma.roles.findFirst({ where: { Name: roleName } });
      if (role) {
        try {
          await this.prisma.userRoles.create({
            data: {
              UserId: user.Id,
              RoleId: role.Id,
              EntityId: invitation.entityId,
              IsDeleted: false,
              CreatedAt: now,
              IsEnabled: true,
            },
          });
        } catch {
          /* unique EntityId on UserRoles — see registerWithInvitation */
        }
      }
      await this.prisma.invitations.update({
        where: { Id: invite.Id },
        data: { ApplicationUserId: user.Id, JoiningDate: now },
      });
    }

    const { entityId, lastDashboardView } = await this.resolveDefaultPractice(user.Id);
    const isCompletedRegister = user.Gender !== 0;
    const body = await this.issueTokenResponse(user, {
      isNew,
      isCompletedRegister,
      entityId,
    });
    return {
      success: true,
      body: {
        ...body,
        lastDashboardView,
        isInvitedAsAProvider: invite?.IsProvider ?? false,
      },
    };
  }

  private async verifyGoogleToken(
    idToken: string,
  ): Promise<{ email: string; subject: string; givenName?: string; familyName?: string; userName?: string } | null> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { aud?: string; email?: string; sub?: string; given_name?: string; family_name?: string; name?: string };
      if (!data.email || !data.sub) return null;
      if (clientId && data.aud !== clientId) return null;
      return {
        email: data.email,
        subject: data.sub,
        givenName: data.given_name,
        familyName: data.family_name,
        userName: data.email,
      };
    } catch {
      return null;
    }
  }

  private async verifyMicrosoftToken(
    dto: ExternalAuthDto,
  ): Promise<{ email: string; subject: string; givenName?: string; familyName?: string; userName?: string } | null> {
    const clientId = this.config.get<string>('MICROSOFT_CLIENT_ID');
    try {
      const parts = dto.idToken.split('.');
      if (parts.length < 2) return null;
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { aud?: string };
      if (clientId && claims.aud !== clientId) return null;
      if (!dto.accessToken) return null;

      const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${dto.accessToken}` },
      });
      if (!res.ok) return null;
      const me = (await res.json()) as {
        id?: string;
        mail?: string;
        userPrincipalName?: string;
        givenName?: string;
        surname?: string;
        displayName?: string;
      };
      const email = me.mail || me.userPrincipalName;
      if (!email || !me.id) return null;
      return {
        email,
        subject: me.id,
        givenName: me.givenName,
        familyName: me.surname,
        userName: me.displayName || email,
      };
    } catch {
      return null;
    }
  }

  /** Node port of AuthService.RefreshToken(entityId, dto). */
  async refreshToken(
    entityId: string,
    refreshToken: string,
    impersonatedByRaw?: string | null,
  ): Promise<AuthResult> {
    let userId: string;
    try {
      ({ userId } = await this.refreshTokens.consumeForRotation(refreshToken));
    } catch {
      return { success: false, body: emptyAuthResponse({ errors: 'Expired token', isAuthenticated: false }) };
    }

    const user = await this.prisma.users.findUnique({ where: { Id: userId } });
    if (!user) return { success: false, body: emptyAuthResponse({ errors: 'Invalid token.', isAuthenticated: false }) };

    let impersonatedBy: string | null = null;
    if (impersonatedByRaw && isUuid(impersonatedByRaw)) {
      const admin = await this.prisma.users.findFirst({ where: { Id: impersonatedByRaw, IsAdmin: true } });
      if (!admin) {
        return { success: false, body: emptyAuthResponse({ errors: 'SystemAdmin not found', isAuthenticated: false }) };
      }
      impersonatedBy = impersonatedByRaw;
    }

    const isCompletedRegister = user.Gender !== 0;
    const scopedEntityId = isEmptyGuid(entityId) ? GUID_EMPTY : entityId;

    if (!isEmptyGuid(scopedEntityId)) {
      const entity = await this.prisma.entity.findFirst({ where: { Id: scopedEntityId, IsEnabled: true } });
      if (!entity) {
        return { success: false, body: emptyAuthResponse({ message: 'Invalid entity id', isAuthenticated: false }) };
      }
      const entityUser = await this.findCertifiedEntityUser(scopedEntityId, user.Id);
      if (!entityUser) {
        return { success: false, body: emptyAuthResponse({ message: 'Unauthorized', isAuthenticated: false }) };
      }
    }

    const body = await this.issueTokenResponse(user, {
      isNew: false,
      isCompletedRegister,
      entityId: scopedEntityId,
      impersonatedBy,
    });
    return { success: true, body };
  }

  /** Node port of AuthService.GetEntityToken. */
  async getEntityToken(userId: string, entityId: string, dashboardView: number): Promise<AuthResult> {
    const entity = await this.prisma.entity.findFirst({ where: { Id: entityId, IsEnabled: true } });
    if (!entity) {
      return { success: false, body: emptyAuthResponse({ message: 'Invalid entity id' }) };
    }

    const entityUser = await this.findCertifiedEntityUser(entityId, userId);
    if (!entityUser) {
      return { success: false, body: emptyAuthResponse({ message: 'Unauthorized' }) };
    }

    await this.upsertLastDashboardView(entityUser.Id, dashboardView);
    await this.prisma.entityUsers.update({
      where: { Id: entityUser.Id },
      data: { LastLoginTime: new Date() },
    });

    const user = await this.prisma.users.findUnique({ where: { Id: userId } });
    if (!user) return { success: false, body: emptyAuthResponse({ message: 'User Not Found' }) };

    const body = await this.issueTokenResponse(user, {
      isNew: false,
      isCompletedRegister: true,
      entityId,
    });
    return { success: true, body };
  }

  async logOut(refreshToken: string, jwtId: string): Promise<{ success: boolean; message: string }> {
    const revoked = await this.refreshTokens.revokeForLogout(refreshToken, jwtId);
    if (!revoked) return { success: false, message: 'Invalid' };
    return { success: true, message: 'You Logged out Successfully.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ success: boolean; message: string }> {
    const user = await this.prisma.users.findUnique({ where: { Id: userId } });
    if (!user) throw new NotFoundException('User Not Found');
    if (!user.PasswordHash) {
      return {
        success: false,
        message: "Can't change your password because you logged in using an external login, and you don't have password.",
      };
    }

    if (this.passwordHasher.verifyHashedPassword(user.PasswordHash, dto.currentPassword) === PasswordVerificationResult.Failed) {
      return { success: false, message: 'Failed to Update Password.' };
    }

    await this.prisma.users.update({
      where: { Id: userId },
      data: { PasswordHash: this.passwordHasher.hashPassword(dto.newPassword), SecurityStamp: randomUUID() },
    });
    return { success: true, message: 'Password updated successfully. Please log in again.' };
  }

  async getUserById(targetUserId: string) {
    const user = await this.prisma.users.findUnique({ where: { Id: targetUserId } });
    if (!user) throw new NotFoundException('User Not Found');

    return {
      id: user.Id,
      firstName: user.FirstName,
      middleName: user.MiddleName,
      lastName: user.LastName,
      suffix: user.Suffix,
      dateOfBirth: user.DateOfBirth,
      phoneNumber: user.PhoneNumber,
      gender: user.Gender,
      email: user.Email,
      userImage: null as string | null,
      isNewEmail: false,
      phoneNumberConfirmed: user.PhoneNumberConfirmed,
    };
  }

  private async resolveDefaultPractice(userId: string): Promise<{
    entityId: string;
    lastDashboardView: number | null;
  }> {
    const entityUsers = await this.prisma.entityUsers.findMany({
      where: { ApplicationUserId: userId },
      include: { EntityUserPreferences: true },
    });
    const entityUser = entityUsers.find((eu) =>
      eu.EntityUserPreferences.some((p) => p.Key === 'IsDefaultPractice' && p.Value === '1'),
    );

    if (!entityUser) return { entityId: GUID_EMPTY, lastDashboardView: null };

    await this.prisma.entityUsers.update({
      where: { Id: entityUser.Id },
      data: { LastLoginTime: new Date() },
    });

    const lastDashboardPref = entityUser.EntityUserPreferences.find((p) => p.Key === 'LastDashboardView');
    let lastDashboardView: number | null = null;
    if (lastDashboardPref?.Value) {
      const parsed = Number(lastDashboardPref.Value);
      if (parsed === 1 || parsed === 2) lastDashboardView = parsed;
    }

    return { entityId: entityUser.EntityId, lastDashboardView };
  }

  private async findCertifiedEntityUser(entityId: string, userId: string) {
    return this.prisma.entityUsers.findFirst({
      where: {
        EntityId: entityId,
        ApplicationUserId: userId,
        IsEnabled: true,
        IsCertified: true,
      },
    });
  }

  private async upsertLastDashboardView(entityUserId: string, dashboardView: number): Promise<void> {
    const existing = await this.prisma.entityUserPreferences.findUnique({
      where: { EntityUserId_Key: { EntityUserId: entityUserId, Key: 'LastDashboardView' } },
    });
    const value = String(dashboardView);
    if (existing) {
      if (existing.Value !== value) {
        await this.prisma.entityUserPreferences.update({
          where: { Id: existing.Id },
          data: { Value: value, UpdatedAt: new Date() },
        });
      }
      return;
    }
    await this.prisma.entityUserPreferences.create({
      data: {
        Id: randomUUID(),
        Key: 'LastDashboardView',
        Value: value,
        EntityUserId: entityUserId,
        CreatedAt: new Date(),
        IsDeleted: false,
        IsEnabled: true,
      },
    });
  }

  private async issueTokenResponse(
    user: Users,
    opts: {
      isNew: boolean;
      isCompletedRegister: boolean;
      entityId?: string | null;
      impersonatedBy?: string | null;
    },
  ): Promise<AuthResponseDto> {
    const claims = await buildTokenClaims(this.prisma, user, opts);
    const issued = this.tokenService.issueAccessToken(claims);
    const refreshToken = await this.refreshTokens.issue(user.Id, issued.jti);

    return emptyAuthResponse({
      message: 'User LogIn Successfully',
      isAuthenticated: true,
      email: user.Email,
      isNew: opts.isNew,
      isCompletedRegister: opts.isCompletedRegister,
      token: issued.token,
      accessTokenExpiresAt: issued.expiresAt,
      refreshToken: refreshToken.Token,
      refreshTokenExpiresAt: refreshToken.ExpiresAt,
    });
  }
}

function isValidAdultDob(dateOfBirth: string): boolean {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  if (dob.getTime() > today.getTime()) return false;

  let age = today.getFullYear() - dob.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!hadBirthdayThisYear) age--;

  return age >= 18;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function roleEnumToName(value: number): string | null {
  const map: Record<number, string> = {
    1: 'None',
    2: 'SystemAdministrator',
    3: 'Admin',
    4: 'Staff',
    5: 'OrderingOnlyStaff',
  };
  return map[value] ?? null;
}

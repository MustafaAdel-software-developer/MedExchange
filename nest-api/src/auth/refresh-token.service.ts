import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { RefreshTokens } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000; // RefreshToken.ExpiresAt default: CreatedAt + 2 days
const REFRESH_TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz_';
const REFRESH_TOKEN_LENGTH = 32;

/**
 * Node port of the RefreshToken model + the issue/rotate/revoke logic scattered across
 * AuthService.GenerateJwtToken / RefreshToken / LogOut / ExpireAllRefreshTokens
 * (MedExchange.DAL). One-time-use, rotated on every refresh, revoked on logout or
 * "log out everywhere" (password change, etc).
 */
@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, jwtId: string): Promise<RefreshTokens> {
    const now = new Date();
    return this.prisma.refreshTokens.create({
      data: {
        Id: randomUUID(),
        ApplicationUserId: userId,
        Token: generateOpaqueToken(),
        JwtId: jwtId,
        IsUsed: false,
        IsRevoked: false,
        CreatedAt: now,
        ExpiresAt: new Date(now.getTime() + DEFAULT_EXPIRY_MS),
        // BaseEntity.IsEnabled has no initializer (defaults to false in C#) and
        // AuthService never sets it on a freshly-issued RefreshToken.
        IsEnabled: false,
      },
    });
  }

  /**
   * Validates and consumes a refresh token (marks it used+revoked, matching
   * AuthService.RefreshToken), returning the associated user id for issuing a new token pair.
   * Throws UnauthorizedException on any invalid/expired/already-used/revoked token, mirroring
   * the .NET ExpiredToken / RefreshTokenDoesNotExistOrInvalidToken error paths.
   */
  async consumeForRotation(token: string): Promise<{ userId: string }> {
    const stored = await this.prisma.refreshTokens.findFirst({ where: { Token: token } });
    if (!stored || stored.ExpiresAt < new Date()) {
      throw new UnauthorizedException('ExpiredToken');
    }
    if (stored.IsUsed || stored.IsRevoked) {
      throw new UnauthorizedException('RefreshTokenDoesNotExistOrInvalidToken');
    }

    await this.prisma.refreshTokens.update({
      where: { Id: stored.Id },
      data: {
        IsUsed: true,
        IsRevoked: true,
        ExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    if (!stored.ApplicationUserId) throw new UnauthorizedException('RefreshTokenDoesNotExistOrInvalidToken');
    return { userId: stored.ApplicationUserId };
  }

  /** Node port of AuthService.LogOut's refresh-token revocation (matched by token + jti). */
  async revokeForLogout(token: string, jwtId: string): Promise<boolean> {
    const stored = await this.prisma.refreshTokens.findFirst({ where: { Token: token, JwtId: jwtId } });
    if (!stored) return false;

    await this.prisma.refreshTokens.update({
      where: { Id: stored.Id },
      data: {
        ExpiresAt: new Date(Date.now() - 60_000),
        IsRevoked: true,
        IsUsed: true,
      },
    });
    return true;
  }

  /** Node port of AuthService.ExpireAllRefreshTokens (e.g. on password change / "log out everywhere"). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshTokens.updateMany({
      where: { ApplicationUserId: userId },
      data: {
        IsRevoked: true,
        IsUsed: true,
        ExpiresAt: new Date(Date.now() - 60_000),
      },
    });
  }
}

function generateOpaqueToken(): string {
  const bytes = randomBytes(REFRESH_TOKEN_LENGTH);
  let result = '';
  for (let i = 0; i < REFRESH_TOKEN_LENGTH; i++) {
    result += REFRESH_TOKEN_CHARS[bytes[i] % REFRESH_TOKEN_CHARS.length];
  }
  return result;
}

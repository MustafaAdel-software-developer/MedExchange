import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { getJwtSettings, JwtSettings } from './jwt-config';

export interface IssuedToken {
  token: string;
  jti: string;
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * Node port of AuthService.GenerateJwtToken (MedExchange.DAL). Signs/verifies with the exact
 * same secret, issuer, audience, algorithm (HS256) and expiry as the .NET app so tokens are
 * interchangeable between the two APIs during the strangler migration.
 *
 * Claim payload shape (which literal claim keys go in) is the caller's responsibility — see
 * claim-types.ts for the .NET ClaimTypes URIs that must be used for cross-compatible claims.
 */
@Injectable()
export class TokenService {
  private readonly settings: JwtSettings;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.settings = getJwtSettings(config);
  }

  issueAccessToken(claims: Record<string, string>): IssuedToken {
    const jti = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + this.settings.expiryInMinutes * 60_000);

    const token = this.jwt.sign(claims, {
      secret: this.settings.secret,
      issuer: this.settings.issuer,
      audience: this.settings.audience,
      algorithm: 'HS256',
      jwtid: jti,
      expiresIn: `${this.settings.expiryInMinutes}m`,
    });

    return { token, jti, issuedAt, expiresAt };
  }

  verifyAccessToken(token: string): Record<string, unknown> {
    // clockTolerance 0 mirrors the .NET side's TokenValidationParameters.ClockSkew = TimeSpan.Zero.
    return this.jwt.verify(token, {
      secret: this.settings.secret,
      issuer: this.settings.issuer,
      audience: this.settings.audience,
      algorithms: ['HS256'],
      clockTolerance: 0,
    });
  }
}

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { Users } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimTypes } from './claim-types';
import { TokenService } from './token.service';

export interface AuthenticatedRequest extends Request {
  user: Record<string, unknown>;
  currentUser: Users;
}

/**
 * Node port of [Authorize] + Middlewares/TokenValidationMiddleware.cs: verifies the bearer JWT,
 * loads the user, and rejects tokens issued before the user's ExpiresAllTokensIssuedBefore
 * (bumped on "log out everywhere" / forced re-auth) even if the JWT itself is still validly
 * signed and unexpired.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException();

    let payload: Record<string, unknown>;
    try {
      payload = this.tokenService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException();
    }

    const userId = payload[ClaimTypes.NameIdentifier];
    if (typeof userId !== 'string') throw new UnauthorizedException();

    const user = await this.prisma.users.findUnique({ where: { Id: userId } });
    if (!user) throw new UnauthorizedException();

    // JwtRegisteredClaimNames.Iat ("iat") is a standard registered claim; jsonwebtoken exposes
    // it as a Unix-seconds number, matching the .NET side's DateTimeOffset.FromUnixTimeSeconds.
    const iat = typeof payload.iat === 'number' ? payload.iat : null;
    const tokenIssuedAt = iat !== null ? new Date(iat * 1000) : new Date();

    if (user.ExpiresAllTokensIssuedBefore && user.ExpiresAllTokensIssuedBefore >= tokenIssuedAt) {
      throw new UnauthorizedException();
    }

    (request as AuthenticatedRequest).user = payload;
    (request as AuthenticatedRequest).currentUser = user;
    return true;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

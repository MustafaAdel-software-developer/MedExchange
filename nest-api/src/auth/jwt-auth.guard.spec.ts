import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClaimTypes } from './claim-types';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';

const env = {
  JWT_SECRET: 'JWTAuthenticationHIGHsecuredPasswordVVVp1OH7Xzyr',
  JWT_ISSUER: 'https://localhost:7295',
  JWT_AUDIENCE: 'https://localhost:7295',
  JWT_EXPIRY_MINUTES: '120',
};

function makeTokenService(): TokenService {
  const config = { get: (key: string) => (env as Record<string, string>)[key] } as unknown as ConfigService;
  return new TokenService(new JwtService(), config);
}

function contextWithAuthHeader(authorization?: string): ExecutionContext {
  const request = { headers: { authorization } } as unknown as AuthenticatedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const tokenService = makeTokenService();
  const userId = 'user-123';

  function makeGuard(usersFindUnique: jest.Mock) {
    const prisma = { users: { findUnique: usersFindUnique } };
    return new JwtAuthGuard(tokenService, prisma as never);
  }

  it('rejects requests with no Authorization header', async () => {
    const guard = makeGuard(jest.fn());
    await expect(guard.canActivate(contextWithAuthHeader())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a garbage token', async () => {
    const guard = makeGuard(jest.fn());
    await expect(guard.canActivate(contextWithAuthHeader('Bearer not-a-real-jwt'))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a valid token whose user no longer exists', async () => {
    const { token } = tokenService.issueAccessToken({ [ClaimTypes.NameIdentifier]: userId });
    const guard = makeGuard(jest.fn().mockResolvedValue(null));
    await expect(guard.canActivate(contextWithAuthHeader(`Bearer ${token}`))).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a valid token when ExpiresAllTokensIssuedBefore is null and attaches the request', async () => {
    const { token } = tokenService.issueAccessToken({ [ClaimTypes.NameIdentifier]: userId });
    const usersFindUnique = jest.fn().mockResolvedValue({ Id: userId, ExpiresAllTokensIssuedBefore: null });
    const guard = makeGuard(usersFindUnique);
    const context = contextWithAuthHeader(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    expect(request.currentUser.Id).toBe(userId);
    expect(request.user[ClaimTypes.NameIdentifier]).toBe(userId);
  });

  it('rejects a token issued before ExpiresAllTokensIssuedBefore (revoked via password change/logout-everywhere)', async () => {
    const { token } = tokenService.issueAccessToken({ [ClaimTypes.NameIdentifier]: userId });
    // Simulate a revocation timestamp set *after* the token's iat.
    const revokedAt = new Date(Date.now() + 60_000);
    const usersFindUnique = jest.fn().mockResolvedValue({ Id: userId, ExpiresAllTokensIssuedBefore: revokedAt });
    const guard = makeGuard(usersFindUnique);

    await expect(guard.canActivate(contextWithAuthHeader(`Bearer ${token}`))).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a token issued after ExpiresAllTokensIssuedBefore', async () => {
    const revokedAt = new Date(Date.now() - 60_000);
    const { token } = tokenService.issueAccessToken({ [ClaimTypes.NameIdentifier]: userId });
    const usersFindUnique = jest.fn().mockResolvedValue({ Id: userId, ExpiresAllTokensIssuedBefore: revokedAt });
    const guard = makeGuard(usersFindUnique);

    await expect(guard.canActivate(contextWithAuthHeader(`Bearer ${token}`))).resolves.toBe(true);
  });
});

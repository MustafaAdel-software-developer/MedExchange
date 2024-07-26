import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClaimTypes } from './claim-types';
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

describe('TokenService', () => {
  const tokenService = makeTokenService();

  it('issues a token that verifies and round-trips claim values', () => {
    const { token } = tokenService.issueAccessToken({
      [ClaimTypes.Email]: 'user@example.com',
      [ClaimTypes.NameIdentifier]: 'user-123',
      [ClaimTypes.Name]: 'Test User',
    });

    const payload = tokenService.verifyAccessToken(token);
    expect(payload[ClaimTypes.Email]).toBe('user@example.com');
    expect(payload[ClaimTypes.NameIdentifier]).toBe('user-123');
    expect(payload.iss).toBe(env.JWT_ISSUER);
    expect(payload.aud).toBe(env.JWT_AUDIENCE);
  });

  it('rejects a token signed with the wrong secret', () => {
    const other = new TokenService(new JwtService(), {
      get: (key: string) => (key === 'JWT_SECRET' ? 'wrong-secret' : (env as Record<string, string>)[key]),
    } as unknown as ConfigService);
    const { token } = other.issueAccessToken({ [ClaimTypes.NameIdentifier]: 'user-123' });

    expect(() => tokenService.verifyAccessToken(token)).toThrow();
  });

  // Real .NET output from tools/JwtCheck ("sign"), same secret/issuer/audience — proves the
  // Node service can verify tokens the .NET AuthService actually issues, not just its own.
  // Long-lived (50yr) so this fixture doesn't rot with wall-clock time.
  const dotnetToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJodHRwOi8vc2NoZW1hcy54bWxzb2FwLm9yZy93cy8yMDA1LzA1L2lkZW50aXR5L2NsYWltcy9lbWFpbGFkZHJlc3MiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaHR0cDovL3NjaGVtYXMueG1sc29hcC5vcmcvd3MvMjAwNS8wNS9pZGVudGl0eS9jbGFpbXMvbmFtZWlkZW50aWZpZXIiOiJ1c2VyLTEyMyIsImh0dHA6Ly9zY2hlbWFzLnhtbHNvYXAub3JnL3dzLzIwMDUvMDUvaWRlbnRpdHkvY2xhaW1zL25hbWUiOiJUZXN0IFVzZXIiLCJodHRwOi8vc2NoZW1hcy5taWNyb3NvZnQuY29tL3dzLzIwMDgvMDYvaWRlbnRpdHkvY2xhaW1zL3JvbGUiOiJTeXN0ZW1BZG1pbmlzdHJhdG9yIiwiSXNOZXciOiJGYWxzZSIsImV4cCI6MzM2MzUwMTEyNCwiaXNzIjoiaHR0cHM6Ly9sb2NhbGhvc3Q6NzI5NSIsImF1ZCI6Imh0dHBzOi8vbG9jYWxob3N0OjcyOTUifQ.masB0gY30e-UNsL2IgvkzsBqvqh6H2ob4eop_LvdM7w';

  it('verifies a real .NET-issued JWT with the exact same claim keys/values', () => {
    const payload = tokenService.verifyAccessToken(dotnetToken);
    expect(payload[ClaimTypes.Email]).toBe('test@example.com');
    expect(payload[ClaimTypes.NameIdentifier]).toBe('user-123');
    expect(payload[ClaimTypes.Name]).toBe('Test User');
    expect(payload[ClaimTypes.Role]).toBe('SystemAdministrator');
    expect(payload['IsNew']).toBe('False');
  });
});

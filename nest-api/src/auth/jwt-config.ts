import { ConfigService } from '@nestjs/config';

// Mirrors the "JWT" section of appsettings.json (JWT.Key / Issuer / Audience / ExpiryinMinutes),
// which MedExchange.DAL's AuthenticationServicesInstaller and AuthService read directly.
export interface JwtSettings {
  secret: string;
  issuer: string;
  audience: string;
  expiryInMinutes: number;
}

export function getJwtSettings(config: ConfigService): JwtSettings {
  const secret = config.get<string>('JWT_SECRET');
  const issuer = config.get<string>('JWT_ISSUER');
  const audience = config.get<string>('JWT_AUDIENCE');
  if (!secret || !issuer || !audience) {
    throw new Error('JWT_SECRET, JWT_ISSUER and JWT_AUDIENCE must be set');
  }
  return {
    secret,
    issuer,
    audience,
    expiryInMinutes: Number(config.get<string>('JWT_EXPIRY_MINUTES') ?? 120),
  };
}

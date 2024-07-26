import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';

// Minimal in-memory fake of the Prisma `refreshTokens` delegate — enough surface to exercise the
// issue/rotate/revoke logic without a real database.
function makeFakePrisma() {
  const rows: any[] = [];
  return {
    prisma: {
      refreshTokens: {
        create: jest.fn(async ({ data }: any) => {
          rows.push({ ...data });
          return data;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          return rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.find((r) => r.Id === where.Id);
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const matches = rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
          matches.forEach((r) => Object.assign(r, data));
          return { count: matches.length };
        }),
      },
    },
    rows,
  };
}

describe('RefreshTokenService', () => {
  it('issues a token with the expected shape and ~2 day expiry', async () => {
    const { prisma } = makeFakePrisma();
    const service = new RefreshTokenService(prisma as never);

    const issued = await service.issue('user-1', 'jti-1');
    expect(issued.ApplicationUserId).toBe('user-1');
    expect(issued.JwtId).toBe('jti-1');
    expect(issued.IsUsed).toBe(false);
    expect(issued.IsRevoked).toBe(false);
    expect(issued.Token).toHaveLength(32);

    const expectedExpiry = issued.CreatedAt.getTime() + 2 * 24 * 60 * 60 * 1000;
    expect(issued.ExpiresAt.getTime()).toBe(expectedExpiry);
  });

  it('rotates a valid token: marks it used+revoked and returns the owning user id', async () => {
    const { prisma, rows } = makeFakePrisma();
    const service = new RefreshTokenService(prisma as never);
    const issued = await service.issue('user-1', 'jti-1');

    const { userId } = await service.consumeForRotation(issued.Token!);
    expect(userId).toBe('user-1');

    const stored = rows.find((r) => r.Id === issued.Id);
    expect(stored.IsUsed).toBe(true);
    expect(stored.IsRevoked).toBe(true);
    expect(stored.ExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects rotating the same token twice (already used/revoked)', async () => {
    const { prisma } = makeFakePrisma();
    const service = new RefreshTokenService(prisma as never);
    const issued = await service.issue('user-1', 'jti-1');

    await service.consumeForRotation(issued.Token!);
    await expect(service.consumeForRotation(issued.Token!)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unknown or expired token', async () => {
    const { prisma } = makeFakePrisma();
    const service = new RefreshTokenService(prisma as never);
    await expect(service.consumeForRotation('does-not-exist')).rejects.toThrow(UnauthorizedException);
  });

  it('revokes a token on logout when token+jti match, and reports false otherwise', async () => {
    const { prisma, rows } = makeFakePrisma();
    const service = new RefreshTokenService(prisma as never);
    const issued = await service.issue('user-1', 'jti-1');

    expect(await service.revokeForLogout(issued.Token!, 'wrong-jti')).toBe(false);
    expect(await service.revokeForLogout(issued.Token!, 'jti-1')).toBe(true);

    const stored = rows.find((r) => r.Id === issued.Id);
    expect(stored.IsRevoked).toBe(true);
    expect(stored.IsUsed).toBe(true);
    expect(stored.ExpiresAt.getTime()).toBeLessThan(Date.now());
  });

  it('revokes all refresh tokens for a user (log out everywhere)', async () => {
    const { prisma, rows } = makeFakePrisma();
    const service = new RefreshTokenService(prisma as never);
    await service.issue('user-1', 'jti-1');
    await service.issue('user-1', 'jti-2');
    await service.issue('user-2', 'jti-3');

    await service.revokeAllForUser('user-1');

    const user1Tokens = rows.filter((r) => r.ApplicationUserId === 'user-1');
    expect(user1Tokens.every((r) => r.IsRevoked && r.IsUsed)).toBe(true);
    const user2Token = rows.find((r) => r.ApplicationUserId === 'user-2');
    expect(user2Token.IsRevoked).toBe(false);
  });
});

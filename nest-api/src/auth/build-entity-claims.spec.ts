import { boolClaim, EntityType, GUID_EMPTY, Status } from './auth-enums';
import { enrichTokenClaims } from './build-entity-claims';
import { ClaimTypes } from './claim-types';

describe('boolClaim', () => {
  it('matches C# bool.ToString() casing used by ClientApp', () => {
    expect(boolClaim(true)).toBe('True');
    expect(boolClaim(false)).toBe('False');
  });
});

describe('enrichTokenClaims', () => {
  const user = { Id: 'user-1' } as never;

  function prismaMock(overrides: Record<string, unknown> = {}) {
    return {
      identifications: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      dueDiligenceVerificationQueues: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      entityUsers: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      entity: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      userRoles: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      teamsEntityUsers: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      teams: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides,
    } as never;
  }

  it('sets VerifyProvider NULL and IndividualPracticeOwner False with no identification rows', async () => {
    const claims: Record<string, string> = {};
    await enrichTokenClaims(prismaMock(), user, claims, GUID_EMPTY);
    expect(claims.VerifyProvider).toBe('NULL');
    expect(claims.IndividualPracticeOwner).toBe('False');
    expect(claims.EntityId).toBeUndefined();
  });

  it('adds entity-scoped claims when entity user is certified and enabled', async () => {
    const entityId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const prisma = prismaMock({
      identifications: {
        findFirst: jest
          .fn()
          // VerifyProvider individual lookup → null
          // IndividualPracticeOwner → null
          // Identifire for entity → { Id: 'ident-1' }
          // practice data completed → null
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ Id: 'ident-1' })
          .mockResolvedValueOnce(null),
      },
      entityUsers: {
        findFirst: jest.fn().mockResolvedValueOnce({ Id: 'eu-1', IsOwner: true }),
      },
      entity: {
        findUnique: jest.fn().mockResolvedValue({
          Id: entityId,
          EntityType: EntityType.Individual,
          IsHidden: false,
          IsRenderingEnabled: true,
        }),
      },
      userRoles: {
        findFirst: jest.fn().mockResolvedValue({
          Roles: { Name: 'Admin' },
        }),
      },
      dueDiligenceVerificationQueues: {
        findFirst: jest.fn().mockResolvedValue({ Status: Status.Approved }),
      },
    });

    const claims: Record<string, string> = {};
    await enrichTokenClaims(prisma, user, claims, entityId);

    expect(claims.EntityId).toBe(entityId);
    expect(claims.EntityType).toBe(String(EntityType.Individual));
    expect(claims.IsOwner).toBe('True');
    expect(claims.IdentifireId).toBe('ident-1');
    expect(claims[ClaimTypes.Role]).toBe('Admin');
    expect(claims.IsEntityApproved).toBe('Approved');
    expect(claims.IsHidden).toBe('False');
    expect(claims.IsRenderingEnabled).toBe('True');
    expect(claims.UserTeamHasProvider).toBe('true'); // Admin role short-circuit
  });
});

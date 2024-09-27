import { AppRoles, roleNameToEnum } from '../auth/roles.enum';
import { EntitiesService } from './entities.service';

describe('roleNameToEnum', () => {
  it('maps Identity role names to Roles enum ints', () => {
    expect(roleNameToEnum('Admin')).toBe(AppRoles.Admin);
    expect(roleNameToEnum('OrderingOnlyStaff')).toBe(AppRoles.OrderingOnlyStaff);
    expect(roleNameToEnum('Nope')).toBeNull();
  });
});

describe('EntitiesService.getUserEntitiesById', () => {
  it('returns entities + unCertifiedExists for a membership', async () => {
    const entityId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const prisma = {
      users: { findUnique: jest.fn().mockResolvedValue({ Id: 'user-1' }) },
      entityUsers: {
        findMany: jest.fn().mockResolvedValue([
          {
            Id: 'eu-1',
            EntityId: entityId,
            Entity: {
              Name: 'Practice A',
              EntityImage: null,
              EntityType: 2,
              IsRenderingEnabled: true,
              Identifications: { Id: 'ident-1' },
            },
            EntityUserPreferences: [{ Key: 'IsDefaultPractice', Value: '1' }],
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      },
      userRoles: {
        findFirst: jest.fn().mockResolvedValue({ Roles: { Name: 'Admin' } }),
      },
      entityUserPreferences: { create: jest.fn() },
    };

    const service = new EntitiesService(prisma as never);
    const result = await service.getUserEntitiesById('user-1');

    expect(result.unCertifiedExists).toBe(false);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({
      entityId,
      entityName: 'Practice A',
      isDefaultPractice: true,
      entityUserRole: AppRoles.Admin,
      identificationId: 'ident-1',
    });
  });
});

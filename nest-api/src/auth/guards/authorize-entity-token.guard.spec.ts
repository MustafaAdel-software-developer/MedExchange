import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthorizeEntityTokenGuard } from './authorize-entity-token.guard';

const ENTITY_ID = '11111111-1111-1111-1111-111111111111';
const GUID_EMPTY = '00000000-0000-0000-0000-000000000000';

function contextWith(params: Record<string, string>, currentUserId: string): ExecutionContext {
  const request = { params, currentUser: { Id: currentUserId } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('AuthorizeEntityTokenGuard', () => {
  function makeGuard(entityUsersFindFirst: jest.Mock) {
    const prisma = { entityUsers: { findFirst: entityUsersFindFirst } };
    return new AuthorizeEntityTokenGuard(prisma as never);
  }

  it('allows access when an EntityUsers row exists for the caller + entityId', async () => {
    const findFirst = jest.fn().mockResolvedValue({ Id: 'eu-1' });
    const guard = makeGuard(findFirst);

    await expect(guard.canActivate(contextWith({ entityId: ENTITY_ID }, 'user-1'))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { ApplicationUserId: 'user-1', EntityId: ENTITY_ID } });
  });

  it('forbids access when no EntityUsers row exists', async () => {
    const guard = makeGuard(jest.fn().mockResolvedValue(null));
    await expect(guard.canActivate(contextWith({ entityId: ENTITY_ID }, 'user-1'))).rejects.toThrow(ForbiddenException);
  });

  it('falls back to Guid.Empty when entityId is missing/invalid, mirroring the .NET filter', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const guard = makeGuard(findFirst);

    await expect(guard.canActivate(contextWith({ entityId: 'not-a-guid' }, 'user-1'))).rejects.toThrow(ForbiddenException);
    expect(findFirst).toHaveBeenCalledWith({ where: { ApplicationUserId: 'user-1', EntityId: GUID_EMPTY } });
  });
});

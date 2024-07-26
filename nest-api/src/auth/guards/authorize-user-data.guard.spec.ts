import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthorizeUserDataGuard } from './authorize-user-data.guard';

function contextWith(params: Record<string, string>, currentUserId: string): ExecutionContext {
  const request = { params, currentUser: { Id: currentUserId } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('AuthorizeUserDataGuard', () => {
  const guard = new AuthorizeUserDataGuard();

  it('allows access when the route userId matches the authenticated user', () => {
    expect(guard.canActivate(contextWith({ userId: 'user-1' }, 'user-1'))).toBe(true);
  });

  it('forbids access when the route userId belongs to someone else', () => {
    expect(() => guard.canActivate(contextWith({ userId: 'user-2' }, 'user-1'))).toThrow(ForbiddenException);
  });
});

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../jwt-auth.guard';

/**
 * Node port of Filters/AuthorizeUserData.cs: the `:userId` route param must match the
 * authenticated caller's own id (self-access only). Must run after JwtAuthGuard, e.g.
 * `@UseGuards(JwtAuthGuard, AuthorizeUserDataGuard)`.
 */
@Injectable()
export class AuthorizeUserDataGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.params?.userId;

    if (userId !== request.currentUser?.Id) throw new ForbiddenException();
    return true;
  }
}

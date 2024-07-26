import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClaimTypes } from '../claim-types';
import { AppRoles, roleNameToEnum } from '../roles.enum';
import type { AuthenticatedRequest } from '../jwt-auth.guard';

/**
 * Node port of Filters/AuthorizeAdminEntityData.cs:
 * - JWT EntityId === route entityId AND DB role Admin for that entity, OR
 * - JWT role claim === SystemAdministrator
 */
@Injectable()
export class AuthorizeAdminEntityDataGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const entityId = request.params?.entityId;
    const tokenEntityId = request.user?.EntityId;
    const tokenRole = request.user?.[ClaimTypes.Role];

    if (tokenRole === 'SystemAdministrator') return true;

    if (typeof entityId !== 'string' || tokenEntityId !== entityId) {
      throw new ForbiddenException();
    }

    const userRole = await this.prisma.userRoles.findFirst({
      where: { UserId: request.currentUser.Id, EntityId: entityId },
      include: { Roles: true },
    });
    if (roleNameToEnum(userRole?.Roles?.Name) !== AppRoles.Admin) {
      throw new ForbiddenException();
    }
    return true;
  }
}

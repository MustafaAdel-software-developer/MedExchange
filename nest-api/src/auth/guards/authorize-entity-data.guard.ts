import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ENTITY_DATA_ALLOWED_ROLES, roleNameToEnum } from '../roles.enum';
import type { AuthenticatedRequest } from '../jwt-auth.guard';

/**
 * Node port of Filters/AuthorizeEntityData.cs: route :entityId must match the JWT EntityId
 * claim, and the caller must have Admin/Staff/OrderingOnlyStaff for that entity.
 */
@Injectable()
export class AuthorizeEntityDataGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const entityId = request.params?.entityId;
    const tokenEntityId = request.user?.EntityId;

    if (typeof entityId !== 'string' || tokenEntityId !== entityId) {
      throw new ForbiddenException();
    }

    const userRole = await this.prisma.userRoles.findFirst({
      where: { UserId: request.currentUser.Id, EntityId: entityId },
      include: { Roles: true },
    });
    const roleEnum = roleNameToEnum(userRole?.Roles?.Name);
    if (!roleEnum || !ENTITY_DATA_ALLOWED_ROLES.has(roleEnum)) {
      throw new ForbiddenException();
    }
    return true;
  }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../jwt-auth.guard';

const GUID_EMPTY = '00000000-0000-0000-0000-000000000000';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Node port of Filters/AuthorizeEntityToken.cs: the caller must have an EntityUsers row for the
 * `:entityId` route param (mirrors Guid.Empty fallback for a missing/invalid entityId — such a
 * request will simply find no EntityUsers row and be forbidden). Must run after JwtAuthGuard.
 */
@Injectable()
export class AuthorizeEntityTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.params?.entityId;
    const entityId = typeof raw === 'string' && UUID_REGEX.test(raw) ? raw : GUID_EMPTY;

    const entityUser = await this.prisma.entityUsers.findFirst({
      where: { ApplicationUserId: request.currentUser?.Id, EntityId: entityId },
    });
    if (!entityUser) throw new ForbiddenException();
    return true;
  }
}

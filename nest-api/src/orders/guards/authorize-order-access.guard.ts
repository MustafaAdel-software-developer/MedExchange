import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../../auth/jwt-auth.guard';
import { ORDER_ACCESS_MODE_KEY, type OrderAccessMode } from './order-access.types';

export { ORDER_ACCESS_MODE_KEY, type OrderAccessMode } from './order-access.types';

/**
 * Node port of OrdersService.GetOrderDetails auth check:
 * - rendering: Services.EntityId === JWT EntityId
 * - ordering: OrderedEntityId === JWT EntityId
 */
@Injectable()
export class AuthorizeOrderAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode =
      this.reflector.getAllAndOverride<OrderAccessMode>(ORDER_ACCESS_MODE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'rendering';

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const orderId = request.params?.orderId;
    const tokenEntityId = request.user?.EntityId;

    if (typeof orderId !== 'string' || typeof tokenEntityId !== 'string') {
      throw new ForbiddenException();
    }

    const where =
      mode === 'ordering'
        ? { Id: orderId, OrderedEntityId: tokenEntityId }
        : { Id: orderId, Services: { EntityId: tokenEntityId } };

    const ok = await this.prisma.orders.findFirst({ where, select: { Id: true } });
    if (!ok) throw new ForbiddenException();
    return true;
  }
}

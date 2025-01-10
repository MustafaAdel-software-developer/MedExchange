import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthorizeEntityDataGuard } from '../auth/guards/authorize-entity-data.guard';
import { OrdersService } from './orders.service';
import { PaymentsService } from '../payments/payments.service';
import { unflattenFormBody } from '../common/unflatten-form';
import { AuthorizeOrderAccessGuard } from './guards/authorize-order-access.guard';
import { OrderAccess } from './guards/order-access-mode.decorator';

class OrderingOrderUpdateDto {
  @Type(() => Number)
  @IsNumber()
  status!: number;

  @IsOptional()
  @IsString()
  cancelationResone?: string;

  @IsOptional()
  @IsString()
  pinCode?: string;
}

class CreateExternalProviderDto {
  @IsString()
  npi!: string;

  @IsString()
  firstName!: string;

  /** ClientApp field is often `LastName` (PascalCase). */
  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  LastName?: string;

  @IsOptional()
  @IsString()
  middleName?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('GetOrders/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  getOrders(
    @Param('entityId') entityId: string,
    @Query('Filters') filters?: string,
    @Query('Page') page?: string,
    @Query('PageSize') pageSize?: string,
    @Query('Sorts') sorts?: string,
  ) {
    return this.orders.getOrders(entityId, { filters, page, pageSize, sorts });
  }

  @Get('GetOrderingPracticeOrders/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  getOrderingPracticeOrders(
    @Param('entityId') entityId: string,
    @Query('Filters') filters?: string,
    @Query('Page') page?: string,
    @Query('PageSize') pageSize?: string,
    @Query('Sorts') sorts?: string,
  ) {
    return this.orders.getOrderingPracticeOrders(entityId, { filters, page, pageSize, sorts });
  }

  @Get('GetHoldedOrdersCount/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  getHoldedOrdersCount(@Param('entityId') entityId: string) {
    return this.orders.getHoldedOrdersCount(entityId);
  }

  @Get('GetExternalProviders/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  getExternalProviders(@Param('entityId') entityId: string) {
    return this.orders.getExternalProviders(entityId);
  }

  @Post('CreateExternalProvider/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  createExternalProvider(
    @Req() req: AuthenticatedRequest,
    @Param('entityId') entityId: string,
    @Body() dto: CreateExternalProviderDto,
  ) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string' || tokenEntityId !== entityId) throw new ForbiddenException();
    const lastName = dto.lastName ?? dto.LastName;
    if (!lastName) throw new BadRequestException({ status: 'Error', message: 'Last name is required' });
    return this.orders.createExternalProvider(entityId, {
      npi: dto.npi,
      firstName: dto.firstName,
      lastName,
      middleName: dto.middleName,
    });
  }

  @Get('GetOrdersNotifications/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  getOrdersNotifications(@Param('entityId') entityId: string) {
    return this.orders.getOrdersNotifications(entityId);
  }

  @Get('GetOrderDetailsForRendering/:orderId')
  @OrderAccess('rendering')
  @UseGuards(JwtAuthGuard, AuthorizeOrderAccessGuard)
  getOrderDetailsForRendering(@Param('orderId') orderId: string) {
    return this.orders.getOrderDetails(orderId, 'rendering');
  }

  @Get('GetOrderDetailsForOrdering/:orderId')
  @OrderAccess('ordering')
  @UseGuards(JwtAuthGuard, AuthorizeOrderAccessGuard)
  getOrderDetailsForOrdering(@Param('orderId') orderId: string) {
    return this.orders.getOrderDetails(orderId, 'ordering');
  }

  @Get('GetOrderPaymentLink/:orderId')
  @UseGuards(JwtAuthGuard)
  getOrderPaymentLink(@Req() req: AuthenticatedRequest, @Param('orderId') orderId: string) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.payments.getOrderPaymentLinkData(tokenEntityId, orderId);
  }

  @Get('GetPayNowLink/:orderId')
  @UseGuards(JwtAuthGuard)
  getPayNowLink(@Req() req: AuthenticatedRequest, @Param('orderId') orderId: string) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.payments.getOrderPaymentLinkData(tokenEntityId, orderId);
  }

  @Post('CalculateBillableItemsFee')
  @UseGuards(JwtAuthGuard)
  calculateBillableItemsFee(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    const billableItems = body.billableItems;
    if (!Array.isArray(billableItems) || typeof body.serviceEntityId !== 'string' || typeof body.orderedEntityId !== 'string') {
      throw new BadRequestException({ status: 'Error', message: 'Invalid fee calculation payload' });
    }
    return this.orders.calculateBillableItemsFee(tokenEntityId, {
      billableItems: billableItems as Array<{
        id: string;
        chargeAmount: number;
        units: number;
        classification: number;
        [key: string]: unknown;
      }>,
      serviceEntityId: body.serviceEntityId,
      orderedEntityId: body.orderedEntityId,
    });
  }

  /**
   * Multipart CreateOrder — files ignored until FilesModule (G-FILE-01 / G-ORD-05).
   * Returns order Guid string.
   */
  @Post('CreateOrder/:serviceId')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(AnyFilesInterceptor())
  createOrder(
    @Req() req: AuthenticatedRequest,
    @Param('serviceId') serviceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    const nested =
      Array.isArray(body?.billableItems) || typeof body?.orderedEntityId === 'string'
        ? body
        : unflattenFormBody(body ?? {});
    return this.orders.createOrder(tokenEntityId, req.currentUser.Id, serviceId, nested);
  }

  @Put('UpdateOrderAsyncOrderingProvider/:orderId')
  @UseGuards(JwtAuthGuard)
  updateOrderOrderingProvider(
    @Req() req: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Body() dto: OrderingOrderUpdateDto,
  ) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.orders.updateOrderOrderingProvider(tokenEntityId, orderId, dto);
  }

  /**
   * Accepts JSON or multipart form (ClientApp FormData with Status / ScheduledDate).
   * File fields are ignored until FilesModule (G-ORD-06).
   */
  @Put('UpdateOrder/:orderId')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(AnyFilesInterceptor())
  updateOrder(
    @Req() req: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();

    const statusRaw = body.Status ?? body.status;
    const scheduledRaw = body.ScheduledDate ?? body.scheduledDate;
    const reasonRaw = body.CancelationResone ?? body.cancelationResone;

    return this.orders.updateOrderRendering(
      tokenEntityId,
      orderId,
      {
        status: statusRaw != null && statusRaw !== '' ? Number(statusRaw) : undefined,
        scheduledDate:
          scheduledRaw === undefined
            ? undefined
            : scheduledRaw === '' || scheduledRaw === null
              ? null
              : String(scheduledRaw),
        cancelationResone: reasonRaw != null ? String(reasonRaw) : undefined,
      },
      req.currentUser.Id,
    );
  }
}

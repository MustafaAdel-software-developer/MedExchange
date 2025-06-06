import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillableItemsService } from './billable-items.service';

@Controller('billable-items')
export class BillableItemsController {
  constructor(private readonly billableItems: BillableItemsService) {}

  @Get('GetBillableItemsForOrderingProviders/:serviceId')
  @UseGuards(JwtAuthGuard)
  getBillableItemsForOrderingProviders(@Param('serviceId') serviceId: string) {
    return this.billableItems.getBillableItemsForOrderingProviders(serviceId);
  }
}

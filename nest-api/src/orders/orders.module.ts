import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { AuthorizeOrderAccessGuard } from './guards/authorize-order-access.guard';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService, AuthorizeOrderAccessGuard],
  exports: [OrdersService],
})
export class OrdersModule {}

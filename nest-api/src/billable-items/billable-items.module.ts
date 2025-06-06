import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillableItemsController } from './billable-items.controller';
import { BillableItemsService } from './billable-items.service';

@Module({
  imports: [AuthModule],
  controllers: [BillableItemsController],
  providers: [BillableItemsService],
  exports: [BillableItemsService],
})
export class BillableItemsModule {}

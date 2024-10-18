import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentificationsController } from './identifications.controller';
import { IdentificationsService } from './identifications.service';

@Module({
  imports: [AuthModule],
  controllers: [IdentificationsController],
  providers: [IdentificationsService],
  exports: [IdentificationsService],
})
export class IdentificationsModule {}

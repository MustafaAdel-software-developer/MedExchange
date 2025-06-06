import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EntityDocumentsController } from './entity-documents.controller';
import { EntityDocumentsService } from './entity-documents.service';

@Module({
  imports: [AuthModule],
  controllers: [EntityDocumentsController],
  providers: [EntityDocumentsService],
  exports: [EntityDocumentsService],
})
export class EntityDocumentsModule {}

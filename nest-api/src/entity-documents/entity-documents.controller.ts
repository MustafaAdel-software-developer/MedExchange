import { BadRequestException, Body, Controller, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EntityDocumentsService } from './entity-documents.service';

@Controller('entity-documents')
export class EntityDocumentsController {
  constructor(private readonly docs: EntityDocumentsService) {}

  @Put('GetDocumentsByIds')
  @UseGuards(JwtAuthGuard)
  getDocumentsByIds(@Body() ids: string[]) {
    if (!Array.isArray(ids)) throw new BadRequestException({ status: 'Error', message: 'Expected id array' });
    return this.docs.getDocumentsByIds(ids.map(String).filter(Boolean));
  }
}

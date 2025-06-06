import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Thin EntityDocuments port for order cart document preview. */
@Injectable()
export class EntityDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDocumentsByIds(ids: string[]) {
    if (!ids.length) return [];
    const docs = await this.prisma.entityDocuments.findMany({
      where: { Id: { in: ids } },
      include: { SystemSupportedLanguages: { select: { Name: true } } },
    });
    if (!docs.length) throw new NotFoundException({ status: 'Error', message: 'Entity documents not found' });

    return docs.map((d) => ({
      id: d.Id,
      documentTitle: d.DocumentTitle,
      documentDescription: d.ExternalDescription,
      docLanguageId: d.DocLanguageId,
      language: d.SystemSupportedLanguages?.Name ?? d.DocLanguageCustom ?? null,
    }));
  }
}

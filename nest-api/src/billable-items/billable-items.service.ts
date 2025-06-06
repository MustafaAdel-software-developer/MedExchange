import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Node port of BillableItems GetBillableItemsForOrderingProviders. */
@Injectable()
export class BillableItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBillableItemsForOrderingProviders(serviceId: string) {
    const service = await this.prisma.services.findFirst({
      where: { Id: serviceId, IsPublished: true, IsEnabled: true },
      select: { Id: true },
    });
    if (!service) throw new NotFoundException({ status: 'Error', message: 'Service not found' });

    const rows = await this.prisma.serviceBillableItems.findMany({
      where: { ServiceId: serviceId, IsDeleted: false },
      include: {
        BillableItems: {
          include: { CptCodes: true },
        },
      },
    });

    return rows.map((sb) => {
      const bi = sb.BillableItems;
      const cpt = bi.CptCodes;
      return {
        id: bi.Id,
        attributeType: bi.AttributeType,
        classification: bi.Classification,
        attributeTypeValue: bi.AttributeTypeValue,
        chargeAmount: Number(bi.ChargeAmount),
        shortDescription: bi.ShortDescription,
        longDescription: bi.LongDescription,
        description: bi.Description,
        hcpcs: bi.Hcpcs,
        mod1: bi.Mod1,
        mod2: bi.Mod2,
        mod3: bi.Mod3,
        mod4: bi.Mod4,
        defaultUnits: bi.DefaultUnits,
        isEnabled: bi.IsEnabled,
        cptCode: cpt
          ? {
              id: cpt.Id,
              cptCode: cpt.CPTCode,
              criticalMod: cpt.CriticalMod,
              description: cpt.Description,
              friendlyFull: cpt.FriendlyFull,
              friendlyShort: cpt.FriendlyShort,
            }
          : null,
      };
    });
  }
}

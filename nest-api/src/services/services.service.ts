import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Thin Services port for Find Services + wizard read + landing.
 * Moustafa: wizard writes/publish, capabilities, entity images — G-SVC-01 / G-FILE-01.
 */
@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async getServiceWizard(serviceId: string) {
    const service = await this.prisma.services.findFirst({
      where: {
        Id: serviceId,
        Entity: { IsHidden: false, IsRenderingEnabled: true },
      },
      select: {
        ServiceJson: true,
        ServiceType: true,
        SendCheckInPass: true,
        EntityId: true,
        InternalOnly: true,
      },
    });
    if (!service) throw new NotFoundException({ status: 'Error', message: 'Service not found' });

    return {
      serviceJson: service.ServiceJson,
      serviceType: service.ServiceType,
      sendCheckInPass: service.SendCheckInPass,
      entityId: service.EntityId,
      internalOnly: service.InternalOnly,
    };
  }

  /** Node port of ServiceService.GetAllServices / FindServices. */
  async findServices(
    tokenEntityId: string,
    query: {
      Filters?: string;
      Sorts?: string;
      Page?: string;
      PageSize?: string;
      searchState?: string;
      SearchState?: string;
      myServicesOnly?: string | boolean;
      MyServicesOnly?: string | boolean;
      categoriesKeys?: string | string[];
      CategoriesKeys?: string | string[];
    },
  ) {
    return this.queryFindServices(tokenEntityId, {
      ...query,
      isSavedService: false,
      savedForEntityId: null,
    });
  }

  /** Node port of GetEntitySavedServices. */
  async getEntitySavedServices(
    tokenEntityId: string,
    entityId: string,
    query: {
      Filters?: string;
      Sorts?: string;
      Page?: string;
      PageSize?: string;
      searchState?: string;
      SearchState?: string;
      categoriesKeys?: string | string[];
      CategoriesKeys?: string | string[];
    },
  ) {
    if (tokenEntityId !== entityId) throw new ForbiddenException();
    return this.queryFindServices(tokenEntityId, {
      ...query,
      isSavedService: true,
      savedForEntityId: entityId,
      myServicesOnly: false,
    });
  }

  /**
   * Anonymous LandingPageServices — published non-internal services.
   * Moustafa: entity image file URLs (G-FILE-01); full Sieve / state-location branch parity — G-SVC-01.
   */
  async landingPageServices(query: {
    Filters?: string;
    Sorts?: string;
    Page?: string;
    PageSize?: string;
    searchState?: string;
    SearchState?: string;
  }) {
    const page = Math.max(1, Number(query.Page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(query.PageSize) || 10));
    const searchState = (query.searchState ?? query.SearchState ?? '').trim();
    const filters = (query.Filters ?? '').trim();

    const where: Prisma.ServicesWhereInput = {
      IsPublished: true,
      IsDeleted: false,
      InternalOnly: false,
      Entity: {
        IsHidden: false,
        IsRenderingEnabled: true,
        IsApproved: true,
        IsMaxOrdersExceeded: false,
      },
      ServiceLocations: {
        some: {
          IsEnabled: true,
          IsDeleted: false,
          Locations: {
            IsEnabled: true,
            ...(searchState ? { Addresses: { State: searchState } } : {}),
          },
        },
      },
    };

    if (filters) {
      const terms = filters.split(/\s+/).filter(Boolean);
      where.AND = terms.map((term) => ({
        OR: [
          { Name: { contains: term, mode: 'insensitive' as const } },
          { Description: { contains: term, mode: 'insensitive' as const } },
          { Entity: { Name: { contains: term, mode: 'insensitive' as const } } },
        ],
      }));
    }

    const orderBy: Prisma.ServicesOrderByWithRelationInput =
      query.Sorts === '-Name' ? { Name: 'desc' } : { Name: 'asc' };

    const [total, rows] = await Promise.all([
      this.prisma.services.count({ where }),
      this.prisma.services.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
        include: {
          Entity: { select: { Id: true, Name: true, EntityImage: true } },
          ServiceLocations: {
            where: {
              IsEnabled: true,
              IsDeleted: false,
              Locations: {
                IsEnabled: true,
                ...(searchState ? { Addresses: { State: searchState } } : {}),
              },
            },
            include: { Locations: { include: { Addresses: { select: { State: true } } } } },
          },
        },
      }),
    ]);

    const services = rows.map((s) => {
      const states = [
        ...new Set(
          s.ServiceLocations.map((sl) => sl.Locations.Addresses?.State).filter(
            (st): st is string => !!st,
          ),
        ),
      ];
      return {
        id: s.Id,
        entityId: s.EntityId,
        name: s.Name,
        description: s.Description,
        serviceType: s.ServiceType,
        minFees: Number(s.MinFees),
        entityName: s.Entity.Name,
        // Moustafa: resolve EntityImage via FilesModule — G-FILE-01
        entityImage: null as string | null,
        entityImageId: s.Entity.EntityImage,
        serviceStates: searchState ? [searchState] : states,
      };
    });

    return { services, count: total };
  }

  async getServiceLocations(serviceId: string) {
    const service = await this.prisma.services.findFirst({ where: { Id: serviceId } });
    if (!service) throw new NotFoundException({ status: 'Error', message: 'Service not found' });

    const rows = await this.prisma.serviceLocations.findMany({
      where: { ServiceId: serviceId, IsDeleted: false, IsEnabled: true, Locations: { IsEnabled: true } },
      include: { Locations: { include: { Addresses: true } } },
    });

    return rows.map((sl) => ({
      serviceLocationId: sl.Id,
      name: sl.Locations.Name,
      address: {
        lineOne: sl.Locations.Addresses.LineOne,
        lineTwo: sl.Locations.Addresses.LineTwo,
        city: sl.Locations.Addresses.City,
        state: sl.Locations.Addresses.State,
        zipCode: sl.Locations.Addresses.ZipCode,
      },
    }));
  }

  async saveService(tokenEntityId: string, dto: { entityId: string; serviceId: string }) {
    if (dto.entityId !== tokenEntityId) throw new ForbiddenException();
    const existing = await this.prisma.entitySavedServices.findFirst({
      where: { EntityId: dto.entityId, ServiceId: dto.serviceId },
    });
    if (existing) {
      if (existing.IsDeleted) {
        await this.prisma.entitySavedServices.update({
          where: { Id: existing.Id },
          data: { IsDeleted: false, UpdatedAt: new Date() },
        });
      }
      return { id: existing.Id, entityId: dto.entityId, serviceId: dto.serviceId };
    }
    const now = new Date();
    const created = await this.prisma.entitySavedServices.create({
      data: {
        Id: randomUUID(),
        EntityId: dto.entityId,
        ServiceId: dto.serviceId,
        CreatedAt: now,
        IsDeleted: false,
        IsEnabled: true,
      },
    });
    return { id: created.Id, entityId: dto.entityId, serviceId: dto.serviceId };
  }

  async unSaveService(tokenEntityId: string, entityId: string, serviceId: string) {
    if (entityId !== tokenEntityId) throw new ForbiddenException();
    const existing = await this.prisma.entitySavedServices.findFirst({
      where: { EntityId: entityId, ServiceId: serviceId, IsDeleted: false },
    });
    if (!existing) throw new NotFoundException({ status: 'Error', message: 'Saved service not found' });
    await this.prisma.entitySavedServices.update({
      where: { Id: existing.Id },
      data: { IsDeleted: true, DeletedAt: new Date(), UpdatedAt: new Date() },
    });
    return { status: 'Success', message: 'Saved service deleted successfully.' };
  }

  private async queryFindServices(
    tokenEntityId: string,
    opts: {
      Filters?: string;
      Sorts?: string;
      Page?: string;
      PageSize?: string;
      searchState?: string;
      SearchState?: string;
      myServicesOnly?: string | boolean;
      MyServicesOnly?: string | boolean;
      categoriesKeys?: string | string[];
      CategoriesKeys?: string | string[];
      isSavedService: boolean;
      savedForEntityId: string | null;
    },
  ) {
    const page = Math.max(1, Number(opts.Page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(opts.PageSize) || 10));
    const searchState = (opts.searchState ?? opts.SearchState ?? '').trim();
    const myServicesOnly = boolish(opts.myServicesOnly ?? opts.MyServicesOnly);
    const categoryKeys = asStringArray(opts.categoriesKeys ?? opts.CategoriesKeys);
    const filters = (opts.Filters ?? '').trim();

    const where: Prisma.ServicesWhereInput = {
      IsPublished: true,
      IsDeleted: false,
      Entity: {
        IsHidden: false,
        IsRenderingEnabled: true,
        IsApproved: true,
        IsMaxOrdersExceeded: false,
      },
      ServiceLocations: {
        some: {
          IsEnabled: true,
          IsDeleted: false,
          Locations: {
            IsEnabled: true,
            ...(searchState ? { Addresses: { State: searchState } } : {}),
          },
        },
      },
      AND: [
        {
          OR: [{ EntityId: tokenEntityId }, { InternalOnly: false }],
        },
      ],
    };

    if (myServicesOnly) where.EntityId = tokenEntityId;

    if (opts.isSavedService && opts.savedForEntityId) {
      where.EntitySavedServices = {
        some: { EntityId: opts.savedForEntityId, IsDeleted: false },
      };
    }

    if (categoryKeys.length) {
      where.ServiceCategories = { some: { Categories: { Key: { in: categoryKeys } } } };
    }

    if (filters) {
      const terms = filters.split(/\s+/).filter(Boolean);
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        ...terms.map((term) => ({
          OR: [
            { Name: { contains: term, mode: 'insensitive' as const } },
            { Description: { contains: term, mode: 'insensitive' as const } },
            { Entity: { Name: { contains: term, mode: 'insensitive' as const } } },
          ],
        })),
      ];
    }

    const orderBy: Prisma.ServicesOrderByWithRelationInput =
      opts.Sorts === '-Name' ? { Name: 'desc' } : { Name: 'asc' };

    const [total, rows] = await Promise.all([
      this.prisma.services.count({ where }),
      this.prisma.services.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
        include: {
          Entity: {
            select: {
              Id: true,
              Name: true,
              DoingBusinessAsName: true,
              EntityImage: true,
              Fees: true,
              InternalPracticeFees: true,
            },
          },
          ServiceLocations: {
            where: { IsEnabled: true, IsDeleted: false, Locations: { IsEnabled: true } },
            select: { LocationId: true },
          },
        },
      }),
    ]);

    const savedIds = new Set(
      (
        await this.prisma.entitySavedServices.findMany({
          where: { EntityId: tokenEntityId, IsDeleted: false, ServiceId: { in: rows.map((r) => r.Id) } },
          select: { ServiceId: true },
        })
      ).map((s) => s.ServiceId),
    );

    const services = rows.map((s) => ({
      id: s.Id,
      entityId: s.EntityId,
      name: s.Name,
      description: s.Description,
      serviceType: s.ServiceType,
      minFees: Number(s.MinFees),
      fees:
        s.EntityId === tokenEntityId
          ? Number(s.Entity.InternalPracticeFees)
          : Number(s.Entity.Fees),
      entityName: s.Entity.Name,
      doingBusinessAsName: s.Entity.DoingBusinessAsName,
      internalOnly: s.InternalOnly,
      locationIds: s.ServiceLocations.map((sl) => sl.LocationId),
      // Moustafa: capabilities + entity image file URL — G-SVC-01 / G-FILE-01
      capabilities: [] as unknown[],
      entityImage: null as string | null,
      entityImageId: s.Entity.EntityImage,
      isSavedService: opts.isSavedService || savedIds.has(s.Id),
    }));

    return { services, count: total };
  }
}

function boolish(v: unknown): boolean {
  return v === true || v === 'true' || v === 'True' || v === '1';
}

function asStringArray(v: unknown): string[] {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

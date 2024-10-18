import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { EntityType } from '../auth/auth-enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEntityWithIdentificationDto } from './dto/create-entity-with-identification.dto';

const SETUP_CREATED_ENTITY = 1; // SetupStatus.CreatedEntityWithIdentification
const PREF_DEFAULT = 'IsDefaultPractice';

/**
 * Node port of IdentificationService.CreateEntityIdentificationFlow (core tables).
 * Moustafa: file upload, DataProtector image ids, self-signed cert, and notification seeding
 * deferred — ClientApp still gets entity.id + identification.id for GetToken navigation.
 */
@Injectable()
export class IdentificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createEntityWithIdentification(dto: CreateEntityWithIdentificationDto) {
    const user = await this.prisma.users.findUnique({ where: { Id: dto.applicationUserId } });
    if (!user) throw notFound('User not found');

    if (dto.entity.entityType === EntityType.Individual) {
      const taxId = dto.identification?.taxID?.replace(/-/g, '');
      if (!taxId || !/^\d{9}$/.test(taxId)) {
        throw badRequest('Tax ID is required for individual practices.');
      }
      const taxTaken = await this.prisma.identifications.findFirst({ where: { TaxID: taxId } });
      if (taxTaken) throw badRequest('Tax ID already exists.');

      const ownsIndividual = await this.prisma.identifications.findFirst({
        where: { ModelId: dto.applicationUserId, ModelType: EntityType.Individual },
      });
      if (ownsIndividual) throw badRequest('User owns an individual practice.');
    }

    if (dto.entity.entityType === EntityType.Group && !dto.registeredAgentAddress) {
      throw badRequest('Registered agent address is required for group practices.');
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const principal = await tx.addresses.create({
        data: addressData(dto.entityPrincipalAddress, now),
      });

      let registeredAgentId: string | null = null;
      if (dto.entity.entityType === EntityType.Group && dto.registeredAgentAddress) {
        const agent = await tx.addresses.create({
          data: addressData(dto.registeredAgentAddress, now),
        });
        registeredAgentId = agent.Id;
      }

      const entity = await tx.entity.create({
        data: {
          Id: randomUUID(),
          Name: dto.entity.name,
          DoingBusinessAsName: dto.entity.doingBusinessAsName ?? null,
          EntityType: dto.entity.entityType,
          TechnicalSupportName: dto.entity.technicalSupportName ?? null,
          TechnicalSupportPhoneNumber: dto.entity.technicalSupportPhoneNumber,
          TechnicalSupportEmail: dto.entity.technicalSupportEmail,
          Description: dto.entity.description ?? null,
          EntityPrincipalAddressId: principal.Id,
          RegisteredAgentAddressId: registeredAgentId,
          EntityImage: null,
          IsApproved: false,
          Fees: new Prisma.Decimal(20),
          InternalPracticeFees: new Prisma.Decimal(8),
          SupplyFees: new Prisma.Decimal(8),
          ServiceChargeCapacity: new Prisma.Decimal(500),
          MaxOrdersQuantity: 0,
          IsMaxOrdersExceeded: false,
          IsRenderingEnabled: true,
          IsHidden: false,
          IsDeleted: false,
          IsEnabled: true,
          CreatedAt: now,
        },
      });

      await tx.entitySettings.createMany({
        data: [
          settingRow(entity.Id, 'DefaultTimeZone', dto.entity.defaultTimeZone, now),
          settingRow(entity.Id, 'IsIncludeOrderBarcodeOnCheckInPass', 'true', now),
        ],
      });

      await tx.locations.create({
        data: {
          Id: randomUUID(),
          AddressId: principal.Id,
          EntityId: entity.Id,
          Name:
            dto.entity.entityType === EntityType.Individual
              ? 'Home Address'
              : 'Entity Principal Address',
          CreatedAt: now,
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      const entityUser = await tx.entityUsers.create({
        data: {
          Id: randomUUID(),
          EntityId: entity.Id,
          ApplicationUserId: dto.applicationUserId,
          IsOwner: true,
          IsApproved: true,
          IsCertified: true,
          IsEnabled: true,
          IsProvider: false,
          LastCertifiedDate: now,
          CreatedAt: now,
          IsDeleted: false,
        },
      });

      const identification =
        dto.entity.entityType === EntityType.Group
          ? await tx.identifications.create({
              data: {
                Id: randomUUID(),
                ModelType: EntityType.Group,
                ModelId: entity.Id,
                ApplicationUserId: dto.applicationUserId,
                EntityId: entity.Id,
                TaxID: null,
                IdentityImageId: null,
                SelfieImageId: null,
                CreatedAt: now,
                IsDeleted: false,
                IsEnabled: true,
              },
            })
          : await tx.identifications.create({
              data: {
                Id: randomUUID(),
                ModelType: EntityType.Individual,
                ModelId: dto.applicationUserId,
                ApplicationUserId: dto.applicationUserId,
                EntityId: entity.Id,
                TaxID: dto.identification!.taxID!.replace(/-/g, ''),
                IdentityImageId: null,
                SelfieImageId: null,
                CreatedAt: now,
                IsDeleted: false,
                IsEnabled: true,
              },
            });

      const adminRole = await tx.roles.findFirst({ where: { Name: 'Admin' } });
      if (adminRole) {
        try {
          await tx.userRoles.create({
            data: {
              UserId: dto.applicationUserId,
              RoleId: adminRole.Id,
              EntityId: entity.Id,
              IsDeleted: false,
              CreatedAt: now,
              IsEnabled: true,
            },
          });
        } catch {
          /* unique EntityId on UserRoles — should not collide for new entity */
        }
      }

      await tx.userJourney.create({
        data: {
          UserId: dto.applicationUserId,
          EntityId: entity.Id,
          ActionStatus: SETUP_CREATED_ENTITY,
        },
      });

      await tx.entityUserPreferences.create({
        data: {
          Id: randomUUID(),
          EntityUserId: entityUser.Id,
          Key: PREF_DEFAULT,
          Value: '0',
          CreatedAt: now,
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      return { entity, entityUser, identification, principal };
    });

    return {
      entity: {
        id: result.entity.Id,
        name: result.entity.Name,
        entityType: result.entity.EntityType,
        entityPrincipalAddressId: result.entity.EntityPrincipalAddressId,
        entityPrincipalAddress: {
          lineOne: result.principal.LineOne,
          lineTwo: result.principal.LineTwo,
          city: result.principal.City,
          state: result.principal.State,
          zipCode: result.principal.ZipCode,
        },
        entityImage: result.entity.EntityImage,
        description: result.entity.Description,
        fees: Number(result.entity.Fees),
        isApproved: result.entity.IsApproved,
        createdAt: result.entity.CreatedAt,
      },
      entityUser: {
        id: result.entityUser.Id,
        entityId: result.entityUser.EntityId,
        applicationUserId: result.entityUser.ApplicationUserId,
        isOwner: result.entityUser.IsOwner,
        isApproved: result.entityUser.IsApproved,
        isCertified: result.entityUser.IsCertified,
        isEnabled: result.entityUser.IsEnabled,
        lastCertifiedDate: result.entityUser.LastCertifiedDate,
      },
      identification: {
        id: result.identification.Id,
        entityId: result.identification.EntityId,
        applicationUserId: result.identification.ApplicationUserId,
        modelType: result.identification.ModelType,
        modelId: result.identification.ModelId,
        taxID: result.identification.TaxID,
        identityImageId: result.identification.IdentityImageId,
        selfieImageId: result.identification.SelfieImageId,
      },
    };
  }
}

function addressData(
  a: { lineOne: string; lineTwo?: string; city: string; state: string; zipCode: string },
  now: Date,
) {
  return {
    Id: randomUUID(),
    LineOne: a.lineOne,
    LineTwo: a.lineTwo ?? null,
    City: a.city,
    State: a.state,
    ZipCode: a.zipCode,
    CreatedAt: now,
    IsDeleted: false,
    IsEnabled: true,
  };
}

function settingRow(entityId: string, key: string, value: string, now: Date) {
  return {
    Id: randomUUID(),
    EntityId: entityId,
    Key: key,
    Value: value,
    CreatedAt: now,
    IsDeleted: false,
    IsEnabled: true,
  };
}

function badRequest(message: string): HttpException {
  return new HttpException({ status: 'Error', message }, HttpStatus.NOT_FOUND);
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ status: 'Error', message });
}

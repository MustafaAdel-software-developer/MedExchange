import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppRoles, roleNameToEnum } from '../auth/roles.enum';
import { DashboardView, EntityType, Status } from '../auth/auth-enums';
import { MailService } from '../mail/mail.service';

const PREF_DEFAULT = 'IsDefaultPractice';
const PREF_DASHBOARD = 'LastDashboardView';
const PREF_BANNER = 'IsBannerRead';
const PREF_CHECKLIST = 'IsCheckListClosed';

const ORDER_STATUS_ORDERED = 8;
const ORDER_STATUS_SCHEDULED = 9;

const SETTING_BARCODE = 'IsIncludeOrderBarcodeOnCheckInPass';
const SETTING_TZ = 'DefaultTimeZone';

@Injectable()
export class EntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Node port of EntityUserService.GetUserEntitiesById + repository projection. */
  async getUserEntitiesById(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { Id: userId } });
    if (!user) throw new NotFoundException('User Not Found');

    const entityUsers = await this.prisma.entityUsers.findMany({
      where: {
        ApplicationUserId: userId,
        IsEnabled: true,
        IsCertified: true,
        Entity: { IsEnabled: true },
      },
      include: {
        Entity: { include: { Identifications: true } },
        EntityUserPreferences: true,
      },
    });

    const entities: Array<{
      entityId: string;
      entityName: string | null;
      entityImage: string | null;
      entityImageUrl: string | null;
      entityType: number;
      isRenderingEnabled: boolean;
      lastDashboardView: number;
      isDefaultPractice: boolean;
      identificationId: string;
      entityUserRole: AppRoles | null;
    }> = [];
    for (const eu of entityUsers) {
      const role = await this.getEntityUserRole(eu.EntityId, userId);
      let lastDashboardView = DashboardView.Rendering;
      const dashPref = eu.EntityUserPreferences.find((p) => p.Key === PREF_DASHBOARD);
      if (dashPref?.Value) {
        const parsed = Number(dashPref.Value);
        if (parsed === DashboardView.Rendering || parsed === DashboardView.Ordering) {
          lastDashboardView = parsed;
        }
      }
      if (role === AppRoles.OrderingOnlyStaff) lastDashboardView = DashboardView.Ordering;

      let defaultPref = eu.EntityUserPreferences.find((p) => p.Key === PREF_DEFAULT);
      if (!defaultPref) {
        defaultPref = await this.prisma.entityUserPreferences.create({
          data: {
            Id: randomUUID(),
            EntityUserId: eu.Id,
            Key: PREF_DEFAULT,
            Value: '0',
            CreatedAt: new Date(),
            IsDeleted: false,
            IsEnabled: true,
          },
        });
      }

      entities.push({
        entityId: eu.EntityId,
        entityName: eu.Entity.Name,
        entityImage: eu.Entity.EntityImage,
        entityImageUrl: null as string | null, // file storage deferred
        entityType: eu.Entity.EntityType,
        isRenderingEnabled: eu.Entity.IsRenderingEnabled,
        lastDashboardView,
        isDefaultPractice: defaultPref.Value === '1',
        identificationId: eu.Entity.Identifications?.Id ?? '00000000-0000-0000-0000-000000000000',
        entityUserRole: role,
      });
    }

    const unCertifiedExists =
      (await this.prisma.entityUsers.count({
        where: { ApplicationUserId: userId, IsCertified: false },
      })) > 0;

    return { entities, unCertifiedExists };
  }

  /** Node port of EntityService.GetEntityByIdAsync (image URL deferred). */
  async getEntityById(entityId: string, userId: string) {
    const entity = await this.prisma.entity.findUnique({ where: { Id: entityId } });
    if (!entity) throw new NotFoundException('Entity not found');

    const principal = await this.prisma.addresses.findUnique({ where: { Id: entity.EntityPrincipalAddressId } });
    const entityPrincipalAddress = principal
      ? {
          lineOne: principal.LineOne,
          lineTwo: principal.LineTwo,
          state: principal.State,
          city: principal.City,
          zipCode: principal.ZipCode,
          baseId: principal.Id,
        }
      : null;

    let registeredAgentAddress: typeof entityPrincipalAddress = null;
    if (entity.EntityType === 1 && entity.RegisteredAgentAddressId) {
      const agent = await this.prisma.addresses.findUnique({ where: { Id: entity.RegisteredAgentAddressId } });
      if (agent) {
        registeredAgentAddress = {
          lineOne: agent.LineOne,
          lineTwo: agent.LineTwo,
          state: agent.State,
          city: agent.City,
          zipCode: agent.ZipCode,
          baseId: agent.Id,
        };
      }
    }

    const entityUser = await this.prisma.entityUsers.findFirst({
      where: { EntityId: entityId, ApplicationUserId: userId },
      include: { EntityUserPreferences: true },
    });
    const prefs = entityUser?.EntityUserPreferences ?? [];
    const isBannerRead = prefs.find((p) => p.Key === PREF_BANNER)?.Value === '1';
    const isCheckListClosed = prefs.find((p) => p.Key === PREF_CHECKLIST)?.Value === '1';

    const providerExist =
      (await this.prisma.entityUsers.count({
        where: { EntityId: entityId, IsProvider: true, IsEnabled: true, IsCertified: true },
      })) > 0;

    return {
      id: entity.Id,
      name: entity.Name,
      isApproved: entity.IsApproved,
      entityPrincipalAddressId: entity.EntityPrincipalAddressId,
      entityPrincipalAddress,
      doingBusinessAsName: entity.DoingBusinessAsName,
      registeredAgentAddress,
      technicalSupportName: entity.TechnicalSupportName,
      technicalSupportPhoneNumber: entity.TechnicalSupportPhoneNumber,
      technicalSupportEmail: entity.TechnicalSupportEmail,
      entityType: entity.EntityType,
      entityImage: entity.EntityImage,
      imageUrl: null as string | null,
      description: entity.Description,
      createdAt: entity.CreatedAt,
      providerExist,
      maxOrdersQuantity: entity.MaxOrdersQuantity,
      fees: Number(entity.Fees),
      supplyFees: Number(entity.SupplyFees),
      serviceChargeCapacity: Number(entity.ServiceChargeCapacity),
      isBannerRead,
      isCheckListClosed,
    };
  }

  /** Node port of EntityUserPreferencesService.SetDefaultPractice. */
  async setDefaultPractice(userId: string, entityId: string, isDefaultPractice: boolean) {
    const target = await this.prisma.entityUsers.findFirst({
      where: { EntityId: entityId, ApplicationUserId: userId, IsEnabled: true },
    });
    if (!target) throw new ForbiddenException();

    const currentDefault = await this.prisma.entityUserPreferences.findFirst({
      where: {
        Key: PREF_DEFAULT,
        Value: '1',
        EntityUsers: { ApplicationUserId: userId },
      },
    });

    if (isDefaultPractice && currentDefault?.EntityUserId !== target.Id) {
      await this.upsertPreference(target.Id, PREF_DEFAULT, '1');
    }

    if (currentDefault && currentDefault.EntityUserId !== target.Id) {
      await this.upsertPreference(currentDefault.EntityUserId, PREF_DEFAULT, '0');
    } else if (currentDefault && currentDefault.EntityUserId === target.Id && !isDefaultPractice) {
      await this.upsertPreference(target.Id, PREF_DEFAULT, '0');
    } else if (isDefaultPractice && !currentDefault) {
      await this.upsertPreference(target.Id, PREF_DEFAULT, '1');
    }

    return { status: 'Success', message: 'Entity updated successfully.' };
  }

  /** Node port of EntityUserService.GetEntityUsers (no Sieve — ClientApp filters client-side). */
  async getEntityStaff(entityId: string) {
    const entity = await this.prisma.entity.findFirst({
      where: { Id: entityId, IsHidden: false },
    });
    if (!entity) throw new NotFoundException({ status: 'Error', message: 'Entity not found' });

    const rows = await this.prisma.entityUsers.findMany({
      where: { EntityId: entityId },
      include: { Users: true },
    });

    const userIds = rows.map((r) => r.ApplicationUserId).filter((id): id is string => !!id);
    const roles = await this.prisma.userRoles.findMany({
      where: { EntityId: entityId, UserId: { in: userIds } },
      include: { Roles: true },
    });
    const roleByUser = new Map(roles.map((r) => [r.UserId, r.Roles?.Name ?? '']));

    return rows
      .filter((r) => r.Users && r.ApplicationUserId)
      .map((r) => ({
        applicationUserId: r.ApplicationUserId!,
        entityUserId: r.Id,
        name: `${r.Users!.FirstName ?? ''} ${r.Users!.LastName ?? ''}`.trim(),
        role: roleByUser.get(r.ApplicationUserId!) ?? '',
        lastCertifiedDate: r.LastCertifiedDate,
        isCertified: r.IsCertified,
        isEnabled: r.IsEnabled,
        isOwner: r.IsOwner,
        email: r.Users!.Email ?? '',
        userImage: null as string | null,
        isProvider: false,
        isInvitedAsAProvider: r.IsProvider,
      }));
  }

  /** Node port of EntityService.InviteStaff — creates pending invitations + email (raw UUID link). */
  async inviteStaff(
    entityId: string,
    invitedByName: string,
    invitations: Array<{ staffEmail: string; staffRole: number; isProvider?: boolean }>,
  ) {
    const entity = await this.prisma.entity.findFirst({ where: { Id: entityId, IsHidden: false } });
    if (!entity) throw notFound('Entity not found');
    if (!invitedByName) throw badRequest('Invalid');

    const errors: string[] = [];
    const seen = new Set<string>();

    for (const invit of invitations) {
      const email = invit.staffEmail?.trim();
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());

      const pending = await this.prisma.invitations.findFirst({
        where: { InvitedUserEmail: email, EntityId: entityId, Status: Status.Pending },
      });
      if (pending) {
        errors.push(`${email} is already invited.`);
        continue;
      }

      const existingUser = await this.prisma.users.findFirst({ where: { Email: email, IsAdmin: false } });
      if (existingUser) {
        const joined = await this.prisma.entityUsers.findFirst({
          where: { ApplicationUserId: existingUser.Id, EntityId: entityId },
        });
        if (joined) {
          errors.push(`${email} has already joined.`);
          continue;
        }
      }

      const invitationId = randomUUID();
      const invitationDate = new Date();
      await this.prisma.invitations.create({
        data: {
          Id: invitationId,
          EntityId: entityId,
          InvitationDate: invitationDate,
          Status: Status.Pending,
          InvitedBy: invitedByName,
          InvitedUserEmail: email,
          StaffRole: invit.staffRole,
          IsProvider: invit.isProvider ?? false,
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      // Moustafa: .NET uses DataProtector-encrypted query params; Nest sends raw UUIDs until protector is ported.
      const frontend = this.config.get<string>('FRONTEND_URL') ?? 'https://localhost:44413';
      const link =
        `${frontend}/register?EId=${entityId}&InvId=${invitationId}` +
        `&date=${encodeURIComponent(invitationDate.toISOString())}` +
        `&role=${invit.staffRole}&isProvider=${invit.isProvider ?? false}`;

      await this.mail.sendMail({
        to: email,
        subject: `You're invited to join ${entity.Name ?? 'a practice'} on MedExchange`,
        html: `<p>You have been invited to join <strong>${entity.Name ?? 'a practice'}</strong>.</p><p><a href="${link}">Accept invitation</a></p>`,
        text: `You have been invited to join ${entity.Name ?? 'a practice'}. Accept: ${link}`,
      });
    }

    if (errors.length) throw badRequest(errors.join(', '));
    return { status: 'Success', message: 'Invitation Sent Successfully' };
  }

  /** Node port of EntityService.GetPracticeCheckList. */
  async getPracticeCheckList(entityId: string, currentUserId: string) {
    const entity = await this.prisma.entity.findFirst({
      where: { Id: entityId },
      include: {
        BankAccountInfos: { take: 1 },
        BillableItems: { take: 1 },
        Services: { select: { IsPublished: true } },
        EntityUsers: { where: { IsProvider: true }, take: 1 },
      },
    });
    if (!entity) throw badRequest('Entity not found');

    const [
      providerDataCompleted,
      individualDataCompleted,
      practiceApproval,
      phoneVerified,
    ] = await Promise.all([
      this.prisma.identifications.count({
        where: {
          EntityId: null,
          ModelId: currentUserId,
          ModelType: EntityType.Individual,
          SelfieImageId: { not: null },
          IdentityImageId: { not: null },
        },
      }),
      this.prisma.dueDiligenceVerificationQueues.count({
        where: {
          Identifications: {
            EntityId: entityId,
            ModelType: EntityType.Individual,
            SelfieImageId: { not: null },
            IdentityImageId: { not: null },
          },
        },
      }),
      this.prisma.dueDiligenceVerificationQueues.count({
        where: { Identifications: { EntityId: entityId }, Status: Status.Approved },
      }),
      this.prisma.users
        .findUnique({ where: { Id: currentUserId }, select: { PhoneNumberConfirmed: true } })
        .then((u) => u?.PhoneNumberConfirmed ?? false),
    ]);

    return {
      providerDataCompleted: providerDataCompleted > 0,
      individualDataCompleted: individualDataCompleted > 0,
      location: true,
      depositMethod: (entity.BankAccountInfos?.length ?? 0) > 0,
      billableItems: (entity.BillableItems?.length ?? 0) > 0,
      service: (entity.Services?.length ?? 0) > 0,
      isServicePublished: entity.Services?.some((s) => s.IsPublished) ?? false,
      practiceApproval: practiceApproval > 0,
      verifiedProvider: (entity.EntityUsers?.length ?? 0) > 0,
      isCurrentUserPhoneNumberVerified: phoneVerified,
    };
  }

  /** Node port of EntitySettings GetGeneralSettings. */
  async getGeneralSettings(entityId: string) {
    await this.requireEntity(entityId);
    const rows = await this.prisma.entitySettings.findMany({ where: { EntityId: entityId } });
    const map = new Map(rows.map((r) => [r.Key, r.Value]));
    return {
      isIncludeOrderBarcodeOnCheckInPass: parseBoolSetting(map.get(SETTING_BARCODE)),
      defaultTimeZone: map.get(SETTING_TZ) ?? null,
    };
  }

  /** Node port of EntityService.ChangeEntitySettings (general settings subset). */
  async changeGeneralSettings(
    entityId: string,
    dto: { isIncludeOrderBarcodeOnCheckInPass: boolean; defaultTimeZone: string },
  ) {
    await this.requireEntity(entityId);
    await this.upsertEntitySetting(
      entityId,
      SETTING_BARCODE,
      dto.isIncludeOrderBarcodeOnCheckInPass ? 'True' : 'False',
    );
    await this.upsertEntitySetting(entityId, SETTING_TZ, dto.defaultTimeZone);
    return { status: 'Success', message: 'Global Service Limits updated successfully' };
  }

  /** Node port of EntityService.SetOrdersSettings. */
  async setOrdersSettings(entityId: string, maxOrdersQuantity: number) {
    await this.requireEntity(entityId);
    const inProgress = await this.prisma.orders.count({
      where: {
        Services: { EntityId: entityId },
        Status: { in: [ORDER_STATUS_ORDERED, ORDER_STATUS_SCHEDULED] },
      },
    });

    let isMaxOrdersExceeded = false;
    if (maxOrdersQuantity > 0 && inProgress >= maxOrdersQuantity) isMaxOrdersExceeded = true;

    await this.prisma.entity.update({
      where: { Id: entityId },
      data: {
        MaxOrdersQuantity: maxOrdersQuantity,
        IsMaxOrdersExceeded: isMaxOrdersExceeded,
        UpdatedAt: new Date(),
      },
    });

    return { maxOrdersQuantity };
  }

  /** Node port of EntityService.GetEntityUsersProviders (teams filter deferred). */
  async getEntityProviders(entityId: string) {
    await this.requireEntity(entityId);
    const rows = await this.prisma.entityUsers.findMany({
      where: { EntityId: entityId, IsProvider: true, IsEnabled: true, IsCertified: true },
      include: { Users: true },
    });

    const userIds = rows.map((r) => r.ApplicationUserId).filter((id): id is string => !!id);
    const idents = await this.prisma.identifications.findMany({
      where: { ApplicationUserId: { in: userIds }, ModelType: EntityType.Individual },
      include: { NPIs: { take: 1 } },
    });
    const npiByUser = new Map(
      idents.map((i) => [i.ApplicationUserId, i.NPIs[0]?.NpiNumber ?? undefined]),
    );

    const providers = rows
      .filter((r) => r.ApplicationUserId && r.Users)
      .map((r) => ({
        id: r.ApplicationUserId!,
        entityUserId: r.Id,
        fullName: `${r.Users!.FirstName ?? ''} ${r.Users!.LastName ?? ''}`.trim(),
        npi: npiByUser.get(r.ApplicationUserId!),
      }));

    const unCertifiedExists =
      (await this.prisma.entityUsers.count({
        where: { EntityId: entityId, IsProvider: true, IsCertified: false },
      })) > 0;

    return { providers, unCertifiedExists };
  }

  /** Node port of EntityService.GetEntityServices — minimal fields; optional IsPublished sieve filter. */
  async getEntityServices(entityId: string, filters?: string) {
    await this.requireEntity(entityId);
    const where: { EntityId: string; IsPublished?: boolean; Entity: { IsHidden: boolean } } = {
      EntityId: entityId,
      Entity: { IsHidden: false },
    };
    if (filters?.includes('IsPublished==true')) where.IsPublished = true;
    else if (filters?.includes('IsPublished==false')) where.IsPublished = false;

    const services = await this.prisma.services.findMany({ where });
    return services.map((s) => ({
      id: s.Id,
      name: s.Name,
      description: s.Description,
      internalOnly: s.InternalOnly,
      minFees: Number(s.MinFees),
      isPublished: s.IsPublished,
      isTemplate: s.IsTemplate,
      serviceType: s.ServiceType,
    }));
  }

  /** Node port of EntityService.GetAllEntitiesToBeJoined (image URL deferred). */
  async getAllEntitiesToBeJoined(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { Id: userId } });
    if (!user) throw notFound('User not found');

    const joinedRequestEntityIds = (
      await this.prisma.joiningRequests.findMany({
        where: { ApplicationUserId: userId },
        select: { EntityId: true },
      })
    ).map((j) => j.EntityId);

    const memberEntityIds = new Set(
      (
        await this.prisma.entityUsers.findMany({
          where: { ApplicationUserId: userId },
          select: { EntityId: true },
        })
      ).map((e) => e.EntityId),
    );

    const entities = await this.prisma.entity.findMany({
      where: {
        IsEnabled: true,
        IsHidden: false,
        DeletedAt: null,
        EntityType: EntityType.Group,
        ...(joinedRequestEntityIds.length ? { Id: { notIn: joinedRequestEntityIds } } : {}),
      },
    });

    const addressIds = entities.map((e) => e.EntityPrincipalAddressId);
    const addresses = await this.prisma.addresses.findMany({ where: { Id: { in: addressIds } } });
    const addressById = new Map(addresses.map((a) => [a.Id, a]));

    return entities.map((e) => {
      const addr = addressById.get(e.EntityPrincipalAddressId);
      return {
        id: e.Id,
        name: e.Name,
        description: e.Description,
        entityImageURL: null as string | null,
        address: {
          lineOne: addr?.LineOne ?? null,
          state: addr?.State ?? null,
        },
        isMember: memberEntityIds.has(e.Id),
      };
    });
  }

  /** Node port of InvitationService.GetInvitationData. */
  async getInvitationData(invitationId: string) {
    const invite = await this.prisma.invitations.findUnique({ where: { Id: invitationId } });
    if (!invite) throw notFound('Invitation not found');
    return { invitedUserEmail: invite.InvitedUserEmail };
  }

  /** Node port of JoiningRequestsService.AddJoiningRequests. */
  async addJoinRequest(currentUserId: string, applicationUserId: string, entityId: string) {
    if (applicationUserId !== currentUserId) throw new ForbiddenException();

    const entity = await this.prisma.entity.findFirst({
      where: { Id: entityId, IsEnabled: true, IsHidden: false },
    });
    if (!entity) throw badRequest('Entity not found');

    const alreadyMember = await this.prisma.entityUsers.findFirst({
      where: { ApplicationUserId: applicationUserId, EntityId: entityId },
    });
    if (alreadyMember) throw badRequest('User has already joined.');

    const pending = await this.prisma.joiningRequests.findFirst({
      where: { ApplicationUserId: applicationUserId, EntityId: entityId, Status: Status.Pending },
    });
    if (pending) throw badRequest('Join request already exists.');

    const now = new Date();
    await this.prisma.joiningRequests.create({
      data: {
        Id: randomUUID(),
        EntityId: entityId,
        ApplicationUserId: applicationUserId,
        Status: Status.Pending,
        RequestDate: now,
        CreatedAt: now,
        IsApproved: false,
        IsDeleted: false,
        IsEnabled: true,
      },
    });

    return {
      entityName: entity.Name,
      technicalSupportName: entity.TechnicalSupportName,
      technicalSupportPhoneNumber: entity.TechnicalSupportPhoneNumber,
      technicalSupportEmail: entity.TechnicalSupportEmail,
    };
  }

  /** Node port of EntityService.GetEntityTechnicalDataFromServiceIdTask. */
  async getEntityTechnicalDataFromServiceId(serviceId: string) {
    const service = await this.prisma.services.findFirst({
      where: { Id: serviceId },
      select: { EntityId: true },
    });
    if (!service) throw notFound('Entity not found');

    const entity = await this.prisma.entity.findFirst({
      where: { Id: service.EntityId },
      select: {
        TechnicalSupportName: true,
        TechnicalSupportPhoneNumber: true,
        TechnicalSupportEmail: true,
      },
    });
    if (!entity) throw notFound('Entity not found');

    return {
      technicalSupportName: entity.TechnicalSupportName,
      technicalSupportPhoneNumber: entity.TechnicalSupportPhoneNumber,
      technicalSupportEmail: entity.TechnicalSupportEmail,
    };
  }

  private async requireEntity(entityId: string) {
    const entity = await this.prisma.entity.findFirst({ where: { Id: entityId } });
    if (!entity) throw notFound('Entity not found');
    return entity;
  }

  private async upsertEntitySetting(entityId: string, key: string, value: string) {
    const existing = await this.prisma.entitySettings.findFirst({
      where: { EntityId: entityId, Key: key },
    });
    if (existing) {
      await this.prisma.entitySettings.update({
        where: { Id: existing.Id },
        data: { Value: value, UpdatedAt: new Date() },
      });
      return;
    }
    await this.prisma.entitySettings.create({
      data: {
        Id: randomUUID(),
        EntityId: entityId,
        Key: key,
        Value: value,
        CreatedAt: new Date(),
        IsDeleted: false,
        IsEnabled: true,
      },
    });
  }

  private async getEntityUserRole(entityId: string, userId: string): Promise<AppRoles | null> {
    const userRole = await this.prisma.userRoles.findFirst({
      where: { UserId: userId, EntityId: entityId },
      include: { Roles: true },
    });
    return roleNameToEnum(userRole?.Roles?.Name);
  }

  private async upsertPreference(entityUserId: string, key: string, value: string): Promise<void> {
    const existing = await this.prisma.entityUserPreferences.findUnique({
      where: { EntityUserId_Key: { EntityUserId: entityUserId, Key: key } },
    });
    if (existing) {
      await this.prisma.entityUserPreferences.update({
        where: { Id: existing.Id },
        data: { Value: value, UpdatedAt: new Date() },
      });
      return;
    }
    await this.prisma.entityUserPreferences.create({
      data: {
        Id: randomUUID(),
        EntityUserId: entityUserId,
        Key: key,
        Value: value,
        CreatedAt: new Date(),
        IsDeleted: false,
        IsEnabled: true,
      },
    });
  }
}

function parseBoolSetting(value: string | null | undefined): boolean {
  if (value == null) return true; // .NET default for barcode checkbox
  return value === 'True' || value === 'true' || value === '1';
}

function badRequest(message: string): HttpException {
  return new HttpException({ status: 'Error', message }, HttpStatus.BAD_REQUEST);
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ status: 'Error', message });
}

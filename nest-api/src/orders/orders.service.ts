import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PasswordHasherService, PasswordVerificationResult } from '../auth/password-hasher.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseSieveQuery, type SieveQuery } from '../common/sieve/parse-sieve';
import type { OrderAccessMode } from './guards/order-access.types';

const ORDER_FILE_RESULT = 1;
const ORDER_FILE_ATTACHMENT = 2;
const ORDER_STATUS_PENDING_PROVIDER = 1;
const ORDER_STATUS_PENDING_PAYMENT = 3;
const ORDER_STATUS_PENDING_RENDER = 5;
const ORDER_STATUS_ORDERED = 8;
const ORDER_STATUS_HOLD_BY_RENDER = 7;
const ORDER_STATUS_RECALLED = 10;
const ORDER_STATUS_CANCELLED = 11;
const SERVICE_TYPE_WALK_IN = 1;
const SERVICE_TYPE_SCHEDULED = 2;
const ORDER_TYPE_INTERNAL = 1;
const ORDER_TYPE_EXTERNAL = 2;
const CLASSIFICATION_SERVICE = 1;
const CLASSIFICATION_NON_REFUNDABLE = 3;
const PROVIDER_APPROVAL_APPROVED = 1;
const SETTING_TZ = 'DefaultTimeZone';

/**
 * Node port of Orders list/detail/holded/notifications slice.
 * Moustafa: patient/note fields may be RSA-encrypted at rest — returned as stored until EncryptionService is ported.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  /** Rendering practice orders — Services.EntityId === entityId. */
  async getOrders(entityId: string, query: SieveQuery) {
    const sieve = parseSieveQuery(query);
    const where: Prisma.OrdersWhereInput = {
      Services: { EntityId: entityId },
      ...(sieve.statusIn?.length ? { Status: { in: sieve.statusIn } } : {}),
      ...(sieve.archievedAtNull === true ? { ArchievedAt: null } : {}),
      ...(sieve.archievedAtNull === false ? { ArchievedAt: { not: null } } : {}),
      ...(sieve.patientNameContains
        ? { PatientName: { contains: sieve.patientNameContains, mode: 'insensitive' } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.orders.count({ where }),
      this.prisma.orders.findMany({
        where,
        skip: sieve.skip,
        take: sieve.take,
        orderBy: sieve.orderBy as Prisma.OrdersOrderByWithRelationInput[],
        include: {
          Services: { select: { Name: true, EntityId: true } },
          Entity: { select: { Name: true } },
          OrderFiles: { select: { Type: true } },
        },
      }),
    ]);

    return rows.map((o, i) => ({
      id: o.Id,
      orderTrackingNumber: Number(o.OrderTrackingNumber),
      patientName: o.PatientName,
      patientPhoneNumber: o.PatientPhoneNumber,
      patientEmail: o.PatientEmail,
      serviceName: o.Services.Name,
      serviceType: o.ServiceType,
      charge: Number(o.ServiceCharge),
      orderedBy: o.Entity?.Name ?? null,
      orderedDate: o.OrderedDate,
      scheduledDate: o.ScheduledDate,
      status: o.Status,
      orderType: o.OrderType,
      hasResultFiles: o.OrderFiles.some((f) => f.Type === ORDER_FILE_RESULT),
      hasAttachmentFiles: o.OrderFiles.some((f) => f.Type === ORDER_FILE_ATTACHMENT),
      hasNonRefundableItems: o.HasNonRefundableItems,
      archievedAt: o.ArchievedAt,
      ...(i === 0 ? { count: total } : {}),
    }));
  }

  /** Ordering practice orders — OrderedEntityId === entityId. */
  async getOrderingPracticeOrders(entityId: string, query: SieveQuery) {
    const sieve = parseSieveQuery(query);
    const where: Prisma.OrdersWhereInput = {
      OrderedEntityId: entityId,
      ...(sieve.statusIn?.length ? { Status: { in: sieve.statusIn } } : {}),
      ...(sieve.archievedAtNull === true ? { ArchievedAt: null } : {}),
      ...(sieve.archievedAtNull === false ? { ArchievedAt: { not: null } } : {}),
      ...(sieve.patientNameContains
        ? { PatientName: { contains: sieve.patientNameContains, mode: 'insensitive' } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.orders.count({ where }),
      this.prisma.orders.findMany({
        where,
        skip: sieve.skip,
        take: sieve.take,
        orderBy: sieve.orderBy as Prisma.OrdersOrderByWithRelationInput[],
        include: {
          Services: { select: { Name: true, EntityId: true, SendCheckInPass: true, Entity: { select: { Name: true } } } },
          OrderFiles: { select: { Type: true } },
          OrderDocuments: { select: { OrderId: true }, take: 1 },
          PaymentProcessing: {
            include: { StripeTransactions: { include: { PaymentLinks: true } } },
          },
        },
      }),
    ]);

    const providerIds = [
      ...new Set(
        rows
          .map((o) => (o.OrderType === ORDER_TYPE_INTERNAL ? o.AssignedProviderId : o.OrderedBy))
          .filter((id): id is string => !!id),
      ),
    ];
    const providers = providerIds.length
      ? await this.prisma.users.findMany({
          where: { Id: { in: providerIds } },
          select: { Id: true, UserName: true, FirstName: true, LastName: true },
        })
      : [];
    const providerById = new Map(providers.map((p) => [p.Id, p]));

    return rows.map((o, i) => {
      const providerKey = o.OrderType === ORDER_TYPE_INTERNAL ? o.AssignedProviderId : o.OrderedBy;
      const provider = providerKey ? providerById.get(providerKey) : undefined;
      const paymentLink =
        o.PaymentProcessing?.StripeTransactions?.PaymentLinks?.PaymentLink ?? null;
      const assignedProviderName =
        provider?.UserName ??
        (`${provider?.FirstName ?? ''} ${provider?.LastName ?? ''}`.trim() || null);

      return {
        id: o.Id,
        orderTrackingNumber: Number(o.OrderTrackingNumber),
        patientName: o.PatientName,
        serviceName: o.Services.Name,
        serviceType: o.ServiceType,
        charge: Number(o.Charge),
        orderedBy: o.OrderedBy,
        offeredBy: o.Services.Entity?.Name ?? null,
        assignedProviderId: providerKey ?? null,
        assignedProviderName,
        orderedDate: o.OrderedDate,
        scheduledDate: o.ScheduledDate,
        status: o.Status,
        orderType: o.OrderType,
        hasResultFiles: o.OrderFiles.some((f) => f.Type === ORDER_FILE_RESULT),
        hasAttachmentFiles: o.OrderFiles.some((f) => f.Type === ORDER_FILE_ATTACHMENT),
        hasDocuments: (o.OrderDocuments?.length ?? 0) > 0,
        paymentLink,
        isExpired: false,
        hasNonRefundableItems: o.HasNonRefundableItems,
        isCheckInPassFileAvailable:
          ((o.Status === ORDER_STATUS_ORDERED && o.ServiceType === SERVICE_TYPE_WALK_IN) ||
            (o.Status === 9 && o.ServiceType === SERVICE_TYPE_SCHEDULED)) &&
          o.Services.SendCheckInPass,
        ...(i === 0 ? { count: total } : {}),
      };
    });
  }

  async getHoldedOrdersCount(entityId: string): Promise<number> {
    return this.prisma.orders.count({
      where: {
        Status: ORDER_STATUS_PENDING_RENDER,
        Services: { EntityId: entityId },
      },
    });
  }

  async getOrdersNotifications(entityId: string) {
    const rows = await this.prisma.orders.findMany({
      where: {
        OrderedEntityId: entityId,
        Status: { in: [ORDER_STATUS_ORDERED, ORDER_STATUS_HOLD_BY_RENDER] },
        BellNotifications: { IsRead: false },
      },
      include: {
        BellNotifications: true,
        Services: { include: { Entity: { select: { Name: true } } } },
      },
    });

    return rows
      .filter((o) => o.BellNotifications)
      .map((o) => ({
        orderNotificationId: o.BellNotifications!.Id,
        orderTrackingNumber: Number(o.OrderTrackingNumber),
        offeredBy: o.Services.Entity?.Name ?? null,
        status: o.Status,
      }));
  }

  async getOrderDetails(orderId: string, mode: OrderAccessMode) {
    const order = await this.prisma.orders.findUnique({
      where: { Id: orderId },
      include: {
        Services: {
          select: {
            Name: true,
            EntityId: true,
            SendCheckInPass: true,
            ServiceType: true,
          },
        },
        Entity: {
          select: {
            Name: true,
            TechnicalSupportName: true,
            TechnicalSupportEmail: true,
            TechnicalSupportPhoneNumber: true,
          },
        },
        OrderBillableItems: { include: { BillableItemsHistory: true } },
        OrderRenderedLocations: {
          include: { Locations: { include: { Addresses: true } } },
        },
        OrderFiles: { select: { Type: true } },
        OrderDocuments: { select: { OrderId: true }, take: 1 },
        Notes: { select: { Id: true }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException({ status: 'Error', message: 'Order not found' });

    const billables = order.OrderBillableItems.map((obi) => {
      const h = obi.BillableItemsHistory;
      const chargeAmount = Number(mode === 'ordering' ? obi.UnitCharged : obi.UnitPrice);
      return {
        id: obi.Id,
        shortDescription: h.ShortDescription,
        longDescription: h.LongDescription,
        description: h.Description,
        hcpcs: h.Hcpcs,
        mod1: h.Mod1,
        mod2: h.Mod2,
        mod3: h.Mod3,
        mod4: h.Mod4,
        attributeType: h.AttributeType,
        attributeTypeValue: h.AttributeTypeValue,
        classification: h.Classification,
        units: obi.BillableItemUnits,
        chargeAmount,
        totalCharge: chargeAmount * obi.BillableItemUnits,
      };
    });

    const locations = order.OrderRenderedLocations.filter((l) =>
      order.ScheduledDate ? l.IsSelectedByRenderProvider : true,
    ).map((l) => ({
      locationId: l.LocationId,
      name: l.Locations.Name,
      address: {
        lineOne: l.Locations.Addresses?.LineOne ?? null,
        lineTwo: l.Locations.Addresses?.LineTwo ?? null,
        city: l.Locations.Addresses?.City ?? null,
        state: l.Locations.Addresses?.State ?? null,
        zipCode: l.Locations.Addresses?.ZipCode ?? null,
      },
      isPreferredByPatient: l.IsPreferredByPatient,
      isSelectedByRenderProvider: l.IsSelectedByRenderProvider,
    }));

    let orderingProvider: string | null = null;
    if (order.AssignedProviderId) {
      const user = await this.prisma.users.findUnique({
        where: { Id: order.AssignedProviderId },
        select: { FirstName: true, LastName: true, UserName: true },
      });
      orderingProvider =
        user?.UserName ??
        (`${user?.FirstName ?? ''} ${user?.LastName ?? ''}`.trim() || null);
    }

    let orderedByName: string | null = null;
    if (order.OrderedBy) {
      const user = await this.prisma.users.findUnique({
        where: { Id: order.OrderedBy },
        select: { FirstName: true, LastName: true, UserName: true },
      });
      orderedByName =
        user?.UserName ??
        (`${user?.FirstName ?? ''} ${user?.LastName ?? ''}`.trim() || order.OrderedBy);
    }

    const isCheckInPassFileAvailable =
      ((order.Status === ORDER_STATUS_ORDERED && order.ServiceType === SERVICE_TYPE_WALK_IN) ||
        (order.Status === 9 && order.ServiceType === SERVICE_TYPE_SCHEDULED)) &&
      order.Services.SendCheckInPass &&
      mode === 'ordering';

    return {
      orderTrackingNumber: Number(order.OrderTrackingNumber),
      serviceName: order.Services.Name,
      serviceType: order.ServiceType,
      serviceId: order.ServiceId,
      orderStatus: order.Status,
      orderType: order.OrderType,
      scheduledDate: order.ScheduledDate,
      orderedDate: order.OrderedDate,
      createdAt: order.CreatedAt,
      archievedAt: order.ArchievedAt,
      orderingProvider,
      orderedBy: orderedByName,
      // Moustafa: may be ciphertext until entity RSA decrypt is ported
      orderNote: order.OrderNote,
      confidentialInternalNote: order.ConfidentialInternalNote,
      medicalRecordNumber: null as string | null,
      hasMessagingNotes: (order.Notes?.length ?? 0) > 0,
      hasServiceDocs: (order.OrderDocuments?.length ?? 0) > 0,
      hasAttachmentFiles: order.OrderFiles.some((f) => f.Type === ORDER_FILE_ATTACHMENT),
      isCheckInPassFileAvailable,
      hasNonRefundableItems: order.HasNonRefundableItems,
      technicalSupport: {
        technicalSupportName: order.Entity.TechnicalSupportName,
        technicalSupportEmail: order.Entity.TechnicalSupportEmail,
        technicalSupportPhoneNumber: order.Entity.TechnicalSupportPhoneNumber,
      },
      orderBillableItems: billables,
      orderLocations: locations,
      existingOnFileData: null as null,
      paymentLink: null as string | null,
      isExpired: false,
    };
  }

  /**
   * Node port of OrdersService.BillableItemsFeeCalculation.
   * ClientApp merges `{ item, ...rest }` into one row for the cart.
   */
  async calculateBillableItemsFee(
    tokenEntityId: string,
    dto: {
      billableItems: Array<{
        id: string;
        chargeAmount: number;
        units: number;
        classification: number;
        [key: string]: unknown;
      }>;
      serviceEntityId: string;
      orderedEntityId: string;
    },
  ) {
    if (tokenEntityId !== dto.orderedEntityId) throw new ForbiddenException();

    const serviceEntity = await this.prisma.entity.findUnique({ where: { Id: dto.serviceEntityId } });
    if (!serviceEntity) throw notFound('Entity not found');

    const fees =
      dto.orderedEntityId === dto.serviceEntityId
        ? Number(serviceEntity.InternalPracticeFees)
        : Number(serviceEntity.Fees);
    const supplyFees = Number(serviceEntity.SupplyFees);
    const minFees = Math.min(Number(serviceEntity.InternalPracticeFees), Math.min(supplyFees, Number(serviceEntity.Fees)));
    const capacity = Number(serviceEntity.ServiceChargeCapacity);

    const withFees = dto.billableItems.map((item) => {
      const chargeAmount = Number(item.chargeAmount);
      const units = Number(item.units) || 1;
      const feeRate = item.classification === CLASSIFICATION_SERVICE ? fees / 100 : supplyFees / 100;
      const feeAmount = chargeAmount * units * feeRate;
      return {
        item: { ...item, chargeAmount, units },
        originalFeeRate: feeRate,
        originalFeeAmount: feeAmount,
        adjustedFeeAmount: feeAmount,
        adjustedFeeRate: feeRate,
        billableItemHistoryId: null as string | null,
      };
    });

    const ids = withFees.map((x) => x.item.id);
    const histories = await this.prisma.billableItemsHistory.findMany({
      where: { BillableItemId: { in: ids }, IsCurrent: true },
      select: { Id: true, BillableItemId: true },
    });
    const historyByItem = new Map(histories.map((h) => [h.BillableItemId, h.Id]));
    for (const row of withFees) {
      row.billableItemHistoryId = historyByItem.get(row.item.id) ?? null;
    }

    const totalFee = withFees.reduce((s, x) => s + x.originalFeeAmount, 0);
    if (totalFee > capacity && totalFee > 0) {
      const overage = totalFee - capacity;
      for (const row of withFees) {
        const overageShare = (row.originalFeeAmount / totalFee) * overage;
        let adjustedFeeAmount = row.originalFeeAmount - overageShare;
        let adjustedFeeRate = adjustedFeeAmount / (row.item.chargeAmount * row.item.units);
        adjustedFeeRate = Math.max(adjustedFeeRate, minFees / 100);
        adjustedFeeAmount = row.item.chargeAmount * row.item.units * adjustedFeeRate;
        row.adjustedFeeAmount = adjustedFeeAmount;
        row.adjustedFeeRate = adjustedFeeRate;
      }
    }

    return withFees;
  }

  /**
   * Thin port of UpdateOrderOrderingProviderAsync for cancel/recall.
   * Moustafa: Stripe refund/cancel + email/SMS deferred — see gaps G-ORD-07.
   */
  async updateOrderOrderingProvider(
    tokenEntityId: string,
    orderId: string,
    dto: { status: number; cancelationResone?: string; pinCode?: string },
  ) {
    const order = await this.prisma.orders.findFirst({
      where: { Id: orderId, OrderedEntityId: tokenEntityId },
      include: { Services: { select: { EntityId: true } } },
    });
    if (!order) throw new ForbiddenException();

    const allowed = new Set([
      ORDER_STATUS_RECALLED,
      ORDER_STATUS_CANCELLED,
      4, // CancelledByOrderingProvider
      6, // CancelledHoldByOrderProvider
      2, // Denied
      3, // PendingPayment
    ]);
    if (!allowed.has(dto.status)) {
      throw badRequest('Unsupported status transition on Nest thin path.');
    }

    // Pin-gated transitions (Denied / PendingPayment) not fully ported yet.
    if ((dto.status === 2 || dto.status === 3) && !dto.pinCode) {
      throw badRequest('Pin code required for this status (full pin check deferred — G-ORD-07).');
    }

    await this.prisma.orders.update({
      where: { Id: orderId },
      data: {
        Status: dto.status,
        CancelationResone: dto.cancelationResone ?? order.CancelationResone,
        UpdatedAt: new Date(),
      },
    });

    if (dto.status === ORDER_STATUS_RECALLED) {
      const serviceEntityId = order.Services.EntityId;
      const inProgress = await this.prisma.orders.count({
        where: {
          Services: { EntityId: serviceEntityId },
          Status: { in: [ORDER_STATUS_ORDERED, 9] },
        },
      });
      const entity = await this.prisma.entity.findUnique({ where: { Id: serviceEntityId } });
      if (entity && inProgress < entity.MaxOrdersQuantity) {
        await this.prisma.entity.update({
          where: { Id: serviceEntityId },
          data: { IsMaxOrdersExceeded: false },
        });
      }
    }

    return { status: 'Success', message: 'Order updated successfully.' };
  }

  /**
   * Thin port of UpdateOrder (rendering) — status + optional scheduledDate only.
   * Moustafa: result-file upload, location selection, Stripe refunds, emails — G-ORD-06.
   */
  async updateOrderRendering(
    tokenEntityId: string,
    orderId: string,
    dto: { status?: number; scheduledDate?: string | null; cancelationResone?: string },
    userId: string,
  ) {
    const order = await this.prisma.orders.findFirst({
      where: { Id: orderId, Services: { EntityId: tokenEntityId } },
    });
    if (!order) throw new ForbiddenException();

    const data: Prisma.OrdersUpdateInput = { UpdatedAt: new Date() };
    if (dto.status != null) {
      data.Status = dto.status;
      if (dto.status === ORDER_STATUS_CANCELLED) {
        data.CancelledBy = userId;
        data.ScheduledDate = null;
      }
    }
    if (dto.scheduledDate !== undefined) {
      data.ScheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : null;
      if (dto.scheduledDate) data.Status = 9; // Scheduled
    }
    if (dto.cancelationResone != null) data.CancelationResone = dto.cancelationResone;

    await this.prisma.orders.update({ where: { Id: orderId }, data });
    return { status: 'Success', message: 'Order updated successfully.' };
  }

  /**
   * Thin port of CreateOrderAsync — core row + billables + locations + docs.
   * Moustafa: RSA encrypt, OrderSummary/attachment upload, Stripe signature, emails/SMS,
   * MD5 patient phone — G-ORD-05 / G-ORD-01 / G-FILE-01 / G-PAY-01.
   * Returns order Guid string (ASP.NET Ok(guid)).
   */
  async createOrder(tokenEntityId: string, userId: string, serviceId: string, raw: Record<string, unknown>) {
    const orderedEntityId = str(raw.orderedEntityId);
    if (!orderedEntityId || orderedEntityId !== tokenEntityId) throw new ForbiddenException();

    const orderType = num(raw.orderType) ?? ORDER_TYPE_INTERNAL;
    const assignedProviderId = str(raw.assignedProviderId) || null;
    const billableItems = Array.isArray(raw.billableItems) ? (raw.billableItems as Record<string, unknown>[]) : [];
    if (!billableItems.length) throw badRequest('Billable items are required.');

    const service = await this.prisma.services.findFirst({
      where: {
        Id: serviceId,
        IsDeleted: false,
        OR: [{ InternalOnly: false }, { EntityId: tokenEntityId }],
      },
    });
    if (!service) throw notFound('Service not found');

    const serviceEntity = await this.prisma.entity.findFirst({
      where: { Id: service.EntityId, IsHidden: false },
    });
    const orderedEntity = await this.prisma.entity.findFirst({
      where: { Id: orderedEntityId, IsHidden: false },
    });
    if (!serviceEntity || !orderedEntity) throw notFound('Entity not found');

    if (orderType === ORDER_TYPE_EXTERNAL && orderedEntityId !== service.EntityId) {
      throw badRequest('External order option is not valid for this service.');
    }
    if (orderType === ORDER_TYPE_INTERNAL) {
      if (!assignedProviderId) throw badRequest('Assigned provider is required.');
      const provider = await this.prisma.entityUsers.findFirst({
        where: {
          EntityId: orderedEntityId,
          ApplicationUserId: assignedProviderId,
          IsProvider: true,
          IsDeleted: false,
        },
      });
      if (!provider) throw badRequest('Assigned user is not a provider for this practice.');
    }

    if (assignedProviderId === userId) {
      const pinCode = str(raw.pinCode);
      if (!pinCode) throw badRequest('Pin code is required.');
      const user = await this.prisma.users.findUnique({ where: { Id: userId }, select: { PinCode: true } });
      if (!user?.PinCode) throw badRequest('No pin code.');
      if (this.passwordHasher.verifyHashedPassword(user.PinCode, pinCode) === PasswordVerificationResult.Failed) {
        throw badRequest('Invalid pin code.');
      }
    }

    const feeRows = await this.calculateBillableItemsFee(tokenEntityId, {
      billableItems: billableItems.map((bi) => ({
        id: String(bi.id),
        chargeAmount: Number(bi.chargeAmount),
        units: Number(bi.units) || 1,
        classification: Number(bi.classification) || CLASSIFICATION_SERVICE,
        ...bi,
      })),
      serviceEntityId: service.EntityId,
      orderedEntityId,
    });
    for (const row of feeRows) {
      if (!row.billableItemHistoryId) throw badRequest(`No current billable history for item ${row.item.id}.`);
    }

    const internal = tokenEntityId === service.EntityId;
    const orderFee = internal ? Number(serviceEntity.InternalPracticeFees) : Number(serviceEntity.Fees);
    const supplyFee = Number(serviceEntity.SupplyFees);
    const capacity = Number(serviceEntity.ServiceChargeCapacity);

    const tzSetting = await this.prisma.entitySettings.findFirst({
      where: { EntityId: service.EntityId, Key: SETTING_TZ },
      select: { Value: true },
    });

    const selfOrExternal =
      (assignedProviderId === userId && orderType === ORDER_TYPE_INTERNAL) || orderType === ORDER_TYPE_EXTERNAL;
    const status = selfOrExternal ? ORDER_STATUS_PENDING_PAYMENT : ORDER_STATUS_PENDING_PROVIDER;
    const now = new Date();
    const orderId = randomUUID();

    const patientDobRaw = str(raw.patientDOB) ?? str(raw.patientDob);
    const patientDob = patientDobRaw ? formatDob(patientDobRaw) : null;

    const created = await this.prisma.$transaction(async (tx) => {
      const tracking = await tx.ordersTrackingNumber.create({
        data: {
          Id: randomUUID(),
          Name: 'Generated Order Tracking',
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      const maxCounter = await tx.orders.aggregate({ _max: { OrderTrackingNumberCounter: true } });
      const counter = (maxCounter._max.OrderTrackingNumberCounter ?? 0) + 1;

      let signedAt: Date | null = null;
      let providerApproval: number | null = null;
      if (orderType === ORDER_TYPE_EXTERNAL) {
        providerApproval = PROVIDER_APPROVAL_APPROVED;
        signedAt = raw.existingOrderDate ? new Date(String(raw.existingOrderDate)) : now;
      } else if (assignedProviderId === userId) {
        providerApproval = PROVIDER_APPROVAL_APPROVED;
        signedAt = now;
      }

      await tx.orders.create({
        data: {
          Id: orderId,
          Status: status,
          OrderTrackingNumber: tracking.OrderTrackingNumberId,
          OrderTrackingNumberCounter: counter,
          Charge: 0,
          ServiceCharge: 0,
          ServiceType: service.ServiceType,
          OrderType: orderType,
          ExistingOrderDate: raw.existingOrderDate ? new Date(String(raw.existingOrderDate)) : null,
          ExistingOrderReferenceIdentifier: str(raw.existingOrderReferenceIdentifier) || null,
          OrderFee: orderFee,
          SupplyFee: supplyFee,
          OrderChargeCapacity: capacity,
          OrderedBy: userId,
          OrderedDate: now,
          OrderProviderTimeZone: str(raw.orderProviderTimeZone) || null,
          RenderProviderTimeZone: tzSetting?.Value ?? null,
          ServiceId: serviceId,
          OrderedEntityId: orderedEntityId,
          AssignedProviderId: assignedProviderId,
          // Moustafa: plaintext until RSA encrypt (G-ORD-01)
          PatientName: str(raw.patientName) ?? '',
          PatientDOB: patientDob,
          PatientEmail: str(raw.patientEmail) || null,
          PatientPhoneNumber: str(raw.patientPhoneNumber) || null,
          ConfidentialInternalNote: str(raw.confidentialInternalNote) || null,
          OrderNote: str(raw.orderNote) || null,
          HasNonRefundableItems: feeRows.some((r) => Number(r.item.classification) === CLASSIFICATION_NON_REFUNDABLE),
          ProviderApprovalStatus: providerApproval,
          SignedAt: signedAt,
          CreatedAt: now,
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      let charge = 0;
      let serviceCharge = 0;
      for (const row of feeRows) {
        const units = row.item.units;
        const unitPrice = row.item.chargeAmount;
        const unitCharged = unitPrice * (1 + row.adjustedFeeRate);
        charge += unitCharged * units;
        serviceCharge += unitPrice * units;
        await tx.orderBillableItems.create({
          data: {
            Id: randomUUID(),
            OrderId: orderId,
            BillableItemHistoryId: row.billableItemHistoryId!,
            BillableItemUnits: units,
            UnitPrice: round2(unitPrice),
            UnitCharged: round2(unitCharged),
            CreatedAt: now,
            IsDeleted: false,
            IsEnabled: true,
          },
        });
      }

      await tx.orders.update({
        where: { Id: orderId },
        data: { Charge: round2(charge), ServiceCharge: round2(serviceCharge) },
      });

      const locs = Array.isArray(raw.renderedLocations) ? (raw.renderedLocations as Record<string, unknown>[]) : [];
      const seen = new Set<string>();
      for (const loc of locs) {
        const locationId = str(loc.locationId);
        if (!locationId || seen.has(locationId)) continue;
        seen.add(locationId);
        const preferred = locs
          .filter((l) => str(l.locationId) === locationId)
          .some((l) => l.isPreferredByPatient === true || l.isPreferredByPatient === 'true');
        await tx.orderRenderedLocations.create({
          data: {
            Id: randomUUID(),
            OrderId: orderId,
            LocationId: locationId,
            IsSelectedByRenderProvider: false,
            IsPreferredByPatient: preferred,
            CreatedAt: now,
            IsDeleted: false,
            IsEnabled: true,
          },
        });
      }

      const docIds = Array.isArray(raw.orderDocumentsIds)
        ? (raw.orderDocumentsIds as unknown[]).map((d) => String(d)).filter(Boolean)
        : [];
      for (const entityDocumentId of docIds) {
        await tx.orderDocuments.create({
          data: {
            Id: randomUUID(),
            OrderId: orderId,
            EntityDocumentId: entityDocumentId,
            CreatedAt: now,
            IsDeleted: false,
            IsEnabled: true,
          },
        });
      }

      return orderId;
    });

    return created;
  }

  /**
   * Thin port of GetProvidersForInternalEmrOrders.
   * Moustafa: teams provider filter — G-ENT-05 / G-ORD-14.
   */
  async getExternalProviders(entityId: string) {
    const [internalRows, externalRows] = await Promise.all([
      this.prisma.entityUsers.findMany({
        where: { EntityId: entityId, IsProvider: true, IsEnabled: true, IsCertified: true },
        include: { Users: true },
      }),
      this.prisma.externalProviders.findMany({
        where: { EntityId: entityId, IsEnabled: true, IsDeleted: false },
      }),
    ]);

    const userIds = internalRows.map((r) => r.ApplicationUserId).filter((id): id is string => !!id);
    const idents = await this.prisma.identifications.findMany({
      where: { ApplicationUserId: { in: userIds } },
      include: { NPIs: { take: 1 } },
    });
    const npiByUser = new Map(idents.map((i) => [i.ApplicationUserId, i.NPIs[0]?.NpiNumber ?? null]));

    const internal = internalRows
      .filter((r) => r.ApplicationUserId && r.Users)
      .map((r) => ({
        id: r.ApplicationUserId!,
        npi: npiByUser.get(r.ApplicationUserId!) ?? null,
        firstName: r.Users!.FirstName,
        middleName: r.Users!.MiddleName,
        lastName: r.Users!.LastName,
        fullName: formatFmL(r.Users!.FirstName, r.Users!.MiddleName, r.Users!.LastName),
        source: 'Internal',
      }));

    const internalNpis = new Set(internal.map((p) => p.npi).filter(Boolean));
    const external = externalRows
      .filter((ep) => !ep.NPI || !internalNpis.has(ep.NPI))
      .map((ep) => ({
        id: ep.Id.toLowerCase(),
        npi: ep.NPI,
        firstName: ep.FirstName,
        middleName: ep.MiddleName,
        lastName: ep.LastName,
        fullName: formatFmL(ep.FirstName, ep.MiddleName, ep.LastName),
        source: 'External',
      }));

    return [...internal, ...external].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /**
   * Thin port of CreateExternalProvider — DB insert only.
   * Moustafa: NPI registry / certified-user duplicate check — G-ORD-14.
   */
  async createExternalProvider(
    tokenEntityId: string,
    dto: { npi: string; firstName: string; lastName: string; middleName?: string },
  ) {
    const dup = await this.prisma.externalProviders.findFirst({
      where: { EntityId: tokenEntityId, NPI: dto.npi },
    });
    if (dup) throw badRequest(`This NPI record already exists: ${dto.npi}`);

    const now = new Date();
    const created = await this.prisma.externalProviders.create({
      data: {
        Id: randomUUID(),
        NPI: dto.npi,
        FirstName: dto.firstName,
        LastName: dto.lastName,
        MiddleName: dto.middleName ?? null,
        EntityId: tokenEntityId,
        CreatedAt: now,
        IsDeleted: false,
        IsEnabled: true,
      },
    });

    return {
      id: created.Id,
      npi: created.NPI,
      firstName: created.FirstName,
      middleName: created.MiddleName,
      lastName: created.LastName,
      fullName: formatFmL(created.FirstName, created.MiddleName, created.LastName),
    };
  }
}

function formatFmL(first?: string | null, middle?: string | null, last?: string | null): string {
  return [first, middle, last].filter((p) => !!p && String(p).trim()).join(' ').trim();
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v);
  return s === '' || s === 'undefined' || s === 'null' ? undefined : s;
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Prefer MM/dd/yyyy when parseable; otherwise store as received. */
function formatDob(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}


function notFound(message: string): NotFoundException {
  return new NotFoundException({ status: 'Error', message });
}

function badRequest(message: string): HttpException {
  return new HttpException({ status: 'Error', message }, HttpStatus.BAD_REQUEST);
}

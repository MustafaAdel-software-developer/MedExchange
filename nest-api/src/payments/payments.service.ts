import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

const LINK_TYPE_PAYMENT = 2;
const PAYMENT_STATUS_UNPAID = 1;
const PAYMENT_STATUS_EXPIRED = 2;
const PAYMENT_STATUS_HOLD = 3;
const PAYMENT_LOG_NOTE_UNPAID = 'Payment link generated but not yet paid';
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const MSG_EMAIL = 1;
const MSG_SMS = 2;
const MSG_BOTH = 3;
const CLASSIFICATION_NON_REFUNDABLE = 3;

/**
 * Thin Payments port — Stripe embedded Checkout when STRIPE_SECRET_KEY set.
 * Moustafa: PaymentLinksProducts table; remaining webhook events + Ordered/emails/SignalR — G-PAY-01 / G-PAY-03.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * CreatePaymentLink — Stripe embedded Checkout Session when STRIPE_SECRET_KEY set; else stub.
   * Returns `{ id, paymentLink }` (Links.Id + frontend checkout URL).
   */
  async createPaymentLink(
    tokenEntityId: string,
    dto: { orderId: string; successUrl?: string; productWithPrice?: { name?: string } },
  ) {
    const order = await this.prisma.orders.findFirst({
      where: { Id: dto.orderId },
      select: { Id: true, OrderedEntityId: true },
    });
    if (!order) throw notFound('Order not found');
    if (order.OrderedEntityId !== tokenEntityId) throw new ForbiddenException();

    const existing = await this.prisma.paymentProcessing.findUnique({
      where: { OrderId: dto.orderId },
      include: { StripeTransactions: { include: { PaymentLinks: true } } },
    });
    if (existing?.StripeTransactions?.PaymentLinks?.PaymentLink) {
      const paymentLink = existing.StripeTransactions.PaymentLinks.PaymentLink;
      return { id: linkIdFromCheckoutUrl(paymentLink) ?? existing.StripeTransactions.PaymentLinks.Id, paymentLink };
    }

    const frontend = (this.config.get<string>('FRONTEND_URL') ?? 'https://localhost:44413').replace(/\/$/, '');
    const now = new Date();
    const linkId = randomUUID();
    const paymentLinkRowId = randomUUID();
    const paymentProcessingId = randomUUID();
    const stripeTxId = randomUUID();
    const checkoutUrl = `${frontend}/checkout?Id=${linkId}`;
    const returnUrl = dto.successUrl?.includes('{CHECKOUT_SESSION_ID}')
      ? dto.successUrl
      : `${frontend}/return?session-id={CHECKOUT_SESSION_ID}`;

    let sessionId = `cs_test_nest_${paymentLinkRowId}`;
    let clientSecret = sessionId;
    let expiresAt = new Date(now.getTime() + LINK_TTL_MS);

    if (this.stripe.enabled) {
      const billables = await this.prisma.orderBillableItems.findMany({
        where: { OrderId: dto.orderId },
        include: { BillableItemsHistory: { select: { ShortDescription: true, Classification: true } } },
      });
      if (!billables.length) throw badRequest('Order has no billable items.');

      const lineItems = billables.map((b) => {
        const name =
          (b.BillableItemsHistory.ShortDescription ?? 'Item') +
          (b.BillableItemsHistory.Classification === CLASSIFICATION_NON_REFUNDABLE
            ? ' (Non-Refundable Supply)'
            : '');
        return {
          name,
          unitAmountCents: Math.max(1, Math.round(Number(b.UnitCharged) * 100)),
          quantity: b.BillableItemUnits,
        };
      });

      const session = await this.stripe.createEmbeddedCheckoutSession({
        lineItems,
        description: dto.productWithPrice?.name ?? 'MedExchange order',
        returnUrl,
      });
      sessionId = session.id;
      clientSecret = session.clientSecret;
      expiresAt = session.expiresAt;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.links.create({
        data: {
          Id: linkId,
          LinkType: LINK_TYPE_PAYMENT,
          TokenOrLink: clientSecret,
          CreatedAt: now,
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      await tx.paymentLinks.create({
        data: {
          Id: paymentLinkRowId,
          PaymentLink: checkoutUrl,
          PaymentLinkId: sessionId,
          PaymentLinkKey: clientSecret,
          ExpiresAt: expiresAt,
          Name: dto.productWithPrice?.name ?? null,
          CreatedAt: now,
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      await tx.paymentProcessing.create({
        data: {
          Id: paymentProcessingId,
          Status: PAYMENT_STATUS_UNPAID,
          OrderId: dto.orderId,
          Type: null,
          CreatedAt: now,
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      await tx.stripeTransactions.create({
        data: {
          Id: stripeTxId,
          PaymentLinkId: paymentLinkRowId,
          PaymentProcessingId: paymentProcessingId,
          CreatedAt: now,
          IsDeleted: false,
          IsEnabled: true,
        },
      });

      await tx.paymentProcessingLogs.create({
        data: {
          Id: randomUUID(),
          PaymentProcessingId: paymentProcessingId,
          Status: PAYMENT_STATUS_UNPAID,
          Type: null,
          Notes: PAYMENT_LOG_NOTE_UNPAID,
          CreatedAt: now,
          IsDeleted: false,
          IsEnabled: true,
        },
      });
    });

    return { id: linkId, paymentLink: checkoutUrl };
  }

  /** Anonymous: returns Links.TokenOrLink (Stripe client_secret) for Embedded Checkout. */
  async checkout(linkId: string): Promise<string> {
    const link = await this.prisma.links.findFirst({
      where: { Id: linkId, LinkType: LINK_TYPE_PAYMENT, IsDeleted: false },
      select: { TokenOrLink: true },
    });
    if (!link?.TokenOrLink) throw notFound('Checkout link not found');
    return link.TokenOrLink;
  }

  /**
   * Thin webhook: session completed → Hold + PaymentIntentId; expired → Expired.
   * Moustafa: remaining Stripe event types + order Ordered / emails / SignalR — G-PAY-03.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!this.stripe.enabled) {
      return { received: true, skipped: 'stripe_disabled' };
    }
    if (!signature) throw badRequest('Missing stripe-signature');

    let event;
    try {
      event = this.stripe.constructEvent(rawBody, signature);
    } catch {
      throw badRequest('Invalid webhook signature');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as { id: string; payment_intent?: string | { id: string } | null };
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      await this.updateProcessingBySessionId(session.id, {
        status: PAYMENT_STATUS_HOLD,
        paymentIntentId,
        notes: 'Payment authorized (hold)',
      });
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object as { id: string };
      await this.updateProcessingBySessionId(session.id, {
        status: PAYMENT_STATUS_EXPIRED,
        paymentIntentId: null,
        notes: 'Checkout session expired',
      });
    }

    return { received: true, type: event.type };
  }

  async getOrderPaymentLinkData(tokenEntityId: string, orderId: string) {
    const order = await this.prisma.orders.findFirst({
      where: { Id: orderId, OrderedEntityId: tokenEntityId },
      include: {
        PaymentProcessing: {
          include: { StripeTransactions: { include: { PaymentLinks: true } } },
        },
      },
    });
    if (!order) throw new ForbiddenException();

    const pl = order.PaymentProcessing?.StripeTransactions?.PaymentLinks;
    if (!pl?.PaymentLink) throw notFound('Payment link not found');

    return {
      patientName: order.PatientName,
      patientEmail: order.PatientEmail,
      patientPhoneNumber: order.PatientPhoneNumber,
      paymentLink: pl.PaymentLink,
      expiresAt: pl.ExpiresAt,
    };
  }

  async sendPaymentLink(
    tokenEntityId: string,
    orderId: string,
    dto: {
      messageOptions: number;
      emailData?: { email: string; userName?: string; isPatient?: boolean };
      smsData?: { toPhoneNumber: string };
    },
  ) {
    const order = await this.prisma.orders.findFirst({
      where: { Id: orderId },
      select: { OrderedEntityId: true },
    });
    if (!order) throw notFound('Order not found');
    if (order.OrderedEntityId !== tokenEntityId) throw new ForbiddenException();

    const processing = await this.prisma.paymentProcessing.findFirst({
      where: { OrderId: orderId, Status: PAYMENT_STATUS_UNPAID },
      include: { StripeTransactions: { include: { PaymentLinks: true } } },
    });
    const paymentLink = processing?.StripeTransactions?.PaymentLinks?.PaymentLink;
    if (!paymentLink) throw notFound('Payment link not found');

    const opts = dto.messageOptions;
    const wantEmail = opts === MSG_EMAIL || opts === MSG_BOTH;
    const wantSms = opts === MSG_SMS || opts === MSG_BOTH;

    if (wantEmail) {
      if (!dto.emailData?.email) throw badRequest('Email data is required.');
      const name = dto.emailData.userName?.trim() || 'there';
      const html = buildPaymentLinkEmailHtml(name, paymentLink, !!dto.emailData.isPatient);
      await this.mail.sendMail({
        to: dto.emailData.email,
        subject: 'Order Payment Link',
        html,
        text: `Hi ${name}, complete payment here: ${paymentLink}`,
      });
    }

    if (wantSms) {
      if (!dto.smsData?.toPhoneNumber) throw badRequest('SMS data is required.');
      // Moustafa: Twilio SendSms + NotificationAuditLog — G-PAY-02
    }

    return { status: 'Success', message: 'Payment link sent successfully.' };
  }

  private async updateProcessingBySessionId(
    sessionId: string,
    update: { status: number; paymentIntentId: string | null; notes: string },
  ) {
    const pl = await this.prisma.paymentLinks.findFirst({
      where: { PaymentLinkId: sessionId },
      include: { StripeTransactions: true },
    });
    if (!pl?.StripeTransactions) return;

    await this.prisma.stripeTransactions.update({
      where: { Id: pl.StripeTransactions.Id },
      data: {
        PaymentIntentId: update.paymentIntentId ?? pl.StripeTransactions.PaymentIntentId,
        UpdatedAt: new Date(),
      },
    });
    await this.prisma.paymentProcessing.update({
      where: { Id: pl.StripeTransactions.PaymentProcessingId },
      data: { Status: update.status, UpdatedAt: new Date() },
    });
    await this.prisma.paymentProcessingLogs.create({
      data: {
        Id: randomUUID(),
        PaymentProcessingId: pl.StripeTransactions.PaymentProcessingId,
        Status: update.status,
        Type: null,
        Notes: update.notes,
        CreatedAt: new Date(),
        IsDeleted: false,
        IsEnabled: true,
      },
    });
  }
}

function buildPaymentLinkEmailHtml(userName: string, paymentLink: string, isPatient: boolean): string {
  const intro = isPatient
    ? `Hi ${escapeHtml(userName)}, your MedExchange order is ready for payment.`
    : `Hi ${escapeHtml(userName)}, a MedExchange order payment link is ready.`;
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.4">
<p>${intro}</p>
<p><a href="${escapeHtml(paymentLink)}">Complete payment</a></p>
<p style="word-break:break-all">${escapeHtml(paymentLink)}</p>
<p>Service will not be scheduled until payment is completed.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function linkIdFromCheckoutUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('Id');
  } catch {
    const m = url.match(/[?&]Id=([^&]+)/i);
    return m?.[1] ?? null;
  }
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ status: 'Error', message });
}

function badRequest(message: string): HttpException {
  return new HttpException({ status: 'Error', message }, HttpStatus.BAD_REQUEST);
}

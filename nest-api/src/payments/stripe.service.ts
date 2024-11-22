import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export type CheckoutLineItem = { name: string; unitAmountCents: number; quantity: number };

/**
 * Thin Stripe SDK wrapper.
 * Moustafa: Product/Price table sync, capture/refund, full 9 webhook handlers — G-PAY-01 / G-PAY-03.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
    if (!key) this.logger.warn('STRIPE_SECRET_KEY unset — CreatePaymentLink uses stub session ids');
  }

  get enabled(): boolean {
    return this.stripe != null;
  }

  async createEmbeddedCheckoutSession(opts: {
    lineItems: CheckoutLineItem[];
    description: string;
    returnUrl: string;
  }): Promise<{ id: string; clientSecret: string; expiresAt: Date }> {
    if (!this.stripe) throw new Error('Stripe is not configured');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded',
      redirect_on_completion: 'if_required',
      return_url: opts.returnUrl,
      payment_intent_data: {
        description: opts.description,
        capture_method: 'manual',
      },
      line_items: opts.lineItems.map((li) => ({
        quantity: li.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: li.unitAmountCents,
          product_data: { name: li.name },
        },
      })),
    });

    if (!session.client_secret) throw new Error('Stripe session missing client_secret');
    return {
      id: session.id,
      clientSecret: session.client_secret,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.stripe) throw new Error('Stripe is not configured');
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET unset');
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }
}

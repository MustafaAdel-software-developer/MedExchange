import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Minimal SMTP mailer. If SMTP_HOST is unset, logs the message (dev) so confirm/reset
 * flows still work when you read VerificationCode from DB / logs.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendMail(opts: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn(`SMTP_HOST unset — email to ${opts.to} subject="${opts.subject}" (logged only):\n${opts.text ?? opts.html}`);
      return true;
    }

    const port = Number(this.config.get('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const from = this.config.get<string>('SMTP_FROM') ?? user ?? 'noreply@medexchange.local';

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: this.config.get('SMTP_SECURE') === 'true',
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
    return true;
  }
}

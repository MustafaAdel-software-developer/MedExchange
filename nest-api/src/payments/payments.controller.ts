import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';

class ProductWithPriceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  amount?: number;
}

class CreatePaymentLinkDto {
  @IsUUID()
  orderId!: string;

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductWithPriceDto)
  @IsObject()
  productWithPrice?: ProductWithPriceDto;
}

class SendEmailDataDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @IsBoolean()
  isPatient?: boolean;
}

class SendSmsDataDto {
  @IsString()
  toPhoneNumber!: string;
}

class SendPaymentLinkDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SendEmailDataDto)
  emailData?: SendEmailDataDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SendSmsDataDto)
  smsData?: SendSmsDataDto;

  @Type(() => Number)
  @IsNumber()
  messageOptions!: number;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('CreatePaymentLink')
  @UseGuards(JwtAuthGuard)
  createPaymentLink(@Req() req: AuthenticatedRequest, @Body() dto: CreatePaymentLinkDto) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.payments.createPaymentLink(tokenEntityId, dto);
  }

  @Post('SendPaymentLink/:orderId')
  @UseGuards(JwtAuthGuard)
  sendPaymentLink(
    @Req() req: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Body() dto: SendPaymentLinkDto,
  ) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.payments.sendPaymentLink(tokenEntityId, orderId, dto);
  }

  /** Anonymous — EmbeddedStripeCheckout fetches client_secret by Links.Id. */
  @Get('checkout/:id')
  checkout(@Param('id') id: string) {
    return this.payments.checkout(id);
  }

  @Post('Webhook')
  webhook(
    @Req() req: { rawBody?: Buffer; body?: unknown },
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const raw = req.rawBody;
    if (!raw) {
      return this.payments.handleWebhook(Buffer.from(JSON.stringify(req.body ?? {})), signature);
    }
    return this.payments.handleWebhook(raw, signature);
  }
}

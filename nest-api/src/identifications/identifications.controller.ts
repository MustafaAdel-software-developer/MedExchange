import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateEntityWithIdentificationDto } from './dto/create-entity-with-identification.dto';
import { IdentificationsService } from './identifications.service';
import { unflattenFormBody } from './unflatten-form';

@Controller('identifications')
export class IdentificationsController {
  constructor(private readonly identifications: IdentificationsService) {}

  /**
   * Mirrors POST Identifications/CreateEntityWithIdentification ([FromForm] multipart).
   * Also accepts JSON with the same nested camelCase shape.
   */
  @Post('CreateEntityWithIdentification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(AnyFilesInterceptor())
  async createEntityWithIdentification(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const raw =
      body?.entity && typeof body.entity === 'object' ? body : unflattenFormBody(body ?? {});
    const dto = plainToInstance(CreateEntityWithIdentificationDto, raw);
    if (!dto.applicationUserId) dto.applicationUserId = req.currentUser.Id;

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length) {
      throw new BadRequestException({
        status: 'Error',
        message: errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; '),
      });
    }

    return this.identifications.createEntityWithIdentification(dto);
  }
}

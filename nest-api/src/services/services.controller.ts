import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthorizeEntityDataGuard } from '../auth/guards/authorize-entity-data.guard';
import { ServicesService } from './services.service';

class SaveServiceDto {
  @IsUUID()
  entityId!: string;

  @IsUUID()
  serviceId!: string;
}

@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get('GetServiceWizard/:serviceId')
  @UseGuards(JwtAuthGuard)
  getServiceWizard(@Param('serviceId') serviceId: string) {
    return this.services.getServiceWizard(serviceId);
  }

  @Get('FindServices')
  @UseGuards(JwtAuthGuard)
  findServices(@Req() req: AuthenticatedRequest, @Query() query: Record<string, string | string[]>) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.services.findServices(tokenEntityId, query);
  }

  /** Anonymous — marketing / public landing catalog. */
  @Get('LandingPageServices')
  landingPageServices(@Query() query: Record<string, string | string[]>) {
    return this.services.landingPageServices(query);
  }

  @Get('GetEntitySavedServices/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  getEntitySavedServices(
    @Req() req: AuthenticatedRequest,
    @Param('entityId') entityId: string,
    @Query() query: Record<string, string | string[]>,
  ) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.services.getEntitySavedServices(tokenEntityId, entityId, query);
  }

  @Get('GetServiceLocations/:serviceId')
  @UseGuards(JwtAuthGuard)
  getServiceLocations(@Param('serviceId') serviceId: string) {
    return this.services.getServiceLocations(serviceId);
  }

  @Post('SaveService')
  @UseGuards(JwtAuthGuard)
  saveService(@Req() req: AuthenticatedRequest, @Body() dto: SaveServiceDto) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.services.saveService(tokenEntityId, dto);
  }

  @Delete('UnSaveService/:entityId/:serviceId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  unSaveService(
    @Req() req: AuthenticatedRequest,
    @Param('entityId') entityId: string,
    @Param('serviceId') serviceId: string,
  ) {
    const tokenEntityId = req.user?.EntityId;
    if (typeof tokenEntityId !== 'string') throw new ForbiddenException();
    return this.services.unSaveService(tokenEntityId, entityId, serviceId);
  }
}

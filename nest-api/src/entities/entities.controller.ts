import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthorizeAdminEntityDataGuard } from '../auth/guards/authorize-admin-entity-data.guard';
import { AuthorizeEntityDataGuard } from '../auth/guards/authorize-entity-data.guard';
import { AuthorizeUserDataGuard } from '../auth/guards/authorize-user-data.guard';
import { AppRoles } from '../auth/roles.enum';
import { EntitiesService } from './entities.service';

export class SetDefaultPracticeDto {
  /** ChooseEntity sends no body; default true matches the "make default" checkbox intent. */
  @IsOptional()
  @IsBoolean()
  isDefaultPractice?: boolean;
}

export class InvitationItemDto {
  @IsEmail()
  staffEmail!: string;

  @IsEnum(AppRoles)
  @Type(() => Number)
  staffRole!: AppRoles;

  @IsOptional()
  @IsBoolean()
  isProvider?: boolean;
}

export class InviteStaffDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvitationItemDto)
  invitations!: InvitationItemDto[];
}

export class GeneralSettingsDto {
  @IsBoolean()
  isIncludeOrderBarcodeOnCheckInPass!: boolean;

  @IsNotEmpty()
  @IsString()
  defaultTimeZone!: string;
}

export class EntityOrdersSettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxOrdersQuantity!: number;
}

@Controller()
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  /** Mirrors GET Users/GetUserEntitiesById/{userId}. */
  @Get('users/GetUserEntitiesById/:userId')
  @UseGuards(JwtAuthGuard, AuthorizeUserDataGuard)
  getUserEntitiesById(@Param('userId') userId: string) {
    return this.entities.getUserEntitiesById(userId);
  }

  /** Mirrors GET Entities/GetEntityStaff/{entityId}. Must be registered before entities/:entityId. */
  @Get('entities/GetEntityStaff/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeAdminEntityDataGuard)
  getEntityStaff(@Param('entityId') entityId: string) {
    return this.entities.getEntityStaff(entityId);
  }

  @Post('entities/InviteStaff/:entityId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AuthorizeAdminEntityDataGuard)
  inviteStaff(@Req() req: AuthenticatedRequest, @Param('entityId') entityId: string, @Body() dto: InviteStaffDto) {
    const invitedBy = `${req.currentUser.FirstName ?? ''} ${req.currentUser.LastName ?? ''}`.trim() || req.currentUser.Email || '';
    return this.entities.inviteStaff(entityId, invitedBy, dto.invitations);
  }

  @Get('entities/GetPracticeCheckList/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  getPracticeCheckList(@Req() req: AuthenticatedRequest, @Param('entityId') entityId: string) {
    return this.entities.getPracticeCheckList(entityId, req.currentUser.Id);
  }

  @Get('entities/GetEntityGeneralSettings/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeAdminEntityDataGuard)
  getEntityGeneralSettings(@Param('entityId') entityId: string) {
    return this.entities.getGeneralSettings(entityId);
  }

  @Put('entities/ChangeGeneralSettings/:entityId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AuthorizeAdminEntityDataGuard)
  changeGeneralSettings(@Param('entityId') entityId: string, @Body() dto: GeneralSettingsDto) {
    return this.entities.changeGeneralSettings(entityId, dto);
  }

  @Put('entities/SetOrdersSettings/:entityId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AuthorizeAdminEntityDataGuard)
  setOrdersSettings(@Param('entityId') entityId: string, @Body() dto: EntityOrdersSettingsDto) {
    return this.entities.setOrdersSettings(entityId, dto.maxOrdersQuantity);
  }

  @Get('entities/GetEntityProviders/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  getEntityProviders(@Param('entityId') entityId: string) {
    return this.entities.getEntityProviders(entityId);
  }

  @Get('entities/GetEntityServices/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeAdminEntityDataGuard)
  getEntityServices(@Param('entityId') entityId: string, @Req() req: AuthenticatedRequest) {
    const filters = typeof req.query?.Filters === 'string' ? req.query.Filters : undefined;
    return this.entities.getEntityServices(entityId, filters);
  }

  @Get('entities/GetAllEntitiesToBeJoined/:userId')
  @UseGuards(JwtAuthGuard, AuthorizeUserDataGuard)
  getAllEntitiesToBeJoined(@Param('userId') userId: string) {
    return this.entities.getAllEntitiesToBeJoined(userId);
  }

  @Get('entities/GetEntityTechnicalData/:serviceId')
  @UseGuards(JwtAuthGuard)
  getEntityTechnicalData(@Param('serviceId') serviceId: string) {
    return this.entities.getEntityTechnicalDataFromServiceId(serviceId);
  }

  @Get('invitations/GetInvitationData/:id')
  getInvitationData(@Param('id') id: string) {
    return this.entities.getInvitationData(id);
  }

  @Post('joining-requests/AddJoinRequest')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  addJoinRequest(
    @Req() req: AuthenticatedRequest,
    @Body() dto: { applicationUserId: string; entityId: string },
  ) {
    return this.entities.addJoinRequest(req.currentUser.Id, dto.applicationUserId, dto.entityId);
  }

  /** Mirrors GET Entities/{entityId}. */
  @Get('entities/:entityId')
  @UseGuards(JwtAuthGuard, AuthorizeEntityDataGuard)
  async getEntityById(@Req() req: AuthenticatedRequest, @Param('entityId') entityId: string) {
    try {
      return await this.entities.getEntityById(entityId, req.currentUser.Id);
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw e;
    }
  }

  /**
   * Mirrors PUT EntityUserPreferences/SetDefaultPractice/{entityId}.
   * Moustafa: .NET AuthorizeEntityUser requires JWT EntityId === route id, which races with
   * ChooseEntity (SetDefaultPractice runs before setToken persists). Nest allows any enabled
   * EntityUsers membership for the caller instead.
   */
  @Put('entity-user-preferences/SetDefaultPractice/:entityId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async setDefaultPractice(
    @Req() req: AuthenticatedRequest,
    @Param('entityId') entityId: string,
    @Body() dto: SetDefaultPracticeDto,
  ) {
    const isDefault = dto?.isDefaultPractice !== false;
    return this.entities.setDefaultPractice(req.currentUser.Id, entityId, isDefault);
  }
}

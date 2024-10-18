import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EntityType } from '../../auth/auth-enums';

export class AddressDto {
  @IsNotEmpty()
  @IsString()
  lineOne!: string;

  @IsOptional()
  @IsString()
  lineTwo?: string;

  @IsNotEmpty()
  @IsString()
  city!: string;

  @IsNotEmpty()
  @IsString()
  state!: string;

  @IsNotEmpty()
  @Matches(/^[0-9]{5}$/, { message: 'ZipCode must be 5 digits.' })
  zipCode!: string;
}

export class EntityCreateDto {
  @MinLength(3)
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  doingBusinessAsName?: string;

  @IsEnum(EntityType)
  @Type(() => Number)
  entityType!: EntityType;

  @IsNotEmpty()
  @IsString()
  technicalSupportPhoneNumber!: string;

  @IsEmail()
  technicalSupportEmail!: string;

  @IsOptional()
  @IsString()
  technicalSupportName?: string;

  @IsNotEmpty()
  @IsString()
  defaultTimeZone!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class IdentificationCreateDto {
  @IsOptional()
  @IsString()
  taxID?: string;
}

export class CreateEntityWithIdentificationDto {
  @IsUUID()
  applicationUserId!: string;

  @ValidateNested()
  @Type(() => EntityCreateDto)
  entity!: EntityCreateDto;

  @ValidateNested()
  @Type(() => AddressDto)
  entityPrincipalAddress!: AddressDto;

  @ValidateIf((o) => o.entity?.entityType === EntityType.Group)
  @ValidateNested()
  @Type(() => AddressDto)
  registeredAgentAddress?: AddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => IdentificationCreateDto)
  identification?: IdentificationCreateDto;
}

import { BadRequestException, Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Put('GetLocationsByIds')
  @UseGuards(JwtAuthGuard)
  getLocationsByIds(@Body() ids: string[]) {
    return this.locations.getLocationsByIds(normalizeIds(ids));
  }

  @Put('GetServiceEnabledLocations/:serviceId')
  @UseGuards(JwtAuthGuard)
  getServiceEnabledLocations(@Param('serviceId') serviceId: string, @Body() ids: string[]) {
    return this.locations.getServiceEnabledLocations(serviceId, normalizeIds(ids));
  }

  @Put('GetAllServiceLocations/:serviceId')
  @UseGuards(JwtAuthGuard)
  getAllServiceLocations(@Param('serviceId') serviceId: string, @Body() ids: string[]) {
    return this.locations.getAllServiceLocations(serviceId, normalizeIds(ids));
  }
}

function normalizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw new BadRequestException({ status: 'Error', message: 'Expected id array' });
  return ids.map((id) => String(id).replace(/"/g, '').trim()).filter(Boolean);
}

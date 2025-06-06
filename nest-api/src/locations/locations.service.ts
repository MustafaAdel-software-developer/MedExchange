import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Thin Locations port for order cart.
 * Moustafa: capabilities matching + full location CRUD — G-LOC-01.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLocationsByIds(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.loadLocationDetails(ids);
    if (rows.length !== ids.length) throw notFound('Location not found');
    return rows;
  }

  async getServiceEnabledLocations(serviceId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.loadLocationDetails(ids);
    if (!rows.length) throw notFound('Location not found');

    const serviceLocs = await this.prisma.serviceLocations.findMany({
      where: { ServiceId: serviceId, LocationId: { in: rows.map((r) => r.id) } },
      select: { LocationId: true, IsEnabled: true },
    });
    const enabledByLoc = new Map(serviceLocs.map((sl) => [sl.LocationId, sl.IsEnabled]));

    // Keep location if no ServiceLocations row OR row IsEnabled, and location itself enabled.
    return rows.filter((l) => {
      if (!l.isEnabled) return false;
      if (!enabledByLoc.has(l.id)) return true;
      return enabledByLoc.get(l.id) === true;
    });
  }

  async getAllServiceLocations(serviceId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.loadLocationDetails(ids);
    if (!rows.length) throw notFound('Location not found');

    const serviceLocs = await this.prisma.serviceLocations.findMany({
      where: { ServiceId: serviceId, LocationId: { in: rows.map((r) => r.id) } },
      select: { LocationId: true, IsEnabled: true },
    });
    const enabledByLoc = new Map(serviceLocs.map((sl) => [sl.LocationId, sl.IsEnabled]));

    return rows.map((l) => {
      const slEnabled = enabledByLoc.get(l.id);
      return {
        ...l,
        isEnabled: slEnabled === undefined ? l.isEnabled : l.isEnabled && slEnabled,
      };
    });
  }

  private async loadLocationDetails(ids: string[]) {
    const locs = await this.prisma.locations.findMany({
      where: { Id: { in: ids } },
      include: { Addresses: true },
    });
    return locs.map((l) => ({
      id: l.Id,
      name: l.Name,
      isEnabled: l.IsEnabled,
      address: {
        lineOne: l.Addresses.LineOne,
        lineTwo: l.Addresses.LineTwo,
        city: l.Addresses.City,
        state: l.Addresses.State,
        zipCode: l.Addresses.ZipCode,
      },
      // Moustafa: GetServiceMatchingCapabilities deferred — G-LOC-01
      capabilities: [] as unknown[],
    }));
  }
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ status: 'Error', message });
}

import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Matches ClientApp `/States` and `/States/GetStates` (anonymous on .NET). */
  @Get(['states', 'states/GetStates'])
  getStates() {
    return this.catalog.getStates();
  }

  @Get('categories/GetCategories')
  @UseGuards(JwtAuthGuard)
  getCategories() {
    return this.catalog.getCategories();
  }

  @Get('taxonomies/GetTaxonomies')
  @UseGuards(JwtAuthGuard)
  getTaxonomies() {
    return this.catalog.getTaxonomies();
  }
}

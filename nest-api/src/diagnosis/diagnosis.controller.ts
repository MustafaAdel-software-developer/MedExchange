import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DiagnosisService } from './diagnosis.service';

@Controller('diagnosis')
export class DiagnosisController {
  constructor(private readonly diagnosis: DiagnosisService) {}

  @Get('GetDiagnosis')
  @UseGuards(JwtAuthGuard)
  getDiagnosis(@Query('Filters') filters?: string): Promise<import('./diagnosis.service').DiagnosisNode[]> {
    return this.diagnosis.getDiagnosis(filters ?? '');
  }
}

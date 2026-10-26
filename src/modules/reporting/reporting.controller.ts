import { Controller, Get, Inject, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RolesGuard } from '../identity/roles.guard.js';
import { Roles, CurrentUser } from '../identity/auth.decorator.js';
import type { AuthenticatedUser } from '../identity/authenticated-user.interface.js';
import { ReportingService } from './reporting.service.js';

@Controller()
@UseGuards(RolesGuard)
export class ReportingController {
  constructor(@Inject(ReportingService) private readonly reporting: ReportingService) {}

  @Get('dashboard')
  async dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('yearId') yearId: string,
  ) {
    if (!yearId) throw new BadRequestException('yearId required');
    return this.reporting.dashboard(user.schoolId, yearId);
  }

  @Get('reports/students.csv')
  @Roles('director', 'owner', 'secretary', 'bursar')
  async studentsCSV(
    @CurrentUser() user: AuthenticatedUser,
    @Query('yearId') yearId: string,
    @Res() reply: FastifyReply,
  ) {
    if (!yearId) throw new BadRequestException('yearId required');
    const csv = await this.reporting.studentsCSV(user.schoolId, yearId);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="eleves.csv"')
      .send(csv);
  }

  @Get('reports/attendance.csv')
  @Roles('director', 'owner', 'secretary')
  async attendanceCSV(
    @CurrentUser() user: AuthenticatedUser,
    @Query('yearId') yearId: string,
    @Res() reply: FastifyReply,
  ) {
    if (!yearId) throw new BadRequestException('yearId required');
    const csv = await this.reporting.attendanceCSV(user.schoolId, yearId);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="presences.csv"')
      .send(csv);
  }

  @Get('reports/marks.csv')
  @Roles('director', 'owner', 'secretary')
  async marksCSV(
    @CurrentUser() user: AuthenticatedUser,
    @Query('periodId') periodId: string,
    @Res() reply: FastifyReply,
  ) {
    if (!periodId) throw new BadRequestException('periodId required');
    const csv = await this.reporting.marksCSV(user.schoolId, periodId);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="notes.csv"')
      .send(csv);
  }
}

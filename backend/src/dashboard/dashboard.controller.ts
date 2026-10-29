import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  Res,
  Inject,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { DashboardService } from './dashboard.service';
import { ApiSecurityService } from '../common/api-security.service';
import { AuthService } from '../auth/auth.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(DashboardService) private dashboardService: DashboardService,
    @Inject(ApiSecurityService) private security: ApiSecurityService,
    @Inject(AuthService) private auth: AuthService,
  ) {}

  private async assertStaff(token: string) {
    const session = this.security.readSession(token);
    const account = session ? await this.auth.validateStaff(session.email) : null;
    if (!this.auth.sessionAccount(account, session, 'staff')) {
      throw new UnauthorizedException('Active staff session required.');
    }
    return account;
  }

  @Get('overview')
  async overview(
    @Headers('x-user-session') token: string,
    @Query('start') start?: string,
    @Query('period') period?: string,
  ) {
    await this.assertStaff(token);
    return this.dashboardService.getOverview(start, period);
  }

  @Get('export')
  async exportGet(
    @Headers('x-user-session') token: string,
    @Query('group') group: string,
    @Query('start') start?: string,
    @Query('period') period?: string,
    @Res() res?: Response,
  ) {
    await this.assertStaff(token);
    const validGroup = group === 'topic' ? 'topic' : group === 'staff' ? 'staff' : 'dept';
    const { filename, csvContent } = await this.dashboardService.exportCsv(validGroup, start, period);

    res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res!.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res!.send(csvContent);
  }

  @Post('export')
  async exportPost(
    @Headers('x-user-session') token: string,
    @Body() body: any,
    @Res() res?: Response,
  ) {
    await this.assertStaff(token);
    const group = String(body?.group || body?.export || 'dept').toLowerCase();
    const validGroup = group === 'topic' ? 'topic' : group === 'staff' ? 'staff' : 'dept';
    const start = body?.start ? String(body.start) : undefined;
    const period = body?.period ? String(body.period) : undefined;

    const { filename, csvContent } = await this.dashboardService.exportCsv(validGroup, start, period);

    res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res!.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res!.send(csvContent);
  }
}

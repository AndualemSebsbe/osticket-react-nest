import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { SystemLogsService, SystemLogsFilterParams } from './system-logs.service';

@Controller('admin/logs')
@UseGuards(AdminGuard)
export class SystemLogsController {
  constructor(
    @Inject(SystemLogsService) private readonly logsService: SystemLogsService,
  ) {}

  @Get('authorization')
  async getAuthorization(@Headers('x-user-session') token?: string) {
    return await this.logsService.checkAdminAuthorization(token, false);
  }

  @Get()
  async listLogs(
    @Headers('x-user-session') token: string,
    @Query() query: SystemLogsFilterParams,
  ) {
    // Explicit role authorization verification
    await this.logsService.checkAdminAuthorization(token);
    return await this.logsService.listLogs(query);
  }

  @Get(':id')
  async getLog(
    @Headers('x-user-session') token: string,
    @Param('id') id: string,
  ) {
    await this.logsService.checkAdminAuthorization(token);
    return await this.logsService.getLog(id);
  }

  @Delete(':id')
  async deleteLog(
    @Headers('x-user-session') token: string,
    @Param('id') id: string,
  ) {
    await this.logsService.checkAdminAuthorization(token);
    return await this.logsService.deleteLog(id);
  }

  @Post('mass-delete')
  async massDelete(
    @Headers('x-user-session') token: string,
    @Body() body: { ids: string[] },
  ) {
    await this.logsService.checkAdminAuthorization(token);
    return await this.logsService.massDelete(body.ids || []);
  }

  @Post('purge')
  async purgeLogs(@Headers('x-user-session') token: string) {
    await this.logsService.checkAdminAuthorization(token);
    return await this.logsService.purgeLogs();
  }

  @Post()
  async createLog(
    @Headers('x-user-session') token: string,
    @Body()
    body: {
      type: 'Error' | 'Warning' | 'Debug';
      title: string;
      log: string;
      logger?: string;
      ipAddress?: string;
    },
  ) {
    await this.logsService.checkAdminAuthorization(token);
    return await this.logsService.createLog(body);
  }
}

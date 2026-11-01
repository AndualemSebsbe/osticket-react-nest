import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { SystemSettingsService } from './system-settings.service';

@Controller('admin/system-settings')
@UseGuards(AdminGuard)
export class SystemSettingsController {
  constructor(@Inject(SystemSettingsService) private readonly systemSettings: SystemSettingsService) {}

  @Get()
  async getSettings() {
    return this.systemSettings.getSettings();
  }

  @Put()
  async saveSettings(@Body() body: any) {
    return this.systemSettings.saveSettings(body);
  }

  @Post('purge-logs')
  async purgeLogs() {
    return this.systemSettings.purgeLogs();
  }

  @Post('purge-expired-locks')
  async purgeExpiredLocks() {
    return this.systemSettings.purgeExpiredLocks();
  }
}

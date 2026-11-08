import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { SystemInfoService } from './system-info.service';

@Controller('admin/system-info')
@UseGuards(AdminGuard)
export class SystemInfoController {
  constructor(@Inject(SystemInfoService) private readonly systemInfo: SystemInfoService) {}

  /** Read-only system and database information for Admin Panel > Dashboard > Information. */
  @Get()
  async getInformation() {
    return this.systemInfo.getInformation();
  }
}

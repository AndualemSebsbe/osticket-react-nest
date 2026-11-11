import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AgentsService } from './agents.service';
import { RolesService } from './roles.service';
import { SchedulesService } from './schedules.service';
import { CompanyController, CompanyPublicController } from './company.controller';
import { CompanyService } from './company.service';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';
import { SystemLogsController } from './system-logs.controller';
import { SystemLogsService } from './system-logs.service';
import { SystemInfoController } from './system-info.controller';
import { SystemInfoService } from './system-info.service';
import { HelpTopicsService } from './help-topics.service';
import { TeamsService } from './teams.service';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';
import { TicketStatusesController } from './ticket-statuses.controller';
import { TicketStatusesService } from './ticket-statuses.service';
import { MailModule } from '../mail/mail.module';
import { AdminGuard } from '../common/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [MailModule, AuthModule, PrismaModule],
  controllers: [
    AdminController,
    CompanyController,
    CompanyPublicController,
    SystemSettingsController,
    SystemLogsController,
    SystemInfoController,
    FormsController,
    ListsController,
    TicketStatusesController,
  ],
  providers: [
    AdminService,
    AgentsService,
    RolesService,
    SchedulesService,
    CompanyService,
    SystemSettingsService,
    SystemLogsService,
    SystemInfoService,
    HelpTopicsService,
    TeamsService,
    FormsService,
    ListsService,
    TicketStatusesService,
    AdminGuard,
  ],
  exports: [FormsService, ListsService, TicketStatusesService],
})
export class AdminModule {}

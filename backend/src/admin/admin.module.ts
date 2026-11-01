import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AgentsService } from './agents.service';
import { SchedulesService } from './schedules.service';
import { CompanyController, CompanyPublicController } from './company.controller';
import { CompanyService } from './company.service';
import { MailModule } from '../mail/mail.module';
import { AdminGuard } from '../common/admin.guard';
import { AuthModule } from '../auth/auth.module';
@Module({ imports:[MailModule,AuthModule], controllers:[AdminController, CompanyController, CompanyPublicController], providers:[AdminService, AgentsService, SchedulesService, CompanyService, AdminGuard] })
export class AdminModule {}

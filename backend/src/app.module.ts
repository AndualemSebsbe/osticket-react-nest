import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TicketsModule } from './tickets/tickets.module';
import { AdminModule } from './admin/admin.module';
import { MailModule } from './mail/mail.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WizardModule } from './wizard/wizard.module';

@Module({ imports: [PrismaModule, MailModule, AuthModule, TicketsModule, AdminModule, DashboardModule, WizardModule] })
export class AppModule {}

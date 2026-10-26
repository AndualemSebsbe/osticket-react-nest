import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MailModule } from '../mail/mail.module';
import { AdminGuard } from '../common/admin.guard';
import { AuthModule } from '../auth/auth.module';
@Module({ imports:[MailModule,AuthModule], controllers:[AdminController], providers:[AdminService, AdminGuard] })
export class AdminModule {}

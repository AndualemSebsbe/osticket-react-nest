import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiSecurityService } from '../common/api-security.service';
import { UsersController, StaffController, PasswordResetController } from './auth.controller';
import { MailModule } from '../mail/mail.module';

@Module({ imports: [MailModule], controllers: [UsersController, StaffController, PasswordResetController], providers: [AuthService, ApiSecurityService], exports: [AuthService, ApiSecurityService] })
export class AuthModule {}

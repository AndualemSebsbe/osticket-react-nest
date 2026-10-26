import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
@Module({ imports:[MailModule,AuthModule], controllers:[TicketsController], providers:[TicketsService], exports:[TicketsService] })
export class TicketsModule {}

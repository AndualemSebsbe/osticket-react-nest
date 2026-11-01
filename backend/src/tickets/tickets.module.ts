import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { AdvancedSearchService } from './advanced-search.service';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
@Module({ imports:[MailModule,AuthModule], controllers:[TicketsController], providers:[TicketsService,AdvancedSearchService], exports:[TicketsService,AdvancedSearchService] })
export class TicketsModule {}

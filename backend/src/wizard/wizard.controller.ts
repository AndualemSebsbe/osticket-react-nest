import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { WizardService } from './wizard.service';

@Controller('wizard')
export class WizardController {
  constructor(@Inject(WizardService) private readonly wizard: WizardService) {}

  @Get('meta')
  async getMeta() {
    return this.wizard.getWizardMeta();
  }

  @Get('faqs')
  async getFaqs(
    @Query('query') query?: string,
    @Query('categoryId') categoryId?: string,
    @Query('topicId') topicId?: string,
  ) {
    return this.wizard.getFaqs({ query, categoryId, topicId });
  }

  @Post('check-status')
  async checkStatus(@Body() body: { number: string; email: string }) {
    return this.wizard.checkTicketStatus(body.number, body.email);
  }
}

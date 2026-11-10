import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { FormsService, FormInput } from './forms.service';

@Controller('admin/forms')
@UseGuards(AdminGuard)
export class FormsController {
  constructor(@Inject(FormsService) private readonly formsService: FormsService) {}

  @Get()
  async listForms() {
    return this.formsService.listForms();
  }

  @Get(':id')
  async getForm(@Param('id') id: string) {
    return this.formsService.getForm(id);
  }

  @Post()
  async createForm(@Body() body: FormInput) {
    return this.formsService.createForm(body);
  }

  @Put(':id')
  async updateForm(@Param('id') id: string, @Body() body: FormInput) {
    return this.formsService.updateForm(id, body);
  }

  @Delete(':id')
  async removeForm(@Param('id') id: string) {
    return this.formsService.removeForm(id);
  }

  @Post('mass-action')
  async massAction(@Body() body: { action: string; ids: string[] }) {
    return this.formsService.massAction(body.action, body.ids || []);
  }

  @Get(':id/entries')
  async listEntries(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.formsService.listEntries(id, Number(page || 1), Number(limit || 50));
  }
}

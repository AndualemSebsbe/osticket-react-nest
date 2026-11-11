import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import {
  TicketStatusesService,
  TicketStatusInput,
} from './ticket-statuses.service';

@Controller('admin/ticket-statuses')
@UseGuards(AdminGuard)
export class TicketStatusesController {
  constructor(
    @Inject(TicketStatusesService)
    private readonly statusesService: TicketStatusesService,
  ) {}

  @Get()
  async listStatuses() {
    return this.statusesService.listStatuses();
  }

  @Get(':id')
  async getStatus(@Param('id') id: string) {
    return this.statusesService.getStatus(id);
  }

  @Post()
  async createStatus(@Body() body: TicketStatusInput) {
    return this.statusesService.createStatus(body);
  }

  @Put(':id')
  async updateStatus(@Param('id') id: string, @Body() body: TicketStatusInput) {
    return this.statusesService.updateStatus(id, body);
  }

  @Delete(':id')
  async removeStatus(@Param('id') id: string) {
    return this.statusesService.removeStatus(id);
  }

  @Post('mass-action')
  async massAction(@Body() body: { action: string; ids: string[] }) {
    return this.statusesService.massAction(body.action, body.ids || []);
  }
}

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
  ListsService,
  ListInput,
  ListItemInput,
  ListPropertyFieldInput,
} from './lists.service';

@Controller('admin/lists')
@UseGuards(AdminGuard)
export class ListsController {
  constructor(@Inject(ListsService) private readonly listsService: ListsService) {}

  @Get()
  async listLists() {
    return this.listsService.listLists();
  }

  @Get(':id')
  async getList(@Param('id') id: string) {
    return this.listsService.getList(id);
  }

  @Post()
  async createList(@Body() body: ListInput) {
    return this.listsService.createList(body);
  }

  @Put(':id')
  async updateList(@Param('id') id: string, @Body() body: ListInput) {
    return this.listsService.updateList(id, body);
  }

  @Delete(':id')
  async removeList(@Param('id') id: string) {
    return this.listsService.removeList(id);
  }

  @Post('mass-action')
  async massAction(@Body() body: { action: string; ids: string[] }) {
    return this.listsService.massAction(body.action, body.ids || []);
  }

  // --- List Items ---

  @Post(':id/items')
  async addItem(@Param('id') id: string, @Body() body: ListItemInput) {
    return this.listsService.addItem(id, body);
  }

  @Put(':id/items/:itemId')
  async updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: ListItemInput,
  ) {
    return this.listsService.updateItem(id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  async removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.listsService.removeItem(id, itemId);
  }

  @Post(':id/items/mass-action')
  async itemMassAction(
    @Param('id') id: string,
    @Body() body: { action: 'enable' | 'disable' | 'delete'; ids: string[] },
  ) {
    return this.listsService.itemMassAction(id, body.action, body.ids || []);
  }

  @Post(':id/items/import')
  async importItems(
    @Param('id') id: string,
    @Body() body: { items: Array<{ value: string; extra?: string }> },
  ) {
    return this.listsService.importItems(id, body.items || []);
  }

  @Put(':id/items/reorder')
  async reorderItems(
    @Param('id') id: string,
    @Body() body: { itemIds: string[] },
  ) {
    return this.listsService.reorderItems(id, body.itemIds || []);
  }

  // --- List Properties (Item Properties) ---

  @Post(':id/properties')
  async saveProperties(
    @Param('id') id: string,
    @Body() body: { fields: ListPropertyFieldInput[] },
  ) {
    return this.listsService.saveProperties(id, body.fields || []);
  }
}

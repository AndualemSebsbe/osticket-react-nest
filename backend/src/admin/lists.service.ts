import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const toBig = (val: unknown) => BigInt(String(val || 0));
const toNum = (val: unknown) => Number(val || 0);
const toStr = (val: unknown) => String(val ?? '');

export type SortMode = 'Alpha' | '-Alpha' | 'SortCol';

export interface ListItemInput {
  id?: string;
  value: string;
  extra?: string;
  status?: number;
  sort?: number;
  properties?: Record<string, any> | string;
}

export interface ListPropertyFieldInput {
  id?: string;
  label: string;
  name: string;
  type: string;
  sort?: number;
  configuration?: Record<string, any> | string;
  flags?: number;
  hint?: string;
  delete?: boolean;
}

export interface ListInput {
  name: string;
  name_plural?: string;
  sort_mode?: SortMode;
  notes?: string;
  configuration?: string | Record<string, any>;
  items?: ListItemInput[];
  properties?: ListPropertyFieldInput[];
}

@Injectable()
export class ListsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Sort items array according to sort_mode
   */
  private sortItems<T extends { value: string; sort: number; id: string }>(items: T[], mode: string): T[] {
    const list = [...items];
    if (mode === '-Alpha') {
      return list.sort((a, b) => b.value.localeCompare(a.value, undefined, { sensitivity: 'base' }));
    }
    if (mode === 'SortCol') {
      return list.sort((a, b) => {
        if (a.sort !== b.sort) return a.sort - b.sort;
        return a.value.localeCompare(b.value, undefined, { sensitivity: 'base' });
      });
    }
    // Default 'Alpha'
    return list.sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }));
  }

  /**
   * List all custom lists with item counts and forms using them
   */
  async listLists() {
    const [lists, items, formFields, forms] = await Promise.all([
      this.prisma.list.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.listItems.findMany({ select: { id: true, list_id: true, status: true } }),
      this.prisma.formField.findMany({
        where: { type: { startsWith: 'list-' } },
        select: { id: true, form_id: true, type: true, label: true, name: true },
      }),
      this.prisma.form.findMany({
        select: { id: true, title: true, type: true },
      }),
    ]);

    const formsMap = new Map(forms.map(f => [toStr(f.id), f]));

    // Item counts by list_id
    const itemCounts = new Map<string, { total: number; enabled: number }>();
    for (const item of items) {
      const lid = toStr(item.list_id);
      const curr = itemCounts.get(lid) || { total: 0, enabled: 0 };
      curr.total += 1;
      if (toNum(item.status) === 1) curr.enabled += 1;
      itemCounts.set(lid, curr);
    }

    // Forms using list
    const usageByList = new Map<string, Array<{ formId: string; formTitle: string; fieldLabel: string; fieldName: string }>>();
    for (const ff of formFields) {
      const listId = ff.type.replace(/^list-/, '');
      const form = formsMap.get(toStr(ff.form_id));
      const arr = usageByList.get(listId) || [];
      arr.push({
        formId: toStr(ff.form_id),
        formTitle: form?.title || `Form #${ff.form_id}`,
        fieldLabel: ff.label || ff.name,
        fieldName: ff.name,
      });
      usageByList.set(listId, arr);
    }

    const formatted = lists.map(l => {
      const id = toStr(l.id);
      const counts = itemCounts.get(id) || { total: 0, enabled: 0 };
      const usage = usageByList.get(id) || [];

      return {
        id,
        name: l.name,
        namePlural: l.name_plural || (l.name ? `${l.name}s` : ''),
        sortMode: (l.sort_mode || 'Alpha') as SortMode,
        masks: toNum(l.masks),
        type: l.type || '',
        notes: l.notes || '',
        itemCount: counts.total,
        enabledItemCount: counts.enabled,
        formsCount: usage.length,
        formsUsing: usage,
        created: l.created,
        updated: l.updated,
      };
    });

    return { lists: formatted };
  }

  /**
   * Get single list detail with items, dynamic property fields, and form references
   */
  async getList(idStr: string) {
    const listId = toBig(idStr);
    const list = await this.prisma.list.findUnique({ where: { id: listId } });
    if (!list) {
      throw new NotFoundException(`Custom list #${idStr} not found`);
    }

    const [items, formFields, forms, propForm] = await Promise.all([
      this.prisma.listItems.findMany({ where: { list_id: listId } }),
      this.prisma.formField.findMany({
        where: { type: `list-${idStr}` },
        select: { id: true, form_id: true, label: true, name: true },
      }),
      this.prisma.form.findMany({ select: { id: true, title: true, type: true } }),
      this.prisma.form.findFirst({
        where: { type: `L${idStr}` },
      }),
    ]);

    // Query property fields if property form exists
    let propertyFields: any[] = [];
    if (propForm) {
      propertyFields = await this.prisma.formField.findMany({
        where: { form_id: propForm.id },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      });
    }

    const formsMap = new Map(forms.map(f => [toStr(f.id), f]));
    const formsUsing = formFields.map(ff => {
      const f = formsMap.get(toStr(ff.form_id));
      return {
        formId: toStr(ff.form_id),
        formTitle: f?.title || `Form #${ff.form_id}`,
        formType: f?.type || 'G',
        fieldLabel: ff.label || ff.name,
        fieldName: ff.name,
      };
    });

    // Format raw items
    const formattedItems = items.map(item => {
      let parsedProps: Record<string, any> = {};
      if (item.properties) {
        try {
          parsedProps = typeof item.properties === 'string' ? JSON.parse(item.properties) : item.properties;
        } catch {
          parsedProps = {};
        }
      }
      return {
        id: toStr(item.id),
        listId: toStr(item.list_id),
        value: item.value,
        extra: item.extra || '',
        status: toNum(item.status),
        enabled: toNum(item.status) === 1,
        sort: item.sort,
        properties: parsedProps,
      };
    });

    // Apply sort_mode
    const sortedItems = this.sortItems(formattedItems, list.sort_mode || 'Alpha');

    return {
      list: {
        id: toStr(list.id),
        name: list.name,
        namePlural: list.name_plural || (list.name ? `${list.name}s` : ''),
        sortMode: (list.sort_mode || 'Alpha') as SortMode,
        masks: toNum(list.masks),
        type: list.type || '',
        notes: list.notes || '',
        configuration: list.configuration || '',
        created: list.created,
        updated: list.updated,
        itemCount: items.length,
        items: sortedItems,
        formsCount: formsUsing.length,
        formsUsing,
        properties: propertyFields.map(pf => ({
          id: toStr(pf.id),
          formId: toStr(pf.form_id),
          label: pf.label,
          name: pf.name,
          type: pf.type,
          sort: toNum(pf.sort),
          flags: toNum(pf.flags),
          hint: pf.hint || '',
          configuration: pf.configuration ? safeJson(pf.configuration) : {},
        })),
      },
    };
  }

  /**
   * Create a new custom list
   */
  async createList(input: ListInput) {
    const name = (input.name || '').trim();
    if (!name) {
      throw new ConflictException('List name is required');
    }

    const sortMode = input.sort_mode || 'Alpha';
    const namePlural = (input.name_plural || '').trim() || `${name}s`;
    const notes = input.notes || '';
    const configStr = typeof input.configuration === 'object' ? JSON.stringify(input.configuration) : input.configuration || '';

    const list = await this.prisma.list.create({
      data: {
        name,
        name_plural: namePlural,
        sort_mode: sortMode,
        notes,
        configuration: configStr,
        created: new Date(),
        updated: new Date(),
      },
    });

    const listIdStr = toStr(list.id);

    // If initial items provided
    if (Array.isArray(input.items) && input.items.length > 0) {
      let currentSort = 1;
      for (const item of input.items) {
        if (!item.value || !item.value.trim()) continue;
        await this.prisma.listItems.create({
          data: {
            list_id: list.id,
            value: item.value.trim(),
            extra: item.extra?.trim() || null,
            status: toBig(item.status ?? 1),
            sort: item.sort ?? currentSort++,
            properties: typeof item.properties === 'object' ? JSON.stringify(item.properties) : item.properties || null,
          },
        });
      }
    }

    // If property fields provided, create property form
    if (Array.isArray(input.properties) && input.properties.length > 0) {
      await this.saveProperties(listIdStr, input.properties);
    }

    return this.getList(listIdStr);
  }

  /**
   * Update existing custom list definition
   */
  async updateList(idStr: string, input: ListInput) {
    const listId = toBig(idStr);
    const existing = await this.prisma.list.findUnique({ where: { id: listId } });
    if (!existing) {
      throw new NotFoundException(`Custom list #${idStr} not found`);
    }

    const name = (input.name || existing.name).trim();
    if (!name) {
      throw new ConflictException('List name cannot be empty');
    }

    const namePlural = input.name_plural !== undefined ? input.name_plural.trim() : (existing.name_plural || `${name}s`);
    const sortMode = input.sort_mode || existing.sort_mode || 'Alpha';
    const notes = input.notes !== undefined ? input.notes : existing.notes;
    const configStr = typeof input.configuration === 'object' ? JSON.stringify(input.configuration) : (input.configuration ?? existing.configuration);

    await this.prisma.list.update({
      where: { id: listId },
      data: {
        name,
        name_plural: namePlural,
        sort_mode: sortMode,
        notes,
        configuration: configStr,
        updated: new Date(),
      },
    });

    if (Array.isArray(input.properties)) {
      await this.saveProperties(idStr, input.properties);
    }

    return this.getList(idStr);
  }

  /**
   * Delete a custom list
   */
  async removeList(idStr: string, force = false) {
    const listId = toBig(idStr);
    const existing = await this.prisma.list.findUnique({ where: { id: listId } });
    if (!existing) {
      throw new NotFoundException(`Custom list #${idStr} not found`);
    }

    // Check if list is referenced by any form fields
    const referencingFields = await this.prisma.formField.findMany({
      where: { type: `list-${idStr}` },
      select: { id: true, label: true, name: true, form_id: true },
    });

    if (referencingFields.length > 0 && !force) {
      throw new ConflictException(
        `Cannot delete list "${existing.name}": it is currently in use by ${referencingFields.length} form field(s). Remove those fields or update them first.`
      );
    }

    // Delete items
    await this.prisma.listItems.deleteMany({ where: { list_id: listId } });

    // Delete property form and fields if any
    const propForm = await this.prisma.form.findFirst({ where: { type: `L${idStr}` } });
    if (propForm) {
      await this.prisma.formField.deleteMany({ where: { form_id: propForm.id } });
      await this.prisma.form.delete({ where: { id: propForm.id } });
    }

    // Delete list
    await this.prisma.list.delete({ where: { id: listId } });

    return { deleted: true, id: idStr };
  }

  /**
   * Mass action for lists (e.g. delete)
   */
  async massAction(action: string, ids: string[]) {
    if (!ids || ids.length === 0) return { affected: 0 };

    if (action === 'delete') {
      let count = 0;
      for (const id of ids) {
        try {
          await this.removeList(id, false);
          count++;
        } catch (e: any) {
          // If in use, continue or surface
          console.warn(`Could not delete list ${id}:`, e.message);
        }
      }
      return { affected: count };
    }

    throw new ConflictException(`Unsupported mass action: ${action}`);
  }

  // ==========================================
  // LIST ITEMS MANAGEMENT
  // ==========================================

  /**
   * Add a single item to a list
   */
  async addItem(listIdStr: string, input: ListItemInput) {
    const listId = toBig(listIdStr);
    const list = await this.prisma.list.findUnique({ where: { id: listId } });
    if (!list) {
      throw new NotFoundException(`Custom list #${listIdStr} not found`);
    }

    const value = (input.value || '').trim();
    if (!value) {
      throw new ConflictException('Item value is required');
    }

    // Determine sort
    let sort = input.sort;
    if (sort === undefined) {
      const maxSortItem = await this.prisma.listItems.findFirst({
        where: { list_id: listId },
        orderBy: { sort: 'desc' },
        select: { sort: true },
      });
      sort = (maxSortItem?.sort ?? 0) + 1;
    }

    const item = await this.prisma.listItems.create({
      data: {
        list_id: listId,
        value,
        extra: input.extra?.trim() || null,
        status: toBig(input.status ?? 1),
        sort,
        properties: typeof input.properties === 'object' ? JSON.stringify(input.properties) : input.properties || null,
      },
    });

    await this.prisma.list.update({
      where: { id: listId },
      data: { updated: new Date() },
    });

    return {
      id: toStr(item.id),
      listId: listIdStr,
      value: item.value,
      extra: item.extra || '',
      status: toNum(item.status),
      enabled: toNum(item.status) === 1,
      sort: item.sort,
      properties: item.properties ? safeJson(item.properties) : {},
    };
  }

  /**
   * Update an existing list item
   */
  async updateItem(listIdStr: string, itemIdStr: string, input: ListItemInput) {
    const listId = toBig(listIdStr);
    const itemId = toBig(itemIdStr);

    const existing = await this.prisma.listItems.findFirst({
      where: { id: itemId, list_id: listId },
    });
    if (!existing) {
      throw new NotFoundException(`Item #${itemIdStr} in list #${listIdStr} not found`);
    }

    const value = input.value !== undefined ? input.value.trim() : existing.value;
    if (!value) {
      throw new ConflictException('Item value cannot be empty');
    }

    const extra = input.extra !== undefined ? input.extra.trim() : existing.extra;
    const status = input.status !== undefined ? toBig(input.status) : existing.status;
    const sort = input.sort !== undefined ? input.sort : existing.sort;
    const properties = input.properties !== undefined
      ? (typeof input.properties === 'object' ? JSON.stringify(input.properties) : input.properties)
      : existing.properties;

    const updated = await this.prisma.listItems.update({
      where: { id: itemId },
      data: {
        value,
        extra: extra || null,
        status,
        sort,
        properties: properties || null,
      },
    });

    await this.prisma.list.update({
      where: { id: listId },
      data: { updated: new Date() },
    });

    return {
      id: toStr(updated.id),
      listId: listIdStr,
      value: updated.value,
      extra: updated.extra || '',
      status: toNum(updated.status),
      enabled: toNum(updated.status) === 1,
      sort: updated.sort,
      properties: updated.properties ? safeJson(updated.properties) : {},
    };
  }

  /**
   * Remove an item from a list
   */
  async removeItem(listIdStr: string, itemIdStr: string) {
    const listId = toBig(listIdStr);
    const itemId = toBig(itemIdStr);

    const existing = await this.prisma.listItems.findFirst({
      where: { id: itemId, list_id: listId },
    });
    if (!existing) {
      throw new NotFoundException(`Item #${itemIdStr} in list #${listIdStr} not found`);
    }

    await this.prisma.listItems.delete({ where: { id: itemId } });
    await this.prisma.list.update({
      where: { id: listId },
      data: { updated: new Date() },
    });

    return { deleted: true, id: itemIdStr };
  }

  /**
   * Mass action on list items (enable, disable, delete)
   */
  async itemMassAction(listIdStr: string, action: 'enable' | 'disable' | 'delete', ids: string[]) {
    const listId = toBig(listIdStr);
    const bigIds = ids.map(toBig);

    if (action === 'enable') {
      const res = await this.prisma.listItems.updateMany({
        where: { id: { in: bigIds }, list_id: listId },
        data: { status: toBig(1) },
      });
      return { affected: res.count };
    }

    if (action === 'disable') {
      const res = await this.prisma.listItems.updateMany({
        where: { id: { in: bigIds }, list_id: listId },
        data: { status: toBig(0) },
      });
      return { affected: res.count };
    }

    if (action === 'delete') {
      const res = await this.prisma.listItems.deleteMany({
        where: { id: { in: bigIds }, list_id: listId },
      });
      return { affected: res.count };
    }

    throw new ConflictException(`Unsupported item mass action: ${action}`);
  }

  /**
   * Bulk import items (Value, Abbreviation)
   */
  async importItems(listIdStr: string, items: Array<{ value: string; extra?: string }>) {
    const listId = toBig(listIdStr);
    const list = await this.prisma.list.findUnique({ where: { id: listId } });
    if (!list) {
      throw new NotFoundException(`Custom list #${listIdStr} not found`);
    }

    let maxSortItem = await this.prisma.listItems.findFirst({
      where: { list_id: listId },
      orderBy: { sort: 'desc' },
      select: { sort: true },
    });
    let currentSort = (maxSortItem?.sort ?? 0) + 1;

    let added = 0;
    for (const item of items) {
      const val = (item.value || '').trim();
      if (!val) continue;

      await this.prisma.listItems.create({
        data: {
          list_id: listId,
          value: val,
          extra: item.extra?.trim() || null,
          status: toBig(1),
          sort: currentSort++,
        },
      });
      added++;
    }

    await this.prisma.list.update({
      where: { id: listId },
      data: { updated: new Date() },
    });

    return { imported: added };
  }

  /**
   * Reorder items and set list sort_mode to 'SortCol'
   */
  async reorderItems(listIdStr: string, itemIds: string[]) {
    const listId = toBig(listIdStr);
    await Promise.all(
      itemIds.map((id, index) =>
        this.prisma.listItems.updateMany({
          where: { id: toBig(id), list_id: listId },
          data: { sort: index + 1 },
        })
      )
    );

    await this.prisma.list.update({
      where: { id: listId },
      data: { sort_mode: 'SortCol', updated: new Date() },
    });

    return { reordered: true, count: itemIds.length };
  }

  // ==========================================
  // LIST ITEM PROPERTIES (Custom Form L<id>)
  // ==========================================

  /**
   * Save dynamic property field definitions for items in this list
   */
  async saveProperties(listIdStr: string, fields: ListPropertyFieldInput[]) {
    const listId = toBig(listIdStr);
    const list = await this.prisma.list.findUnique({ where: { id: listId } });
    if (!list) throw new NotFoundException(`List #${listIdStr} not found`);

    let propForm = await this.prisma.form.findFirst({ where: { type: `L${listIdStr}` } });
    if (!propForm) {
      propForm = await this.prisma.form.create({
        data: {
          type: `L${listIdStr}`,
          title: `${list.name} Item Properties`,
          name: `list_${listIdStr}`,
          instructions: 'Properties definable for each item in this list',
          flags: toBig(1),
          created: new Date(),
          updated: new Date(),
        },
      });
    }

    let sortIndex = 1;
    for (const f of fields) {
      if (f.delete && f.id) {
        await this.prisma.formField.deleteMany({
          where: { id: toBig(f.id), form_id: propForm.id },
        });
        continue;
      }

      const label = (f.label || '').trim();
      const name = (f.name || label.toLowerCase().replace(/[^a-z0-9_]/g, '_')).trim();
      if (!label && !name) continue;

      const type = f.type || 'text';
      const configStr = typeof f.configuration === 'object' ? JSON.stringify(f.configuration) : f.configuration || '';

      if (f.id) {
        await this.prisma.formField.updateMany({
          where: { id: toBig(f.id), form_id: propForm.id },
          data: {
            label,
            name,
            type,
            sort: toBig(f.sort ?? sortIndex++),
            flags: toBig(f.flags ?? 1),
            hint: f.hint || null,
            configuration: configStr || null,
            updated: new Date(),
          },
        });
      } else {
        await this.prisma.formField.create({
          data: {
            form_id: propForm.id,
            label,
            name,
            type,
            sort: toBig(f.sort ?? sortIndex++),
            flags: toBig(f.flags ?? 1),
            hint: f.hint || null,
            configuration: configStr || null,
            created: new Date(),
            updated: new Date(),
          },
        });
      }
    }

    await this.prisma.form.update({
      where: { id: propForm.id },
      data: { updated: new Date() },
    });

    return { saved: true };
  }
}

function safeJson(val: unknown): Record<string, any> {
  if (typeof val === 'object' && val !== null) return val as Record<string, any>;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return {};
    }
  }
  return {};
}

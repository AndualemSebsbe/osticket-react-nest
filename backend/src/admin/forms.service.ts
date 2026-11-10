import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const FLAG_DELETABLE = 0x0001;
const FLAG_DELETED = 0x0002;

const FLAG_ENABLED = 0x00001;
const FLAG_EXT_STORED = 0x00002;
const FLAG_CLOSE_REQUIRED = 0x00004;

const FLAG_MASK_CHANGE = 0x00010;
const FLAG_MASK_DELETE = 0x00020;
const FLAG_MASK_EDIT = 0x00040;
const FLAG_MASK_DISABLE = 0x00080;
const FLAG_MASK_REQUIRE = 0x10000;
const FLAG_MASK_VIEW = 0x20000;
const FLAG_MASK_NAME = 0x40000;

const FLAG_CLIENT_VIEW = 0x00100;
const FLAG_CLIENT_EDIT = 0x00200;
const FLAG_CLIENT_REQUIRED = 0x00400;

const FLAG_AGENT_VIEW = 0x01000;
const FLAG_AGENT_EDIT = 0x02000;
const FLAG_AGENT_REQUIRED = 0x04000;

export type RequirementMode = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

export interface RequirementModeDef {
  key: RequirementMode;
  desc: string;
  flags: number;
}

export const REQUIREMENT_MODES: Record<RequirementMode, RequirementModeDef> = {
  a: {
    key: 'a',
    desc: 'Optional',
    flags: FLAG_CLIENT_VIEW | FLAG_AGENT_VIEW | FLAG_CLIENT_EDIT | FLAG_AGENT_EDIT,
  },
  b: {
    key: 'b',
    desc: 'Required',
    flags: FLAG_CLIENT_VIEW | FLAG_AGENT_VIEW | FLAG_CLIENT_EDIT | FLAG_AGENT_EDIT | FLAG_CLIENT_REQUIRED | FLAG_AGENT_REQUIRED,
  },
  c: {
    key: 'c',
    desc: 'Required for EndUsers',
    flags: FLAG_CLIENT_VIEW | FLAG_AGENT_VIEW | FLAG_CLIENT_EDIT | FLAG_AGENT_EDIT | FLAG_CLIENT_REQUIRED,
  },
  d: {
    key: 'd',
    desc: 'Required for Agents',
    flags: FLAG_CLIENT_VIEW | FLAG_AGENT_VIEW | FLAG_CLIENT_EDIT | FLAG_AGENT_EDIT | FLAG_AGENT_REQUIRED,
  },
  e: {
    key: 'e',
    desc: 'Internal, Optional',
    flags: FLAG_AGENT_VIEW | FLAG_AGENT_EDIT,
  },
  f: {
    key: 'f',
    desc: 'Internal, Required',
    flags: FLAG_AGENT_VIEW | FLAG_AGENT_EDIT | FLAG_AGENT_REQUIRED,
  },
  g: {
    key: 'g',
    desc: 'For EndUsers Only',
    flags: FLAG_CLIENT_VIEW | FLAG_CLIENT_EDIT | FLAG_CLIENT_REQUIRED,
  },
};

const BUILT_IN_TYPES: Record<string, { title: string; desc: string; icon: string }> = {
  U: { title: 'Contact Information', desc: 'User & contact profile details', icon: 'User' },
  T: { title: 'Ticket Details', desc: 'Core ticket fields & properties', icon: 'Ticket' },
  C: { title: 'Company Information', desc: 'Company identity & contact details', icon: 'Building' },
  O: { title: 'Organization Information', desc: 'Organization profile data', icon: 'Users' },
  A: { title: 'Task Details', desc: 'Task description & scheduling fields', icon: 'CheckSquare' },
};

const toBig = (val: unknown) => BigInt(String(val || 0));
const toNum = (val: unknown) => Number(val || 0);
const toStr = (val: unknown) => String(val ?? '');

export function flagsToRequirementMode(flags: number): RequirementMode {
  const hasClientView = Boolean(flags & FLAG_CLIENT_VIEW);
  const hasClientReq = Boolean(flags & FLAG_CLIENT_REQUIRED);
  const hasAgentView = Boolean(flags & FLAG_AGENT_VIEW);
  const hasAgentReq = Boolean(flags & FLAG_AGENT_REQUIRED);

  if (!hasClientView && hasAgentView) {
    return hasAgentReq ? 'f' : 'e';
  }
  if (hasClientView && !hasAgentView) {
    return 'g';
  }
  if (hasClientReq && hasAgentReq) return 'b';
  if (hasClientReq && !hasAgentReq) return 'c';
  if (!hasClientReq && hasAgentReq) return 'd';
  return 'a';
}

export function requirementModeToFlags(mode: RequirementMode, existingFlags = 0): number {
  const def = REQUIREMENT_MODES[mode] || REQUIREMENT_MODES.a;
  // Keep mask flags and enabled flag
  const preserved = existingFlags & (FLAG_ENABLED | FLAG_MASK_DELETE | FLAG_MASK_EDIT | FLAG_MASK_DISABLE | FLAG_MASK_NAME | FLAG_MASK_CHANGE);
  return (preserved || FLAG_ENABLED) | def.flags;
}

export interface FormFieldInput {
  id?: string;
  label: string;
  name: string;
  type: string;
  visibilityMode?: RequirementMode;
  flags?: number;
  configuration?: Record<string, unknown> | string;
  sort?: number;
  hint?: string;
  delete?: boolean;
}

export interface FormInput {
  title: string;
  instructions?: string;
  notes?: string;
  flags?: number;
  enabled?: boolean;
  fields?: FormFieldInput[];
  helpTopicIds?: string[];
}

@Injectable()
export class FormsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * List all forms (built-in and custom), with summary counts.
   */
  async listForms() {
    const [forms, fields, topicLinks, entries, lists, helpTopics] = await Promise.all([
      this.prisma.form.findMany({ orderBy: [{ type: 'asc' }, { title: 'asc' }] }),
      this.prisma.formField.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.helpTopicForm.findMany(),
      this.prisma.formEntry.groupBy({ by: ['form_id'], _count: { _all: true } }),
      this.prisma.list.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.helpTopic.findMany({ orderBy: { topic: 'asc' } }),
    ]);

    const entryCountsByForm = new Map(entries.map(e => [toStr(e.form_id), e._count._all]));
    const topicLinksByForm = new Map<string, number>();
    for (const link of topicLinks) {
      const fid = toStr(link.form_id);
      topicLinksByForm.set(fid, (topicLinksByForm.get(fid) || 0) + 1);
    }

    const fieldsByForm = new Map<string, any[]>();
    for (const field of fields) {
      const fid = toStr(field.form_id);
      const arr = fieldsByForm.get(fid) || [];
      arr.push(field);
      fieldsByForm.set(fid, arr);
    }

    const formattedForms = forms
      .filter(f => !(toNum(f.flags) & FLAG_DELETED))
      .map(f => {
        const id = toStr(f.id);
        const type = f.type || 'G';
        const isBuiltIn = type !== 'G';
        const builtInInfo = BUILT_IN_TYPES[type];
        const formFields = fieldsByForm.get(id) || [];
        const fl = toNum(f.flags);
        const enabled = !(fl & FLAG_DELETED);

        return {
          id,
          title: f.title || builtInInfo?.title || `Form #${id}`,
          instructions: f.instructions || '',
          name: f.name || '',
          type,
          isBuiltIn,
          builtInLabel: builtInInfo ? builtInInfo.title : 'Custom Form',
          icon: builtInInfo?.icon || 'FormInput',
          flags: fl,
          enabled,
          deletable: !isBuiltIn,
          notes: f.notes || '',
          fieldCount: formFields.length,
          topicCount: topicLinksByForm.get(id) || 0,
          entryCount: entryCountsByForm.get(id) || 0,
          updated: f.updated,
          created: f.created,
          fieldsSummary: formFields.slice(0, 5).map(fld => fld.label || fld.name),
        };
      });

    return {
      forms: formattedForms,
      lists: lists.map(l => ({
        id: toStr(l.id),
        name: l.name,
        namePlural: l.name_plural || l.name,
        type: l.type || '',
      })),
      helpTopics: helpTopics.map(t => ({
        id: toStr(t.topic_id),
        name: t.topic,
      })),
    };
  }

  /**
   * Get single form with fields, associated help topics, and recent submissions.
   */
  async getForm(id: string) {
    const formId = toBig(id);
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form || (toNum(form.flags) & FLAG_DELETED)) {
      throw new NotFoundException(`Form with ID ${id} not found.`);
    }

    const [fields, topicLinks, allHelpTopics, lists, listItems, recentEntries, entryCount] = await Promise.all([
      this.prisma.formField.findMany({ where: { form_id: formId }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.helpTopicForm.findMany({ where: { form_id: formId }, orderBy: { sort: 'asc' } }),
      this.prisma.helpTopic.findMany({ orderBy: { topic: 'asc' } }),
      this.prisma.list.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.listItems.findMany({ orderBy: [{ list_id: 'asc' }, { sort: 'asc' }] }),
      this.prisma.formEntry.findMany({
        where: { form_id: formId },
        orderBy: { created: 'desc' },
        take: 15,
      }),
      this.prisma.formEntry.count({ where: { form_id: formId } }),
    ]);

    const entryIds = recentEntries.map(e => e.id);
    const entryValues = entryIds.length
      ? await this.prisma.formEntryValues.findMany({ where: { entry_id: { in: entryIds } } })
      : [];

    const fieldMap = new Map(fields.map(f => [toStr(f.id), f]));

    // Check if any entries reference attachments
    const attachmentLinks = entryIds.length
      ? await this.prisma.attachment.findMany({
          where: { object_id: { in: entryIds } },
        })
      : [];
    const fileIds = attachmentLinks.map(a => a.file_id);
    const files = fileIds.length
      ? await this.prisma.file.findMany({ where: { id: { in: fileIds } } })
      : [];
    const fileMap = new Map(files.map(f => [toStr(f.id), f]));

    const entriesWithDetails = recentEntries.map(entry => {
      const eid = toStr(entry.id);
      const values = entryValues.filter(v => toStr(v.entry_id) === eid);
      const attachments = attachmentLinks
        .filter(a => toStr(a.object_id) === eid)
        .map(a => {
          const file = fileMap.get(toStr(a.file_id));
          return {
            id: toStr(a.id),
            fileId: toStr(a.file_id),
            name: a.name || file?.name || 'attachment',
            size: file ? Number(file.size) : 0,
            type: file?.type || 'application/octet-stream',
          };
        });

      const valueMap: Record<string, { label: string; value: string | null; name: string }> = {};
      for (const val of values) {
        const field = fieldMap.get(toStr(val.field_id));
        if (field) {
          valueMap[toStr(field.id)] = {
            label: field.label || field.name,
            name: field.name,
            value: val.value,
          };
        }
      }

      return {
        id: eid,
        objectId: toStr(entry.object_id),
        objectType: entry.object_type,
        created: entry.created,
        updated: entry.updated,
        values: valueMap,
        attachments,
      };
    });

    const isBuiltIn = form.type !== 'G';
    const builtInInfo = BUILT_IN_TYPES[form.type || 'G'];

    const formattedFields = fields.map(field => {
      const fl = toNum(field.flags);
      let configObj: Record<string, unknown> = {};
      try {
        if (field.configuration) {
          configObj = JSON.parse(field.configuration);
        }
      } catch {
        configObj = {};
      }

      return {
        id: toStr(field.id),
        formId: toStr(field.form_id),
        label: field.label || '',
        name: field.name || '',
        type: field.type || 'text',
        sort: Number(field.sort || 0),
        flags: fl,
        enabled: Boolean(fl & FLAG_ENABLED),
        visibilityMode: flagsToRequirementMode(fl),
        hint: field.hint || '',
        configuration: configObj,
        deletable: !(fl & FLAG_MASK_DELETE),
        nameEditable: !(fl & FLAG_MASK_NAME),
        typeEditable: !(fl & FLAG_MASK_CHANGE),
      };
    });

    const topicMap = new Map(allHelpTopics.map(t => [toStr(t.topic_id), t.topic]));
    const formattedTopicLinks = topicLinks.map(link => ({
      id: toStr(link.id),
      topicId: toStr(link.topic_id),
      topicName: topicMap.get(toStr(link.topic_id)) || `Help Topic #${link.topic_id}`,
      sort: Number(link.sort || 1),
    }));

    const itemsByList = new Map<string, any[]>();
    for (const item of listItems) {
      const lid = toStr(item.list_id);
      const arr = itemsByList.get(lid) || [];
      arr.push({
        id: toStr(item.id),
        value: item.value,
        sort: item.sort,
        status: toNum(item.status),
      });
      itemsByList.set(lid, arr);
    }

    return {
      form: {
        id: toStr(form.id),
        title: form.title || builtInInfo?.title || `Form #${form.id}`,
        instructions: form.instructions || '',
        name: form.name || '',
        type: form.type || 'G',
        isBuiltIn,
        builtInLabel: builtInInfo ? builtInInfo.title : 'Custom Form',
        icon: builtInInfo?.icon || 'FormInput',
        flags: toNum(form.flags),
        enabled: !(toNum(form.flags) & FLAG_DELETED),
        deletable: !isBuiltIn,
        notes: form.notes || '',
        entryCount,
        created: form.created,
        updated: form.updated,
      },
      fields: formattedFields,
      helpTopics: formattedTopicLinks,
      allHelpTopics: allHelpTopics.map(t => ({ id: toStr(t.topic_id), name: t.topic })),
      recentEntries: entriesWithDetails,
      lists: lists.map(l => ({
        id: toStr(l.id),
        name: l.name,
        namePlural: l.name_plural || l.name,
        sortMode: l.sort_mode,
        items: itemsByList.get(toStr(l.id)) || [],
      })),
    };
  }

  /**
   * Create a new custom form with fields.
   */
  async createForm(input: FormInput) {
    if (!input.title || !input.title.trim()) {
      throw new ConflictException('Form title is required.');
    }

    const timestamp = new Date();
    const flags = input.enabled === false ? FLAG_DELETED : FLAG_DELETABLE;

    const created = await this.prisma.$transaction(async tx => {
      const form = await tx.form.create({
        data: {
          title: input.title.trim(),
          instructions: input.instructions?.trim() || null,
          notes: input.notes?.trim() || null,
          type: 'G',
          flags: BigInt(flags),
          created: timestamp,
          updated: timestamp,
        },
      });

      const formId = form.id;

      if (input.fields && input.fields.length > 0) {
        for (let idx = 0; idx < input.fields.length; idx++) {
          const fld = input.fields[idx];
          if (!fld.label && !fld.name) continue;

          const mode = fld.visibilityMode || 'a';
          const calculatedFlags = requirementModeToFlags(mode, fld.flags || FLAG_ENABLED);
          const configStr = typeof fld.configuration === 'object'
            ? JSON.stringify(fld.configuration)
            : (fld.configuration || null);

          await tx.formField.create({
            data: {
              form_id: formId,
              label: fld.label || fld.name || `Field ${idx + 1}`,
              name: (fld.name || fld.label || `field_${idx + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
              type: fld.type || 'text',
              flags: BigInt(calculatedFlags),
              configuration: configStr,
              sort: BigInt(fld.sort ?? (idx + 1)),
              hint: fld.hint || null,
              created: timestamp,
              updated: timestamp,
            },
          });
        }
      }

      if (input.helpTopicIds && input.helpTopicIds.length > 0) {
        for (let i = 0; i < input.helpTopicIds.length; i++) {
          const tid = toBig(input.helpTopicIds[i]);
          await tx.helpTopicForm.create({
            data: {
              topic_id: tid,
              form_id: formId,
              sort: BigInt(i + 1),
            },
          });
        }
      }

      return form;
    });

    return this.getForm(toStr(created.id));
  }

  /**
   * Update form fields, details, and help topic associations.
   */
  async updateForm(id: string, input: FormInput) {
    const formId = toBig(id);
    const existing = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!existing || (toNum(existing.flags) & FLAG_DELETED)) {
      throw new NotFoundException(`Form with ID ${id} not found.`);
    }

    if (!input.title || !input.title.trim()) {
      throw new ConflictException('Form title cannot be empty.');
    }

    const timestamp = new Date();
    const isBuiltIn = existing.type !== 'G';

    await this.prisma.$transaction(async tx => {
      // 1. Update form metadata
      await tx.form.update({
        where: { id: formId },
        data: {
          title: input.title.trim(),
          instructions: input.instructions !== undefined ? (input.instructions?.trim() || null) : existing.instructions,
          notes: input.notes !== undefined ? (input.notes?.trim() || null) : existing.notes,
          updated: timestamp,
        },
      });

      // 2. Synchronize fields if supplied
      if (input.fields) {
        const existingFields = await tx.formField.findMany({ where: { form_id: formId } });
        const existingFieldMap = new Map(existingFields.map(f => [toStr(f.id), f]));

        for (let idx = 0; idx < input.fields.length; idx++) {
          const fld = input.fields[idx];

          if (fld.delete && fld.id) {
            const current = existingFieldMap.get(fld.id);
            if (current && !(toNum(current.flags) & FLAG_MASK_DELETE)) {
              // Can delete
              await tx.formField.delete({ where: { id: current.id } });
            }
            continue;
          }

          const configStr = typeof fld.configuration === 'object'
            ? JSON.stringify(fld.configuration)
            : (fld.configuration !== undefined ? fld.configuration : null);

          if (fld.id && existingFieldMap.has(fld.id)) {
            const current = existingFieldMap.get(fld.id)!;
            const currentFlags = toNum(current.flags);
            const mode = fld.visibilityMode || flagsToRequirementMode(currentFlags);
            const newFlags = requirementModeToFlags(mode, currentFlags);

            await tx.formField.update({
              where: { id: current.id },
              data: {
                label: fld.label !== undefined ? fld.label : current.label,
                name: (currentFlags & FLAG_MASK_NAME)
                  ? current.name
                  : (fld.name || current.name),
                type: (currentFlags & FLAG_MASK_CHANGE)
                  ? current.type
                  : (fld.type || current.type),
                flags: BigInt(newFlags),
                configuration: configStr !== null ? configStr : current.configuration,
                sort: BigInt(fld.sort ?? (idx + 1)),
                hint: fld.hint !== undefined ? (fld.hint || null) : current.hint,
                updated: timestamp,
              },
            });
          } else if (!fld.delete) {
            // New field
            const mode = fld.visibilityMode || 'a';
            const newFlags = requirementModeToFlags(mode, FLAG_ENABLED);
            await tx.formField.create({
              data: {
                form_id: formId,
                label: fld.label || fld.name || `Field ${idx + 1}`,
                name: (fld.name || fld.label || `field_${idx + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                type: fld.type || 'text',
                flags: BigInt(newFlags),
                configuration: configStr,
                sort: BigInt(fld.sort ?? (idx + 1)),
                hint: fld.hint || null,
                created: timestamp,
                updated: timestamp,
              },
            });
          }
        }
      }

      // 3. Synchronize Help Topic links if supplied
      if (input.helpTopicIds !== undefined) {
        await tx.helpTopicForm.deleteMany({ where: { form_id: formId } });
        for (let i = 0; i < input.helpTopicIds.length; i++) {
          const tid = toBig(input.helpTopicIds[i]);
          await tx.helpTopicForm.create({
            data: {
              topic_id: tid,
              form_id: formId,
              sort: BigInt(i + 1),
            },
          });
        }
      }
    });

    return this.getForm(id);
  }

  /**
   * Delete custom form (soft delete or hard delete if no entries exist).
   */
  async removeForm(id: string) {
    const formId = toBig(id);
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) {
      throw new NotFoundException(`Form with ID ${id} not found.`);
    }

    if (form.type !== 'G') {
      throw new ConflictException('Built-in forms cannot be deleted.');
    }

    const entryCount = await this.prisma.formEntry.count({ where: { form_id: formId } });

    await this.prisma.$transaction(async tx => {
      // Remove help topic links
      await tx.helpTopicForm.deleteMany({ where: { form_id: formId } });

      if (entryCount > 0) {
        // If submitted entries exist, mark as deleted to preserve historical data integrity
        await tx.form.update({
          where: { id: formId },
          data: {
            flags: BigInt(toNum(form.flags) | FLAG_DELETED),
            updated: new Date(),
          },
        });
      } else {
        // Safe to hard delete form fields and form
        await tx.formField.deleteMany({ where: { form_id: formId } });
        await tx.form.delete({ where: { id: formId } });
      }
    });

    return { deleted: true, id };
  }

  /**
   * Mass actions on forms (delete, enable, disable).
   */
  async massAction(action: string, ids: string[]) {
    if (!ids || ids.length === 0) return { updated: 0, deleted: 0 };
    const formIds = ids.map(toBig);

    if (action === 'delete') {
      // Only delete non-built-in forms
      const forms = await this.prisma.form.findMany({
        where: { id: { in: formIds }, type: 'G' },
      });

      let deletedCount = 0;
      for (const f of forms) {
        try {
          await this.removeForm(toStr(f.id));
          deletedCount++;
        } catch {
          // Skip if locked
        }
      }
      return { deleted: deletedCount };
    }

    return { updated: 0 };
  }

  /**
   * Get paginated entries for a specific form.
   */
  async listEntries(formIdStr: string, page = 1, limit = 50) {
    const formId = toBig(formIdStr);
    const offset = Math.max(0, (page - 1) * limit);

    const [entries, total, fields] = await Promise.all([
      this.prisma.formEntry.findMany({
        where: { form_id: formId },
        orderBy: { created: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.formEntry.count({ where: { form_id: formId } }),
      this.prisma.formField.findMany({ where: { form_id: formId }, orderBy: { sort: 'asc' } }),
    ]);

    const entryIds = entries.map(e => e.id);
    const [values, attachments] = await Promise.all([
      entryIds.length
        ? this.prisma.formEntryValues.findMany({ where: { entry_id: { in: entryIds } } })
        : Promise.resolve([] as Array<{ entry_id: bigint; field_id: bigint; value: string | null }>),
      entryIds.length
        ? this.prisma.attachment.findMany({ where: { object_id: { in: entryIds } } })
        : Promise.resolve([] as Array<{ id: bigint; object_id: bigint; type: string; file_id: bigint; name: string | null; inline: number; lang: string | null }>),
    ]);

    const fileIds = attachments.map(a => a.file_id);
    const files = fileIds.length
      ? await this.prisma.file.findMany({ where: { id: { in: fileIds } } })
      : [];
    const fileMap = new Map(files.map(f => [toStr(f.id), f]));

    const formatted = entries.map(entry => {
      const eid = toStr(entry.id);
      const rowValues: Record<string, string | null> = {};
      for (const val of values.filter(v => toStr(v.entry_id) === eid)) {
        rowValues[toStr(val.field_id)] = val.value;
      }
      const entryFiles = attachments
        .filter(a => toStr(a.object_id) === eid)
        .map(a => {
          const f = fileMap.get(toStr(a.file_id));
          return {
            id: toStr(a.id),
            name: a.name || f?.name || 'file',
            size: f ? Number(f.size) : 0,
            type: f?.type || 'application/octet-stream',
          };
        });

      return {
        id: eid,
        objectId: toStr(entry.object_id),
        objectType: entry.object_type,
        created: entry.created,
        values: rowValues,
        attachments: entryFiles,
      };
    });

    return {
      entries: formatted,
      total,
      page,
      limit,
      fields: fields.map(f => ({
        id: toStr(f.id),
        label: f.label || f.name,
        name: f.name,
        type: f.type,
      })),
    };
  }
}

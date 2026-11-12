import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const FLAG_CUSTOM_NUMBERS = 0x0001;
const FLAG_ACTIVE = 0x0002;
const FLAG_ARCHIVED = 0x0004;

const asKey = (value: unknown) => BigInt(String(value || 0));
const asNumber = (value: unknown) => Number(value || 0);
const asString = (value: unknown) => String(value ?? '');
const now = () => new Date();

type TopicStatus = 'active' | 'disabled' | 'archived';

function parseExtra(value?: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function statusFromFlags(flags: unknown): TopicStatus {
  const bits = asNumber(flags);
  if (bits & FLAG_ACTIVE) return 'active';
  if (bits & FLAG_ARCHIVED) return 'archived';
  return 'disabled';
}

function agentName(staff: { firstname?: string | null; lastname?: string | null; username?: string | null }) {
  return [staff.firstname, staff.lastname].filter(Boolean).join(' ') || staff.username || '';
}

function formDeleted(flags: unknown) {
  // DynamicForm::FLAG_DELETED
  return Boolean(asNumber(flags) & 0x0002);
}

@Injectable()
export class HelpTopicsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Older rows were seeded before the osTicket status flags were modelled and
   * carry flags=0 (which osTicket interprets as disabled). When *all* topics
   * are unflagged we can safely treat the data as legacy and make them active.
   * The admin service prevents a real installation from ever having no active
   * topic, so this cannot silently re-enable topics disabled through this UI.
   */
  private async ensureLegacyFlags() {
    const [total, flagged] = await Promise.all([
      this.prisma.helpTopic.count(),
      this.prisma.helpTopic.count({ where: { flags: { not: 0 } } }),
    ]);
    if (total > 0 && flagged === 0) {
      await this.prisma.helpTopic.updateMany({ data: { flags: FLAG_ACTIVE } });
    }
  }

  private async loadLookups() {
    await this.ensureLegacyFlags();
    const [departments, statuses, priorities, slas, pages, sequences, staff, teams, forms, fields] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.ticketStatus.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.ticketPriority.findMany({ orderBy: { priority_urgency: 'asc' } }),
      this.prisma.sla.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.content.findMany({ where: { isactive: 1, type: 'thank-you' }, orderBy: { name: 'asc' } }),
      this.prisma.sequence.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.staff.findMany({ where: { isactive: 1 }, orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }] }),
      this.prisma.team.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.form.findMany({ orderBy: { title: 'asc' } }),
      this.prisma.formField.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
    ]);

    const departmentOptions = departments.map(row => {
      const flags = asNumber(row.flags);
      return {
        id: asString(row.id),
        name: row.name,
        parentId: asString(row.pid),
        public: Boolean(row.ispublic),
        active: Boolean(flags & 4) || flags === 0,
        archived: Boolean(flags & 8),
      };
    });
    const statusOptions = statuses.map(row => {
      const flags = asNumber(row.flags);
      return {
        id: asString(row.id),
        name: row.name,
        state: row.state || '',
        // TicketStatus::FLAG_ENABLED. Legacy rows were also seeded with 0.
        enabled: Boolean(flags & 1) || flags === 0,
      };
    });
    const priorityOptions = priorities.map(row => ({
      id: asString(row.priority_id),
      name: row.priority,
      urgency: row.priority_urgency,
    }));
    const slaOptions = slas.map(row => ({ id: asString(row.id), name: row.name }));
    const pageOptions = pages.map(row => ({ id: asString(row.id), name: row.name, type: row.type }));
    const sequenceOptions = sequences.map(row => ({
      id: asString(row.id),
      name: row.name || `Sequence ${row.id}`,
      next: asString(row.next),
      increment: row.increment ?? 1,
      padding: row.padding || '0',
    }));
    const staffOptions = staff.map(row => ({
      id: asString(row.staff_id),
      name: agentName(row),
      email: row.email || '',
      departmentId: asString(row.dept_id),
    }));
    const teamOptions = teams.map(row => ({ id: asString(row.team_id), name: row.name }));

    const formOptions = forms.map(form => {
      const formFields = fields
        .filter(field => field.form_id === form.id)
        .map(field => ({
          id: asString(field.id),
          label: field.label || '',
          name: field.name || '',
          type: field.type || 'text',
          sort: Number(field.sort || 0),
          flags: asString(field.flags ?? 0),
          enabled: Boolean(asNumber(field.flags) & 0x00001),
        }));
      return {
        id: asString(form.id),
        title: form.title || '',
        instructions: form.instructions || '',
        name: form.name || '',
        type: form.type || 'G',
        flags: asString(form.flags ?? 0),
        deleted: formDeleted(form.flags),
        fields: formFields,
      };
    });

    return {
      departmentOptions,
      statusOptions,
      priorityOptions,
      slaOptions,
      pageOptions,
      sequenceOptions,
      staffOptions,
      teamOptions,
      formOptions,
    };
  }

  private topicView(row: any, lookups: Awaited<ReturnType<HelpTopicsService['loadLookups']>>, links: any[]) {
    const department = lookups.departmentOptions.find(item => item.id === asString(row.dept_id));
    const status = statusFromFlags(row.flags);
    const topicStatus = lookups.statusOptions.find(item => item.id === asString(row.status_id));
    const priority = lookups.priorityOptions.find(item => item.id === asString(row.priority_id));
    const sla = lookups.slaOptions.find(item => item.id === asString(row.sla_id));
    const page = lookups.pageOptions.find(item => item.id === asString(row.page_id));
    const sequence = lookups.sequenceOptions.find(item => item.id === asString(row.sequence_id));
    const staff = lookups.staffOptions.find(item => item.id === asString(row.staff_id));
    const team = lookups.teamOptions.find(item => item.id === asString(row.team_id));

    const forms = links
      .filter(link => link.topic_id === row.topic_id)
      .sort((a, b) => Number(a.sort - b.sort))
      .map(link => {
        const form = lookups.formOptions.find(item => item.id === asString(link.form_id));
        const disabledFieldIds = Array.isArray(parseExtra(link.extra).disable)
          ? (parseExtra(link.extra).disable as unknown[]).map(value => asString(value))
          : [];
        return {
          id: asString(link.id),
          formId: asString(link.form_id),
          sort: Number(link.sort || 0),
          title: form?.title || `Form #${link.form_id}`,
          instructions: form?.instructions || '',
          type: form?.type || '',
          disabledFieldIds,
          fields: (form?.fields || []).map(field => ({
            ...field,
            disabled: disabledFieldIds.includes(field.id),
          })),
        };
      });

    const assign = staff ? `s${staff.id}` : team ? `t${team.id}` : '0';
    return {
      id: asString(row.topic_id),
      topicId: asString(row.topic_id),
      name: row.topic,
      topic: row.topic,
      status,
      active: status === 'active',
      isPublic: Boolean(row.ispublic),
      public: Boolean(row.ispublic),
      parentId: asString(row.topic_pid),
      departmentId: asString(row.dept_id),
      deptId: asString(row.dept_id),
      departmentName: department?.name || '',
      statusId: asString(row.status_id),
      statusName: topicStatus?.name || '',
      priorityId: asString(row.priority_id),
      priority: (priority?.name || 'normal').toLowerCase(),
      priorityName: priority?.name || '',
      slaId: asString(row.sla_id),
      slaName: sla?.name || '',
      pageId: asString(row.page_id),
      pageName: page?.name || '',
      sequenceId: asString(row.sequence_id),
      sequenceName: sequence?.name || '',
      numberFormat: row.number_format || '',
      customNumbers: Boolean(asNumber(row.flags) & FLAG_CUSTOM_NUMBERS),
      staffId: asString(row.staff_id),
      teamId: asString(row.team_id),
      assign,
      assignName: staff?.name || team?.name || '',
      noautoresp: Boolean(row.noautoresp),
      disableAutoResponse: Boolean(row.noautoresp),
      notes: row.notes || '',
      // Kept for older consumers. Internal notes are not exposed publicly.
      hint: row.notes || '',
      sort: Number(row.sort || 0),
      forms,
      created: row.created?.toISOString?.() || '',
      updated: row.updated?.toISOString?.() || '',
    };
  }

  async list() {
    const [lookups, topics, links] = await Promise.all([
      this.loadLookups(),
      this.prisma.helpTopic.findMany({ orderBy: [{ sort: 'asc' }, { topic: 'asc' }] }),
      this.prisma.helpTopicForm.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
    ]);
    const topicViews = topics.map(topic => this.topicView(topic, lookups, links));
    return {
      topics: topicViews,
      departments: lookups.departmentOptions,
      statuses: lookups.statusOptions.filter(item => item.state === 'open'),
      priorities: lookups.priorityOptions,
      slas: lookups.slaOptions,
      pages: lookups.pageOptions,
      sequences: lookups.sequenceOptions,
      staff: lookups.staffOptions,
      teams: lookups.teamOptions,
      forms: lookups.formOptions.filter(form => !form.deleted),
    };
  }

  async get(id: string) {
    const topicId = asKey(id);
    const [lookups, row, links] = await Promise.all([
      this.loadLookups(),
      this.prisma.helpTopic.findUnique({ where: { topic_id: topicId } }),
      this.prisma.helpTopicForm.findMany({ where: { topic_id: topicId }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
    ]);
    if (!row) throw new NotFoundException('Help topic not found.');
    return { topic: this.topicView(row, lookups, links) };
  }

  private async validateParent(rawParentId: unknown, currentId?: bigint) {
    const parentId = asKey(rawParentId);
    if (parentId === 0n) return 0n;
    if (currentId && parentId === currentId) throw new ConflictException('A help topic cannot be its own parent.');
    const parent = await this.prisma.helpTopic.findUnique({ where: { topic_id: parentId } });
    if (!parent) throw new ConflictException('Choose a valid parent topic.');
    if (statusFromFlags(parent.flags) === 'archived') throw new ConflictException('The selected parent topic is archived.');
    if (currentId) {
      let cursor: typeof parent | null = parent;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor.topic_id === currentId) {
          throw new ConflictException('A help topic cannot be nested beneath its own child topic.');
        }
        if (seen.has(asString(cursor.topic_id)) || !cursor.topic_pid) break;
        seen.add(asString(cursor.topic_id));
        cursor = await this.prisma.helpTopic.findUnique({ where: { topic_id: cursor.topic_pid } });
      }
    }
    return parentId;
  }

  private async validateSelections(data: any) {
    const deptId = asKey(data.deptId ?? data.departmentId);
    const statusId = asKey(data.statusId);
    const priorityId = asKey(data.priorityId);
    const slaId = asKey(data.slaId);
    const pageId = asKey(data.pageId);
    const sequenceId = asKey(data.sequenceId);
    const staffId = asKey(data.staffId);
    const teamId = asKey(data.teamId);

    const [department, status, priority, sla, page, sequence, staff, team] = await Promise.all([
      deptId ? this.prisma.department.findUnique({ where: { id: deptId } }) : null,
      statusId ? this.prisma.ticketStatus.findUnique({ where: { id: statusId } }) : null,
      priorityId ? this.prisma.ticketPriority.findUnique({ where: { priority_id: Number(priorityId) } }) : null,
      slaId ? this.prisma.sla.findUnique({ where: { id: Number(slaId) } }) : null,
      pageId ? this.prisma.content.findUnique({ where: { id: pageId } }) : null,
      sequenceId ? this.prisma.sequence.findUnique({ where: { id: sequenceId } }) : null,
      staffId ? this.prisma.staff.findUnique({ where: { staff_id: Number(staffId) } }) : null,
      teamId ? this.prisma.team.findUnique({ where: { team_id: teamId } }) : null,
    ]);

    if (deptId && !department) throw new ConflictException('The selected department no longer exists.');
    if (department && asNumber(department.flags) & 8) throw new ConflictException('The selected department is archived.');
    if (statusId && (!status || status.state !== 'open')) throw new ConflictException('Choose an open ticket status for this help topic.');
    if (priorityId && !priority) throw new ConflictException('The selected priority no longer exists.');
    if (slaId && !sla) throw new ConflictException('The selected SLA plan no longer exists.');
    if (pageId && (!page || page.type !== 'thank-you' || !page.isactive)) throw new ConflictException('Choose an active thank-you page.');
    if (sequenceId && !sequence) throw new ConflictException('The selected ticket-number sequence no longer exists.');
    if (staffId && (!staff || !staff.isactive)) throw new ConflictException('Choose an active agent for auto-assignment.');
    if (teamId && !team) throw new ConflictException('The selected team no longer exists.');

    return { deptId, statusId, priorityId, slaId, pageId, sequenceId, staffId, teamId };
  }

  private async saveForms(tx: any, topicId: bigint, requested: unknown, lookups: Awaited<ReturnType<HelpTopicsService['loadLookups']>>, isNew: boolean) {
    const formById = new Map(lookups.formOptions.map(form => [form.id, form]));
    const existing: any[] = await tx.helpTopicForm.findMany({ where: { topic_id: topicId } });
    const forcedSystemForms = existing
      .filter(link => formById.get(asString(link.form_id))?.type === 'T')
      .map(link => asString(link.form_id));

    if (requested === undefined) {
      if (!isNew) return;
      const systemForms = lookups.formOptions.filter(form => form.type === 'T' && !form.deleted).map(form => form.id);
      if (systemForms.length) {
        await tx.helpTopicForm.createMany({
          data: systemForms.map((formId, index) => ({
            topic_id: topicId,
            form_id: asKey(formId),
            sort: BigInt(index + 1),
            extra: JSON.stringify({ disable: [] }),
          })),
        });
      }
      return;
    }

    if (!Array.isArray(requested)) throw new ConflictException('Invalid custom form selection.');

    const ordered: Array<{ formId: string; disabledFieldIds: string[] }> = [];
    const seen = new Set<string>();
    for (const item of requested) {
      const formId = asString(typeof item === 'string' ? item : item?.formId ?? item?.id);
      if (!formId || seen.has(formId)) continue;
      const form = formById.get(formId);
      if (!form || form.deleted) throw new ConflictException('A selected custom form no longer exists.');
      const rawDisabled = typeof item === 'object' && item ? item.disabledFieldIds : [];
      const disabledFieldIds = Array.isArray(rawDisabled)
        ? Array.from(new Set(rawDisabled.map(asString))).filter(fieldId => form.fields.some(field => field.id === fieldId))
        : [];
      ordered.push({ formId, disabledFieldIds });
      seen.add(formId);
    }

    // Ticket system forms (type T) are intrinsic to tickets and cannot be
    // removed from a help topic, matching Topic::updateForms().
    for (const formId of forcedSystemForms) {
      if (seen.has(formId)) continue;
      const form = formById.get(formId);
      ordered.push({ formId, disabledFieldIds: [] });
      seen.add(formId);
    }

    if (isNew) {
      for (const form of lookups.formOptions.filter(item => item.type === 'T' && !item.deleted)) {
        if (seen.has(form.id)) continue;
        ordered.push({ formId: form.id, disabledFieldIds: [] });
        seen.add(form.id);
      }
    }

    await tx.helpTopicForm.deleteMany({ where: { topic_id: topicId } });
    if (ordered.length) {
      await tx.helpTopicForm.createMany({
        data: ordered.map((entry, index) => ({
          topic_id: topicId,
          form_id: asKey(entry.formId),
          sort: BigInt(index + 1),
          extra: JSON.stringify({ disable: entry.disabledFieldIds }),
        })),
      });
    }
  }

  async save(data: any, rawId?: string) {
    await this.ensureLegacyFlags();
    const name = asString(data.name ?? data.topic).trim();
    if (!name) throw new ConflictException('Help topic name is required.');
    if (name.length < 5) throw new ConflictException('Topic is too short. Five characters minimum.');
    if (name.length > 128) throw new ConflictException('Help topic name cannot exceed 128 characters.');

    const currentId = rawId ? asKey(rawId) : undefined;
    const current = currentId ? await this.prisma.helpTopic.findUnique({ where: { topic_id: currentId } }) : null;
    if (currentId && !current) throw new NotFoundException('Help topic not found.');

    const parentId = await this.validateParent(data.parentId ?? data.topicPid ?? data.topic_pid, currentId);
    const duplicate = await this.prisma.helpTopic.findFirst({
      where: {
        topic: { equals: name, mode: 'insensitive' },
        topic_pid: parentId,
        ...(currentId ? { topic_id: { not: currentId } } : {}),
      },
      select: { topic_id: true },
    });
    if (duplicate) throw new ConflictException('A help topic with that name already exists under the selected parent.');

    const status: TopicStatus = ['active', 'disabled', 'archived'].includes(String(data.status))
      ? String(data.status) as TopicStatus
      : current
        ? statusFromFlags(current.flags)
        : 'active';
    const isPublic = data.isPublic === undefined && data.ispublic === undefined && data.public === undefined
      ? current
        ? Boolean(current.ispublic)
        : true
      : Boolean(data.isPublic ?? data.ispublic ?? data.public);
    const customNumbers = Boolean(data.customNumbers ?? data['custom-numbers'] ?? data.numberFormat);
    const numberFormat = asString(data.numberFormat ?? data.number_format).trim();
    if (customNumbers && numberFormat && !/(?<!\\)#/.test(numberFormat)) {
      throw new ConflictException('The ticket number format requires at least one hash character (#).');
    }
    if (numberFormat.length > 20) throw new ConflictException('The ticket number format cannot exceed 20 characters.');

    const selections = await this.validateSelections({
      ...data,
      sequenceId: customNumbers ? data.sequenceId : 0,
      staffId: data.staffId,
      teamId: data.teamId,
    });

    if (currentId) {
      if (status !== 'active') {
        const otherTopics = await this.prisma.helpTopic.findMany({
          where: { topic_id: { not: currentId } },
          select: { flags: true },
        });
        if (!otherTopics.some(topic => asNumber(topic.flags) & FLAG_ACTIVE)) {
          throw new ConflictException('At least one help topic must remain active.');
        }
      }
      if (!isPublic) {
        const otherPublic = await this.prisma.helpTopic.count({
          where: { topic_id: { not: currentId }, ispublic: 1 },
        });
        if (!otherPublic) throw new ConflictException('At least one help topic must remain public.');
      }
    }

    const oldFlags = asNumber(current?.flags);
    let flags = oldFlags & ~(FLAG_ACTIVE | FLAG_ARCHIVED);
    if (status === 'active') flags |= FLAG_ACTIVE;
    if (status === 'archived') flags |= FLAG_ARCHIVED;
    if (customNumbers) flags |= FLAG_CUSTOM_NUMBERS;
    else flags &= ~FLAG_CUSTOM_NUMBERS;

    const values = {
      topic: name,
      topic_pid: parentId,
      ispublic: isPublic ? 1 : 0,
      noautoresp: data.noautoresp === true || data.disableAutoResponse === true ? 1 : 0,
      flags,
      status_id: selections.statusId,
      priority_id: selections.priorityId,
      dept_id: selections.deptId,
      staff_id: selections.staffId,
      team_id: selections.teamId,
      sla_id: selections.slaId,
      page_id: selections.pageId,
      sequence_id: customNumbers ? selections.sequenceId : 0n,
      number_format: numberFormat || null,
      notes: asString(data.notes ?? data.hint).trim() || null,
      updated: now(),
    };

    const lookups = await this.loadLookups();
    return this.prisma.$transaction(async tx => {
      let saved: any;
      if (currentId) {
        saved = await tx.helpTopic.update({ where: { topic_id: currentId }, data: values });
      } else {
        const maxSort = await tx.helpTopic.aggregate({ _max: { sort: true } });
        saved = await tx.helpTopic.create({
          data: { ...values, sort: BigInt(Number(maxSort._max.sort || 0) + 1), created: now() },
        });
      }
      await this.saveForms(tx, saved.topic_id, data.forms, lookups, !currentId);
      const links = await tx.helpTopicForm.findMany({ where: { topic_id: saved.topic_id }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
      return { saved: true, id: asString(saved.topic_id), topic: this.topicView(saved, lookups, links) };
    });
  }

  private async deleteTopic(tx: any, topicId: bigint) {
    const topic = await tx.helpTopic.findUnique({ where: { topic_id: topicId } });
    if (!topic) return false;
    const defaultTopic = await tx.config.findUnique({ where: { namespace_key: { namespace: 'core', key: 'default_topic_id' } } });
    if (defaultTopic && Number(defaultTopic.value) === Number(topicId)) {
      throw new ConflictException('The system default help topic cannot be deleted.');
    }
    await tx.helpTopic.updateMany({ where: { topic_pid: topicId }, data: { topic_pid: 0n, updated: now() } });
    await tx.faqTopic.deleteMany({ where: { topic_id: topicId } });
    await tx.ticket.updateMany({ where: { topic_id: topicId }, data: { topic_id: 0n, updated: now() } });
    await tx.helpTopicForm.deleteMany({ where: { topic_id: topicId } });
    await tx.helpTopic.delete({ where: { topic_id: topicId } });
    return true;
  }

  async remove(rawId: string) {
    const topicId = asKey(rawId);
    const exists = await this.prisma.helpTopic.findUnique({ where: { topic_id: topicId }, select: { topic_id: true } });
    if (!exists) throw new NotFoundException('Help topic not found.');
    await this.prisma.$transaction(tx => this.deleteTopic(tx, topicId));
    return { deleted: true };
  }

  async massAction(action: string, ids: unknown[]) {
    const topicIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(asKey).filter(id => id > 0n)));
    if (!topicIds.length) throw new ConflictException('No help topics selected.');
    const topics = await this.prisma.helpTopic.findMany({ where: { topic_id: { in: topicIds } } });
    if (!topics.length) throw new ConflictException('No matching help topics found.');

    if (action === 'delete') {
      const result = await this.prisma.$transaction(async tx => {
        let deleted = 0;
        let skipped = 0;
        for (const topic of topics) {
          try {
            if (await this.deleteTopic(tx, topic.topic_id)) deleted++;
            else skipped++;
          } catch (error) {
            if (error instanceof ConflictException) skipped++;
            else throw error;
          }
        }
        return { deleted, skipped };
      });
      return result;
    }

    if (!['enable', 'disable', 'archive'].includes(action)) {
      throw new ConflictException('Unknown action: ' + action);
    }

    const nextFlags = new Map<string, number>();
    for (const topic of topics) {
      let flags = asNumber(topic.flags) & ~(FLAG_ACTIVE | FLAG_ARCHIVED);
      if (action === 'enable') flags |= FLAG_ACTIVE;
      if (action === 'archive') flags |= FLAG_ARCHIVED;
      nextFlags.set(asString(topic.topic_id), flags);
    }
    const others = await this.prisma.helpTopic.findMany({
      where: { topic_id: { notIn: topics.map(topic => topic.topic_id) } },
      select: { flags: true },
    });
    const remainingActive = others.some(topic => asNumber(topic.flags) & FLAG_ACTIVE);
    if (!remainingActive && !Array.from(nextFlags.values()).some(flags => flags & FLAG_ACTIVE)) {
      throw new ConflictException('At least one help topic must remain active.');
    }

    await this.prisma.$transaction(topics.map(topic => this.prisma.helpTopic.update({
      where: { topic_id: topic.topic_id },
      data: { flags: nextFlags.get(asString(topic.topic_id)), updated: now() },
    })));
    return { updated: topics.length };
  }

  async publicList() {
    const [topics, departments, priorities, slas, links, forms, fields, lists, listItems] = await Promise.all([
      this.prisma.helpTopic.findMany({ orderBy: [{ sort: 'asc' }, { topic: 'asc' }] }),
      this.prisma.department.findMany({ where: { ispublic: 1 }, orderBy: { name: 'asc' } }),
      this.prisma.ticketPriority.findMany({ orderBy: { priority_urgency: 'asc' } }),
      this.prisma.sla.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.helpTopicForm.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.form.findMany(),
      this.prisma.formField.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.list.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.listItems.findMany({ where: { status: 1n }, orderBy: [{ list_id: 'asc' }, { sort: 'asc' }] }),
    ]);
    // Ensure legacy zero-flag rows are active *before* filtering the public list.
    if (topics.length && topics.every(topic => asNumber(topic.flags) === 0)) {
      await this.prisma.helpTopic.updateMany({ data: { flags: FLAG_ACTIVE } });
      for (const topic of topics) topic.flags = FLAG_ACTIVE;
    }

    const byId = new Map(topics.map(topic => [asString(topic.topic_id), topic]));
    const activeById = new Map(topics.map(topic => [asString(topic.topic_id), statusFromFlags(topic.flags) === 'active']));
    const nameById = new Map<string, string>();
    const resolveName = (topic: any, seen = new Set<string>()): string => {
      const id = asString(topic.topic_id);
      if (nameById.has(id)) return nameById.get(id) as string;
      if (seen.has(id) || !topic.topic_pid) {
        nameById.set(id, topic.topic);
        return topic.topic;
      }
      seen.add(id);
      const parent = byId.get(asString(topic.topic_pid));
      const name = parent ? `${resolveName(parent, seen)} / ${topic.topic}` : topic.topic;
      nameById.set(id, name);
      return name;
    };
    const ancestorsActive = (topic: any) => {
      const seen = new Set<string>();
      let cursor = topic;
      while (cursor && cursor.topic_pid) {
        const parent = byId.get(asString(cursor.topic_pid));
        if (!parent || !activeById.get(asString(parent.topic_id))) return false;
        if (seen.has(asString(parent.topic_id))) break;
        seen.add(asString(parent.topic_id));
        cursor = parent;
      }
      return true;
    };

    const priorityById = new Map(priorities.map(row => [asString(row.priority_id), row.priority]));
    const slaById = new Map(slas.map(row => [asString(row.id), row.name]));
    const departmentById = new Map(departments.map(row => [asString(row.id), row.name]));
    const formById = new Map(forms.map(row => [asString(row.id), row]));

    // Build list items map for select/dropdown fields
    const listItemsByListId = new Map<string, Array<{ id: string; value: string; sort: number }>>();
    for (const item of listItems) {
      const lid = asString(item.list_id);
      const arr = listItemsByListId.get(lid) || [];
      arr.push({ id: asString(item.id), value: item.value, sort: item.sort });
      listItemsByListId.set(lid, arr);
    }

    const publicTopics = topics
      .filter(topic => Boolean(topic.ispublic))
      .filter(topic => statusFromFlags(topic.flags) === 'active' && ancestorsActive(topic))
      .map(topic => {
        const topicForms = links
          .filter(link => link.topic_id === topic.topic_id)
          .map(link => {
            const form = formById.get(asString(link.form_id));
            const disabledFieldIds = Array.isArray(parseExtra(link.extra).disable)
              ? (parseExtra(link.extra).disable as unknown[]).map(asString)
              : [];
            return {
              formId: asString(link.form_id),
              title: form?.title || '',
              instructions: form?.instructions || '',
              type: form?.type || '',
              disabledFieldIds,
              fields: fields
                .filter(field => field.form_id === link.form_id && !disabledFieldIds.includes(asString(field.id)))
                .map(field => {
                  const fl = asNumber(field.flags);
                  // FLAG_CLIENT_VIEW = 0x00100; only expose fields visible to clients
                  const clientVisible = Boolean(fl & 0x00100) || fl === 0;
                  if (!clientVisible) return null;
                  let configObj: Record<string, unknown> = {};
                  try { if (field.configuration) configObj = JSON.parse(field.configuration); } catch { /* ignore */ }
                  const listId = asString(configObj.list_id || configObj.typeahead || '');
                  const listOptions = listId ? (listItemsByListId.get(listId) || []) : [];
                  return {
                    id: asString(field.id),
                    label: field.label || '',
                    name: field.name || '',
                    type: field.type || 'text',
                    hint: field.hint || '',
                    flags: fl,
                    required: Boolean(fl & 0x00400), // FLAG_CLIENT_REQUIRED
                    configuration: configObj,
                    listId,
                    listOptions,
                    disabled: false,
                  };
                })
                .filter(Boolean),
            };
          });
        return {
          id: asString(topic.topic_id),
          name: resolveName(topic),
          topic: topic.topic,
          parentId: asString(topic.topic_pid),
          deptId: asString(topic.dept_id),
          departmentName: departmentById.get(asString(topic.dept_id)) || '',
          priorityId: asString(topic.priority_id),
          priority: (priorityById.get(asString(topic.priority_id)) || 'normal').toLowerCase(),
          slaId: asString(topic.sla_id),
          slaName: slaById.get(asString(topic.sla_id)) || '',
          hint: '',
          active: true,
          status: 'active',
          isPublic: true,
          public: true,
          forms: topicForms,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      topics: publicTopics,
      departments: departments
        .filter(row => !(asNumber(row.flags) & 8))
        .map(row => ({ id: asString(row.id), name: row.name })),
    };
  }
}

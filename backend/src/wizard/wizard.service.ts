import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const asKey = (value: unknown) => BigInt(String(value || 0));
const asNumber = (value: unknown) => Number(value || 0);
const asString = (value: unknown) => String(value ?? '');

@Injectable()
export class WizardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Retrieves all metadata required for the interactive wizard:
   * - Public Help Topics (with department and priority)
   * - Public FAQ Categories with article counts
   * - Featured & Popular FAQs
   * - Active Branches
   * - System / Portal config settings
   */
  async getWizardMeta() {
    const [rawTopics, departments, priorities, rawCategories, faqs, branches, configRows] = await Promise.all([
      this.prisma.helpTopic.findMany({
        where: { ispublic: 1 },
        orderBy: [{ sort: 'asc' }, { topic: 'asc' }],
      }),
      this.prisma.department.findMany({
        where: { ispublic: 1 },
        orderBy: { name: 'asc' },
      }),
      this.prisma.ticketPriority.findMany({
        orderBy: { priority_urgency: 'asc' },
      }),
      this.prisma.faqCategory.findMany({
        where: { ispublic: 1 },
        orderBy: { name: 'asc' },
      }),
      this.prisma.faq.findMany({
        where: { ispublished: 1 },
        orderBy: { updated: 'desc' },
      }),
      this.prisma.branch.findMany({
        where: { active: 1 },
        orderBy: { name: 'asc' },
      }),
      this.prisma.config.findMany({
        where: {
          namespace: { in: ['react_app_state', 'core'] },
        },
      }),
    ]);

    const deptMap = new Map(departments.map((d) => [asString(d.id), d.name]));
    const priorityMap = new Map(priorities.map((p) => [p.priority_id, p.priority]));

    // Format help topics
    const topics = rawTopics.map((t) => {
      const deptName = deptMap.get(asString(t.dept_id)) || 'General Support';
      const priorityName = priorityMap.get(Number(t.priority_id)) || 'normal';
      return {
        id: asString(t.topic_id),
        name: t.topic,
        deptId: asString(t.dept_id),
        departmentName: deptName,
        priority: priorityName,
        slaId: asString(t.sla_id),
        hint: t.notes || '',
        active: Boolean(t.ispublic),
      };
    });

    // Format FAQ categories with article count
    const faqCountByCategory = new Map<string, number>();
    for (const faq of faqs) {
      const catId = asString(faq.category_id);
      faqCountByCategory.set(catId, (faqCountByCategory.get(catId) || 0) + 1);
    }

    const categories = rawCategories.map((c) => ({
      id: asString(c.category_id),
      name: c.name || '',
      description: c.description || '',
      articleCount: faqCountByCategory.get(asString(c.category_id)) || 0,
    }));

    // Featured FAQs (top 6 published)
    const featuredFaqs = faqs.slice(0, 6).map((f) => ({
      id: asString(f.faq_id),
      categoryId: asString(f.category_id),
      question: f.question,
      answer: f.answer,
      keywords: f.keywords || '',
      updatedAt: f.updated,
    }));

    // Active branches
    const formattedBranches = branches.map((b) => ({
      id: asString(b.id),
      name: b.name,
    }));

    // Settings
    const settings: Record<string, any> = {};
    for (const row of configRows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }

    return {
      topics,
      categories,
      featuredFaqs,
      branches: formattedBranches,
      settings: {
        helpdeskName: settings.helpdeskName || settings.helpdesk_title || 'Helpdesk Support',
        companyName: settings.companyName || settings.helpdesk_title || 'Support Center',
        landingPageMessage: settings.landingPageMessage || '',
        allowGuestTickets: settings.allowGuestTickets !== false,
      },
    };
  }

  /**
   * Search or filter FAQs by query string, categoryId, or topicId
   */
  async getFaqs(params: { query?: string; categoryId?: string; topicId?: string }) {
    const { query, categoryId, topicId } = params;

    // If searching by topic, see if mapped in FaqTopic or match words
    if (topicId) {
      const topicBigInt = asKey(topicId);
      const mappings = await this.prisma.faqTopic.findMany({
        where: { topic_id: topicBigInt },
      });

      if (mappings.length > 0) {
        const faqIds = mappings.map((m) => m.faq_id);
        const mappedFaqs = await this.prisma.faq.findMany({
          where: { faq_id: { in: faqIds }, ispublished: 1 },
          orderBy: { question: 'asc' },
        });
        if (mappedFaqs.length > 0) {
          return mappedFaqs.map((f) => ({
            id: asString(f.faq_id),
            categoryId: asString(f.category_id),
            question: f.question,
            answer: f.answer,
            keywords: f.keywords || '',
          }));
        }
      }

      // If no explicit mapping, search by topic keyword
      const topic = await this.prisma.helpTopic.findUnique({
        where: { topic_id: asNumber(topicId) },
      });
      if (topic) {
        const words = topic.topic.split(/\s+/).filter((w) => w.length > 3);
        const orConditions = words.map((w) => ({
          OR: [
            { question: { contains: w, mode: 'insensitive' as const } },
            { keywords: { contains: w, mode: 'insensitive' as const } },
            { answer: { contains: w, mode: 'insensitive' as const } },
          ],
        }));
        if (orConditions.length > 0) {
          const matchedFaqs = await this.prisma.faq.findMany({
            where: {
              ispublished: 1,
              OR: orConditions.flatMap((c) => c.OR),
            },
            take: 5,
          });
          if (matchedFaqs.length > 0) {
            return matchedFaqs.map((f) => ({
              id: asString(f.faq_id),
              categoryId: asString(f.category_id),
              question: f.question,
              answer: f.answer,
              keywords: f.keywords || '',
            }));
          }
        }
      }
    }

    if (categoryId) {
      const categoryFaqs = await this.prisma.faq.findMany({
        where: {
          category_id: asKey(categoryId),
          ispublished: 1,
        },
        orderBy: { question: 'asc' },
      });
      return categoryFaqs.map((f) => ({
        id: asString(f.faq_id),
        categoryId: asString(f.category_id),
        question: f.question,
        answer: f.answer,
        keywords: f.keywords || '',
      }));
    }

    if (query && query.trim()) {
      const cleanQuery = query.trim();
      const queriedFaqs = await this.prisma.faq.findMany({
        where: {
          ispublished: 1,
          OR: [
            { question: { contains: cleanQuery, mode: 'insensitive' } },
            { answer: { contains: cleanQuery, mode: 'insensitive' } },
            { keywords: { contains: cleanQuery, mode: 'insensitive' } },
          ],
        },
        take: 8,
      });
      return queriedFaqs.map((f) => ({
        id: asString(f.faq_id),
        categoryId: asString(f.category_id),
        question: f.question,
        answer: f.answer,
        keywords: f.keywords || '',
      }));
    }

    // Default: Return published FAQs
    const defaultFaqs = await this.prisma.faq.findMany({
      where: { ispublished: 1 },
      orderBy: { updated: 'desc' },
      take: 12,
    });
    return defaultFaqs.map((f) => ({
      id: asString(f.faq_id),
      categoryId: asString(f.category_id),
      question: f.question,
      answer: f.answer,
      keywords: f.keywords || '',
    }));
  }

  /**
   * Interactive ticket lookup by ticket number and requester email
   */
  async checkTicketStatus(ticketNumber: string, email: string) {
    const num = String(ticketNumber || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!num || !normalizedEmail) {
      throw new BadRequestException('Ticket number and email address are required.');
    }

    const ticket = await this.prisma.ticket.findFirst({
      where: { number: num },
    });

    if (!ticket) {
      return { found: false, message: `No ticket found with number #${num}.` };
    }

    // Verify ownership by checking user email or address
    let isOwner = false;
    let ownerEmail = '';
    let ownerName = '';

    const userEmailRow = await this.prisma.userEmail.findFirst({
      where: { user_id: ticket.user_id },
    });

    if (userEmailRow && userEmailRow.address.toLowerCase() === normalizedEmail) {
      isOwner = true;
      ownerEmail = userEmailRow.address;
    } else {
      // Check user directly
      const user = await this.prisma.user.findUnique({
        where: { id: ticket.user_id },
      });
      if (user) {
        ownerName = user.name;
        // Also check if any UserEmail matches
        const anyUserEmail = await this.prisma.userEmail.findFirst({
          where: { address: { equals: normalizedEmail, mode: 'insensitive' } },
        });
        if (anyUserEmail && anyUserEmail.user_id === ticket.user_id) {
          isOwner = true;
          ownerEmail = anyUserEmail.address;
        }
      }
    }

    // Also check thread collaborators
    if (!isOwner) {
      const thread = await this.prisma.thread.findUnique({
        where: { object_id_object_type: { object_id: ticket.ticket_id, object_type: 'T' } },
      });
      if (thread) {
        const collab = await this.prisma.threadCollaborator.findFirst({
          where: {
            thread_id: Number(thread.id),
            role: 'C',
          },
        });
        if (collab) {
          const collabUserEmail = await this.prisma.userEmail.findFirst({
            where: { user_id: BigInt(collab.user_id) },
          });
          if (collabUserEmail && collabUserEmail.address.toLowerCase() === normalizedEmail) {
            isOwner = true;
            ownerEmail = collabUserEmail.address;
          }
        }
      }
    }

    if (!isOwner) {
      return {
        found: false,
        message: 'The email address does not match the requester for this ticket.',
      };
    }

    // Fetch related records using Prisma
    const [status, cdata, dept, thread] = await Promise.all([
      this.prisma.ticketStatus.findUnique({ where: { id: ticket.status_id } }),
      this.prisma.ticketCdata.findUnique({ where: { ticket_id: ticket.ticket_id } }),
      this.prisma.department.findUnique({ where: { id: ticket.dept_id } }),
      this.prisma.thread.findUnique({
        where: { object_id_object_type: { object_id: ticket.ticket_id, object_type: 'T' } },
      }),
    ]);

    let messageCount = 1;
    let lastMessageSnippet = '';
    if (thread) {
      const entries = await this.prisma.threadEntry.findMany({
        where: { thread_id: thread.id, type: { not: 'N' } },
        orderBy: { created: 'desc' },
        take: 1,
      });
      messageCount = await this.prisma.threadEntry.count({
        where: { thread_id: thread.id, type: { not: 'N' } },
      });
      if (entries.length > 0) {
        lastMessageSnippet = entries[0].body.slice(0, 140);
      }
    }

    const state = status?.state?.toLowerCase() || 'open';
    const isClosed = state === 'closed' || Boolean(ticket.closed);

    return {
      found: true,
      ticket: {
        id: asString(ticket.ticket_id),
        number: ticket.number,
        subject: cdata?.subject || `Support Case #${ticket.number}`,
        priority: cdata?.priority || 'normal',
        status: status?.name || (isClosed ? 'Closed' : 'Open'),
        statusState: state,
        department: dept?.name || 'Support Desk',
        requesterName: ownerName || 'Requester',
        requesterEmail: ownerEmail || normalizedEmail,
        createdAt: ticket.created,
        updatedAt: ticket.updated,
        lastActivity: thread?.lastmessage || ticket.lastupdate || ticket.updated,
        messageCount,
        lastMessageSnippet,
        isClosed,
      },
    };
  }
}

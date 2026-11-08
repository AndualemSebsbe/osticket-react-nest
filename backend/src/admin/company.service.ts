import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const CORE = 'core';
const COMPANY_TYPE = 'C';
const PAGE_TYPES = ['landing', 'offline', 'thank-you'] as const;
const PAGE_CONFIG_KEYS: Record<(typeof PAGE_TYPES)[number], string> = {
  landing: 'landing_page_id',
  offline: 'offline_page_id',
  'thank-you': 'thank-you_page_id',
};
const DEFAULT_FIELDS = [
  { name: 'name', label: 'Company Name', type: 'text', sort: 1n, flags: BigInt('0x471B1'), configuration: { size: 40, length: 64 } },
  { name: 'website', label: 'Website', type: 'text', sort: 2n, flags: BigInt('0x43111'), configuration: { size: 40, length: 64 } },
  { name: 'phone', label: 'Phone Number', type: 'phone', sort: 3n, flags: BigInt('0x43111'), configuration: { ext: false } },
  { name: 'address', label: 'Address', type: 'memo', sort: 4n, flags: BigInt('0x3101'), configuration: { rows: 2, cols: 40, html: false, length: 100 } },
];
const DEFAULT_PAGES: Array<{ type: (typeof PAGE_TYPES)[number]; name: string; body: string }> = [
  { type: 'landing', name: 'Landing Page', body: '<p>Welcome to our support center. Open a ticket or browse the knowledge base to find an answer.</p>' },
  { type: 'offline', name: 'Offline Page', body: '<p>Our support center is temporarily offline for maintenance. Please check back shortly.</p>' },
  { type: 'thank-you', name: 'Thank You Page', body: '<p>Thank you for contacting us. Your request has been received and we will reply as soon as possible.</p>' },
];
const IMAGE_MIME_TYPES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/pjpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);

function parseJson(value?: string | null): Record<string, any> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function numericId(value: unknown): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) return 0n;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      candidate = trimmed;
    }
  }
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? BigInt(parsed) : 0n;
}

function configId(value?: string | null): string {
  const id = numericId(value);
  return id ? String(id) : '0';
}

function imageLooksValid(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') return true;
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return true;
  return false;
}

@Injectable()
export class CompanyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private stamp() {
    return new Date();
  }

  private async ensureCompanyForm(tx: any) {
    let form = await tx.form.findFirst({ where: { type: COMPANY_TYPE } });
    if (!form) {
      form = await tx.form.create({
        data: {
          type: COMPANY_TYPE,
          title: 'Company Information',
          instructions: 'Details available in email templates',
          name: 'company',
          flags: 0n,
          created: this.stamp(),
          updated: this.stamp(),
        },
      });
    }
    const fields = await tx.formField.findMany({ where: { form_id: form.id } });
    const existing = new Set(fields.map((field: any) => field.name));
    for (const field of DEFAULT_FIELDS) {
      if (existing.has(field.name)) continue;
      await tx.formField.create({
        data: {
          form_id: form.id,
          type: field.type,
          label: field.label,
          name: field.name,
          flags: field.flags,
          sort: field.sort,
          configuration: JSON.stringify(field.configuration),
          created: this.stamp(),
          updated: this.stamp(),
        },
      });
    }
    return form;
  }

  private async ensureEntry(tx: any, formId: bigint) {
    let entry = await tx.formEntry.findFirst({ where: { form_id: formId, object_type: COMPANY_TYPE } });
    if (!entry) {
      entry = await tx.formEntry.create({
        data: {
          form_id: formId,
          object_id: 0n,
          object_type: COMPANY_TYPE,
          sort: 1n,
          created: this.stamp(),
          updated: this.stamp(),
        },
      });
    }
    return entry;
  }

  /**
   * Make sure the site-page pickers always have something to choose from on a
   * fresh install, mirroring the pages used by the React site seed.
   */
  private async ensurePages(tx: any) {
    let pages = await tx.content.findMany({
      where: { type: { in: [...PAGE_TYPES] } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    if (!pages.length) {
      for (const page of DEFAULT_PAGES) {
        await tx.content.create({
          data: {
            type: page.type,
            name: page.name,
            body: page.body,
            isactive: 1,
            created: this.stamp(),
            updated: this.stamp(),
          },
        });
      }
      pages = await tx.content.findMany({
        where: { type: { in: [...PAGE_TYPES] } },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });
    }
    return pages;
  }

  private async readCoreConfig(tx: any) {
    const rows = await tx.config.findMany({
      where: {
        namespace: CORE,
        key: {
          in: [
            ...Object.values(PAGE_CONFIG_KEYS),
            'client_logo_id',
            'staff_logo_id',
            'staff_backdrop_id',
          ],
        },
      },
    });
    return new Map<string, string>(rows.map((row: any) => [String(row.key), String(row.value ?? '')]));
  }

  private pageView(page: any) {
    return {
      id: String(page.id),
      name: page.name || '',
      type: page.type || 'other',
      active: Boolean(page.isactive),
      body: page.body || '',
    };
  }

  private imageView(file: any) {
    return {
      id: String(file.id),
      name: file.name || '',
      type: file.type || 'image/png',
      size: Number(file.size || 0),
      created: file.created instanceof Date ? file.created.toISOString() : String(file.created || ''),
      url: '/api/v1/company/files/' + encodeURIComponent(String(file.id)),
    };
  }

  async getSettings() {
    return this.prisma.$transaction(async (tx) => {
      const form = await this.ensureCompanyForm(tx);
      const entry = await this.ensureEntry(tx, form.id);
      const pages = await this.ensurePages(tx);
      const fields = await tx.formField.findMany({ where: { form_id: form.id }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
      const values = await tx.formEntryValues.findMany({ where: { entry_id: entry.id } });
      const config = await this.readCoreConfig(tx);
      const logos = await tx.file.findMany({ where: { ft: 'L' }, orderBy: { created: 'asc' } });
      const backdrops = await tx.file.findMany({ where: { ft: 'B' }, orderBy: { created: 'asc' } }).catch(() => []);

      const valueByField = new Map<string, string>((values as any[]).map((row: any) => [String(row.field_id), String(row.value ?? '')]));
      const selectedPages: Record<string, string> = {};
      for (const type of PAGE_TYPES) {
        const key = PAGE_CONFIG_KEYS[type];
        if (!config.has(key)) {
          const fallback = (pages as any[]).find((page: any) => String(page.type).toLowerCase() === type);
          if (fallback) {
            const value = String(fallback.id);
            config.set(key, value);
            await tx.config.upsert({
              where: { namespace_key: { namespace: CORE, key } },
              create: { namespace: CORE, key, value, updated: this.stamp() },
              update: { value, updated: this.stamp() },
            });
          }
        }
        selectedPages[key] = configId(config.get(key));
      }

      return {
        form: {
          id: String(form.id),
          title: form.title || 'Company Information',
          instructions: form.instructions || '',
          notes: form.notes || '',
        },
        entryId: String(entry.id),
        fields: (fields as any[]).map((field: any) => {
          const configuration = parseJson(field.configuration);
          return {
            id: String(field.id),
            name: field.name || '',
            label: field.label || field.name || '',
            type: field.type || 'text',
            hint: field.hint || '',
            sort: Number(field.sort || 0),
            configuration,
            value: valueByField.get(String(field.id)) || '',
          };
        }),
        pages: (pages as any[]).map((page: any) => this.pageView(page)),
        selected: {
          landingPageId: selectedPages.landing_page_id,
          offlinePageId: selectedPages.offline_page_id,
          thankYouPageId: selectedPages['thank-you_page_id'],
          clientLogoId: configId(config.get('client_logo_id')),
          staffLogoId: configId(config.get('staff_logo_id')),
          staffBackdropId: configId(config.get('staff_backdrop_id')),
        },
        logos: (logos as any[]).map((file: any) => this.imageView(file)),
        backdrops: (backdrops as any[]).map((file: any) => this.imageView(file)),
      };
    });
  }

  private async validPage(tx: any, value: unknown, type: (typeof PAGE_TYPES)[number], label: string) {
    const id = numericId(value);
    if (!id) return 0n;
    const page = await tx.content.findFirst({ where: { id, type } });
    if (!page) throw new BadRequestException('Select a valid ' + label + '.');
    return page.id;
  }

  private async validImage(tx: any, value: unknown, fileType: 'L' | 'B', label: string) {
    const id = numericId(value);
    if (!id) return 0n;
    const file = await tx.file.findFirst({ where: { id, ft: fileType } });
    if (!file) throw new BadRequestException('Select a valid ' + label + '.');
    return file.id;
  }

  private async setConfig(tx: any, key: string, value: string) {
    await tx.config.upsert({
      where: { namespace_key: { namespace: CORE, key } },
      create: { namespace: CORE, key, value, updated: this.stamp() },
      update: { value, updated: this.stamp() },
    });
  }

  async saveSettings(body: any) {
    const input = body && typeof body === 'object' ? body : {};
    const submittedValues = input.values && typeof input.values === 'object' ? input.values : {};

    await this.prisma.$transaction(async (tx) => {
      const form = await this.ensureCompanyForm(tx);
      const entry = await this.ensureEntry(tx, form.id);
      const fields = await tx.formField.findMany({ where: { form_id: form.id } });

      for (const field of fields as any[]) {
        if (!Object.prototype.hasOwnProperty.call(submittedValues, field.name)) continue;
        const raw = submittedValues[field.name];
        const value = raw === null || raw === undefined ? '' : String(raw).trim();
        const configuration = parseJson(field.configuration);
        const maxLength = Number(configuration.length);
        if (Number.isInteger(maxLength) && maxLength > 0 && value.length > maxLength) {
          throw new BadRequestException(field.label + ' must be ' + maxLength + ' characters or fewer.');
        }
        await tx.formEntryValues.upsert({
          where: { entry_id_field_id: { entry_id: entry.id, field_id: field.id } },
          create: { entry_id: entry.id, field_id: field.id, value: value || null },
          update: { value: value || null },
        });
      }
      await tx.formEntry.update({ where: { id: entry.id }, data: { updated: this.stamp() } });

      const landingPageId = await this.validPage(tx, input.landingPageId, 'landing', 'landing page');
      const offlinePageId = await this.validPage(tx, input.offlinePageId, 'offline', 'offline page');
      const thankYouPageId = await this.validPage(tx, input.thankYouPageId, 'thank-you', 'thank-you page');
      const clientLogoId = await this.validImage(tx, input.clientLogoId, 'L', 'client logo');
      const staffLogoId = await this.validImage(tx, input.staffLogoId, 'L', 'staff logo');
      const staffBackdropId = await this.validImage(tx, input.staffBackdropId, 'B', 'login backdrop');

      await this.setConfig(tx, PAGE_CONFIG_KEYS.landing, String(landingPageId));
      await this.setConfig(tx, PAGE_CONFIG_KEYS.offline, String(offlinePageId));
      await this.setConfig(tx, PAGE_CONFIG_KEYS['thank-you'], String(thankYouPageId));
      await this.setConfig(tx, 'client_logo_id', String(clientLogoId));
      await this.setConfig(tx, 'staff_logo_id', String(staffLogoId));
      await this.setConfig(tx, 'staff_backdrop_id', String(staffBackdropId));

      const selected = new Set([clientLogoId, staffLogoId, staffBackdropId].filter(Boolean).map(String));
      const deleteLogoIds = Array.isArray(input.deleteLogoIds) ? input.deleteLogoIds : [];
      const deleteBackdropIds = Array.isArray(input.deleteBackdropIds) ? input.deleteBackdropIds : [];
      const candidates = [...deleteLogoIds, ...deleteBackdropIds]
        .map((value) => numericId(value))
        .filter((id) => id > 0n && !selected.has(String(id)));
      const unique = [...new Map(candidates.map((id) => [String(id), id])).values()];
      if (unique.length) {
        const files = await tx.file.findMany({ where: { id: { in: unique }, ft: { in: ['L', 'B'] } } });
        for (const file of files as any[]) {
          if (selected.has(String(file.id))) continue;
          await tx.fileChunk.deleteMany({ where: { file_id: file.id } });
          await tx.file.delete({ where: { id: file.id } });
        }
      }
    });

    return { saved: true };
  }

  async uploadImage(kind: string, file: any) {
    const fileType: 'L' | 'B' | null = kind === 'logo' ? 'L' : kind === 'backdrop' ? 'B' : null;
    if (!fileType) throw new BadRequestException('Choose whether to upload a logo or a login backdrop.');
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image to upload.');
    const buffer: Buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
    if (buffer.length > 5 * 1024 * 1024) throw new BadRequestException('Images must be 5 MB or smaller.');
    const mime = String(file.mimetype || '').toLowerCase();
    if (!IMAGE_MIME_TYPES.has(mime)) throw new BadRequestException('Upload a PNG, JPEG, GIF, or WebP image.');
    if (!imageLooksValid(buffer)) throw new BadRequestException('The uploaded file is not a valid image.');

    const original = String(file.originalname || 'image').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 255);
    const name = /\.[a-z0-9]{2,5}$/i.test(original) ? original : original + '.' + IMAGE_MIME_TYPES.get(mime);
    const created = this.stamp();
    const row = await this.prisma.$transaction(async (tx) => {
      const createdFile = await tx.file.create({
        data: {
          ft: fileType,
          bk: 'D',
          name,
          type: mime,
          size: BigInt(buffer.length),
          key: randomBytes(32).toString('hex'),
          signature: createHash('sha256').update(buffer).digest('hex'),
          created,
        },
      });
      await tx.fileChunk.create({ data: { file_id: createdFile.id, chunk_id: 0, filedata: Uint8Array.from(buffer) } });
      return createdFile;
    });
    return this.imageView(row);
  }

  /** Public, unauthenticated – returns only the active logo / backdrop IDs. */
  async getPublicBranding() {
    const rows = await this.prisma.config.findMany({
      where: {
        namespace: CORE,
        key: { in: ['client_logo_id', 'staff_logo_id', 'staff_backdrop_id'] },
      },
    });
    const config = new Map<string, string>(rows.map((row: any) => [String(row.key), String(row.value ?? '')]));
    return {
      clientLogoId: configId(config.get('client_logo_id')),
      staffLogoId: configId(config.get('staff_logo_id')),
      staffBackdropId: configId(config.get('staff_backdrop_id')),
    };
  }

  async getFile(id: string) {
    const fileId = numericId(id);
    if (!fileId) throw new NotFoundException('Image not found.');
    const file = await this.prisma.file.findFirst({ where: { id: fileId, ft: { in: ['L', 'B'] } } });
    if (!file) throw new NotFoundException('Image not found.');
    const chunks = await this.prisma.fileChunk.findMany({ where: { file_id: file.id }, orderBy: { chunk_id: 'asc' } });
    return {
      name: file.name || 'image',
      type: file.type || 'application/octet-stream',
      data: Buffer.concat(chunks.map((chunk: any) => Buffer.from(chunk.filedata))),
    };
  }
}

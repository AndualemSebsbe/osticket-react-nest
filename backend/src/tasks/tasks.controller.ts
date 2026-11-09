import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Put, Query, Res, UnauthorizedException, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { TasksService } from './tasks.service';
import { ApiSecurityService } from '../common/api-security.service';
import { AuthService } from '../auth/auth.service';

type Upload = { originalname: string; mimetype: string; buffer: Buffer; size: number };

@Controller('tasks')
export class TasksController {
  constructor(
    @Inject(TasksService) private tasks: TasksService,
    @Inject(ApiSecurityService) private security: ApiSecurityService,
    @Inject(AuthService) private auth: AuthService,
  ) {}

  private async staffAccount(token: string) {
    const session = await this.security.readSession(token);
    const account = session ? await this.auth.validateStaff(session.email) : null;
    if (!this.auth.sessionAccount(account, session, 'staff')) throw new UnauthorizedException('Active staff session required.');
    return account!;
  }

  private uploads(files: any[]): Upload[] {
    return (files || []).map(file => ({ originalname: file.originalname, mimetype: file.mimetype, buffer: file.buffer, size: file.size }));
  }

  /** Multipart requests may send a JSON `task` part instead of individual fields. */
  private payload(body: any, key: string) {
    if (!body) return {};
    const raw = body[key];
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { /* fall through to the raw body */ }
    }
    return body;
  }

  @Get()
  async list(@Headers('x-user-session') token: string, @Query() query: any) {
    const account = await this.staffAccount(token);
    return this.tasks.list(account.staffId, query || {});
  }

  @Get('options')
  async options(@Headers('x-user-session') token: string) {
    const account = await this.staffAccount(token);
    return this.tasks.options(account.staffId);
  }

  @Get(':id')
  async get(@Headers('x-user-session') token: string, @Param('id') id: string) {
    const account = await this.staffAccount(token);
    return this.tasks.get(account.staffId, id);
  }

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { files: 5, fileSize: 8 * 1024 * 1024 } }))
  async create(@Headers('x-user-session') token: string, @Body() body: any, @UploadedFiles() files: any[]) {
    const account = await this.staffAccount(token);
    return this.tasks.create(account.staffId, this.payload(body, 'task'), this.uploads(files));
  }

  @Patch(':id')
  @UseInterceptors(AnyFilesInterceptor({ limits: { files: 5, fileSize: 8 * 1024 * 1024 } }))
  async update(@Headers('x-user-session') token: string, @Param('id') id: string, @Body() body: any) {
    const account = await this.staffAccount(token);
    return this.tasks.update(account.staffId, id, this.payload(body, 'task'));
  }

  @Post(':id/close')
  async close(@Headers('x-user-session') token: string, @Param('id') id: string) {
    const account = await this.staffAccount(token);
    return this.tasks.setStatus(account.staffId, id, 'closed');
  }

  @Post(':id/reopen')
  async reopen(@Headers('x-user-session') token: string, @Param('id') id: string) {
    const account = await this.staffAccount(token);
    return this.tasks.setStatus(account.staffId, id, 'open');
  }

  @Delete(':id')
  async remove(@Headers('x-user-session') token: string, @Param('id') id: string) {
    const account = await this.staffAccount(token);
    return this.tasks.remove(account.staffId, id);
  }

  @Post(':id/messages')
  @UseInterceptors(AnyFilesInterceptor({ limits: { files: 5, fileSize: 8 * 1024 * 1024 } }))
  async message(@Headers('x-user-session') token: string, @Param('id') id: string, @Body() body: any, @UploadedFiles() files: any[]) {
    const account = await this.staffAccount(token);
    return this.tasks.postMessage(account.staffId, id, this.payload(body, 'message'), this.uploads(files));
  }

  @Put(':id/collaborators')
  async collaborators(@Headers('x-user-session') token: string, @Param('id') id: string, @Body() body: any) {
    const account = await this.staffAccount(token);
    const value = this.payload(body, 'collaborators');
    return this.tasks.setCollaborators(account.staffId, id, Array.isArray(value) ? value : value?.collaborators ?? value);
  }

  @Get(':id/attachments/:attachmentId')
  async attachment(@Headers('x-user-session') token: string, @Param('id') id: string, @Param('attachmentId') attachmentId: string, @Res() res: any) {
    const account = await this.staffAccount(token);
    const file = await this.tasks.attachment(account.staffId, id, attachmentId);
    res.setHeader('content-type', file.type);
    res.setHeader('content-disposition', 'attachment; filename="' + String(file.name || 'attachment').replace(/[^a-zA-Z0-9._ -]/g, '_') + '"');
    return res.send(file.data);
  }
}

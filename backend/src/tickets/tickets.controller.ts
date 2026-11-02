import { Inject, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Req, Res, UploadedFiles, UseInterceptors, UnauthorizedException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { AdvancedSearchService } from './advanced-search.service';
import { ApiSecurityService } from '../common/api-security.service';
import { AuthService } from '../auth/auth.service';
import { AnyFilesInterceptor } from '@nestjs/platform-express';

@Controller()
export class TicketsController {
  constructor(@Inject(TicketsService) private tickets: TicketsService, @Inject(AdvancedSearchService) private advancedSearch: AdvancedSearchService, @Inject(ApiSecurityService) private security: ApiSecurityService, @Inject(AuthService) private auth: AuthService) {}

  private async staffAccount(token: string) {
    const session = this.security.readSession(token);
    const account = session ? await this.auth.validateStaff(session.email) : null;
    if (!this.auth.sessionAccount(account, session, 'staff')) throw new UnauthorizedException('Active staff session required.');
    return account!;
  }
  @Get('users/tickets') async userTickets(@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateClient(session.email):null; if(!this.auth.sessionAccount(account,session,'client')) throw new UnauthorizedException('Session expired.'); const tickets=await this.tickets.listForClient(account!.user.email,account!.user.id); return { tickets, messages:tickets.flatMap((ticket:any)=>(ticket.messages||[]).map((message:any)=>({...message,ticketNumber:ticket.number}))) }; }
  @Get('tickets') async list(@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateStaff(session.email):null; if(!this.auth.sessionAccount(account,session,'staff')) throw new UnauthorizedException('Active staff session required.'); return this.tickets.listApi().then(tickets=>({tickets})); }
  @Get('tickets/queues') async queues(@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateStaff(session.email):null; if(!this.auth.sessionAccount(account,session,'staff')) throw new UnauthorizedException('Active staff session required.'); return this.tickets.queueDefinitions(); }
  @Post('tickets/queues/:id/tickets') async queueTickets(@Param('id') id:string,@Body() body:any,@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return this.advancedSearch.queueSearch(id, body || {}, account.staffId);
  }
  @Post('tickets/advanced-search') async advancedSearchTickets(@Body() body:any,@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return this.advancedSearch.search(body || {}, account.staffId);
  }
  @Get('tickets/search/options') async searchOptions(@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return this.advancedSearch.options(account.staffId);
  }
  @Post('tickets/search') async searchTickets(@Body() body:any,@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return this.advancedSearch.search(body || {}, account.staffId);
  }
  @Get('tickets/search/saved') async savedSearches(@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return { searches: await this.advancedSearch.listSaved(account.staffId) };
  }
  @Post('tickets/search/saved') async createSavedSearch(@Body() body:any,@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return { search: await this.advancedSearch.createSaved(body || {}, account.staffId) };
  }
  @Put('tickets/search/saved/:id') async updateSavedSearch(@Param('id') id:string,@Body() body:any,@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return { search: await this.advancedSearch.updateSaved(id, body || {}, account.staffId) };
  }
  @Delete('tickets/search/saved/:id') async deleteSavedSearch(@Param('id') id:string,@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return this.advancedSearch.deleteSaved(id, account.staffId);
  }
  @Put('tickets/search/settings') async saveSearchSettings(@Body() body:any,@Headers('x-user-session') token:string) {
    const account = await this.staffAccount(token);
    return this.advancedSearch.saveSettings(body || {}, account.staffId);
  }
  @Post('tickets') @UseInterceptors(AnyFilesInterceptor({limits:{files:5,fileSize:8*1024*1024}})) async create(@Body() body:any,@UploadedFiles() files:any[],@Req() req:any) { if(!this.security.rateLimit(req.ip,'ticket-create',12)) throw new UnauthorizedException('Too many ticket requests. Try again later.'); const data=typeof body.ticket==='string'?JSON.parse(body.ticket):body; const session=this.security.readSession(req.headers['x-user-session']); if(session){ const staff=await this.auth.validateStaff(session.email); const client=await this.auth.validateClient(session.email); const valid=this.auth.sessionAccount(staff,session,'staff')||this.auth.sessionAccount(client,session,'client')&&client!.user.email.toLowerCase()===String(data.requesterEmail||'').toLowerCase(); if(!valid) throw new UnauthorizedException('This account session is expired or does not match the requester.'); if(!staff){ data.assigneeEmail=''; data.collaborators=[]; data.fromEmail=''; } } return this.tickets.create(data,req.ip,(files||[]).map(file=>({originalname:file.originalname,mimetype:file.mimetype,buffer:file.buffer,size:file.size}))); }
  @Get('tickets/:number') async get(@Param('number') number:string, @Query('accessToken') token:string, @Query('email') email:string) {
    const result=await this.tickets.get(number);
    const tokenOk=token && result.view.accessHash && result.view.accessHash=== (await import('node:crypto')).createHash('sha256').update(token).digest('hex');
    const emailOk=email && (result.view.requesterEmail.toLowerCase()===email.toLowerCase()||result.view.collaborators.some((c:any)=>c.email.toLowerCase()===email.toLowerCase()&&c.active));
    if(!tokenOk&&!emailOk) throw new UnauthorizedException('Ticket access required.');
    const { accessHash,...ticket}=result.view;
    return {ticket,messages:ticket.messages.filter((m:any)=>!m.internal).map((message:any)=>({...message,ticketNumber:ticket.number}))};
  }
  @Get('tickets/:number/attachments/:id') async attachment(@Param('number') number:string,@Param('id') id:string,@Headers('x-user-session') sessionToken:string,@Headers('x-ticket-access') accessToken:string,@Headers('x-ticket-email') email:string,@Res() res:any) {
    const {view}=await this.tickets.get(number);
    const session=this.security.readSession(sessionToken);
    const staff=session?await this.auth.validateStaff(session.email):null;
    const client=session?await this.auth.validateClient(session.email):null;
    const staffAllowed=this.auth.sessionAccount(staff,session,'staff');
    const clientAllowed=this.auth.sessionAccount(client,session,'client')&&(client!.user.email.toLowerCase()===view.requesterEmail.toLowerCase()||view.collaborators.some((person:any)=>person.active&&person.email.toLowerCase()===client!.user.email.toLowerCase()));
    const accessAllowed=Boolean(accessToken&&view.accessHash&&(await import('node:crypto')).createHash('sha256').update(accessToken).digest('hex')===view.accessHash);
    const normalizedEmail=String(email||'').toLowerCase();
    const emailAllowed=Boolean(normalizedEmail&&(normalizedEmail===view.requesterEmail.toLowerCase()||view.collaborators.some((person:any)=>person.active&&person.email.toLowerCase()===normalizedEmail)));
    if(!staffAllowed&&!clientAllowed&&!accessAllowed&&!emailAllowed) throw new UnauthorizedException('Ticket access required.');
    const file=await this.tickets.getAttachment(number,id,Boolean(staffAllowed));
    res.setHeader('content-type',file.type);
    res.setHeader('content-disposition', 'attachment; filename="' + file.name.replace(/[^a-zA-Z0-9._ -]/g, '_') + '"');
    return res.send(file.data);
  }
  @Post('tickets/:number/replies') @UseInterceptors(AnyFilesInterceptor({limits:{files:5,fileSize:8*1024*1024}})) async reply(@Param('number') number:string,@Body() body:any,@UploadedFiles() files:any[],@Headers('x-user-session') session:string,@Headers('x-ticket-access') access:string) { const data=typeof body.reply==='string'?JSON.parse(body.reply):body; return this.tickets.reply(number,data,session,access,(files||[]).map(file=>({originalname:file.originalname,mimetype:file.mimetype,buffer:file.buffer,size:file.size}))); }
  @Patch('tickets/:number/branch') async branch(@Param('number') number:string,@Body() body:any,@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateStaff(session.email):null; if(!this.auth.sessionAccount(account,session,'staff')) throw new UnauthorizedException('Active staff session required.'); return this.tickets.setBranch(number,String(body.branchId||'')); }
  @Patch('users/tickets/:number/branch') async clientBranch(@Param('number') number:string,@Body() body:any,@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateClient(session.email):null; if(!this.auth.sessionAccount(account,session,'client')) throw new UnauthorizedException('Approved client session required.'); const {view}=await this.tickets.get(number); if(view.requesterEmail.toLowerCase()!==account!.user.email.toLowerCase()) throw new UnauthorizedException('Only the ticket requester can change this branch.'); return this.tickets.setBranch(number,String(body.branchId||'')); }
  @Patch('tickets/:number') async update(@Param('number') number:string,@Body() body:any,@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateStaff(session.email):null; if(!this.auth.sessionAccount(account,session,'staff')) throw new UnauthorizedException('Active staff session required.'); return this.tickets.update(number,body); }
  @Delete('tickets/:number') async delete(@Param('number') number:string,@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateStaff(session.email):null; if(!this.auth.sessionAccount(account,session,'staff')) throw new UnauthorizedException('Active staff session required.'); return this.tickets.delete(number); }
  @Post('tickets/:number/ban-email') async banEmail(@Param('number') number:string,@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateStaff(session.email):null; if(!this.auth.sessionAccount(account,session,'staff')) throw new UnauthorizedException('Active staff session required.'); return this.tickets.banEmail(number); }
  @Put('tickets/:number/collaborators') async collaborators(@Param('number') number:string,@Body() body:any,@Headers('x-user-session') token:string) { const session=this.security.readSession(token); const account=session?await this.auth.validateStaff(session.email):null; if(!this.auth.sessionAccount(account,session,'staff')) throw new UnauthorizedException('Active staff session required.'); return this.tickets.setCollaborators(number,body.collaborators); }
  @Get('tickets/:number/staff') async staffDetail(@Param('number') number:string,@Headers('x-user-session') token:string) { await this.staffAccount(token); return this.tickets.getForStaff(number); }
  @Post('tickets/:number/merge') async merge(@Param('number') number:string,@Body() body:any,@Headers('x-user-session') token:string) { const account=await this.staffAccount(token); return this.tickets.merge(number,String(body.secondaryNumber||body.mergeNumber||''),account.staffId,account.user.name); }
  @Post('tickets/:number/lock') async lock(@Param('number') number:string,@Headers('x-user-session') token:string) { const account=await this.staffAccount(token); return this.tickets.acquireLock(number,account.staffId); }
  @Delete('tickets/:number/lock') async unlock(@Param('number') number:string,@Headers('x-user-session') token:string) { const account=await this.staffAccount(token); return this.tickets.releaseLock(number,account.staffId,account.role==='admin'); }
  @Get('tasks') async tasks(@Headers('x-user-session') token:string) { await this.staffAccount(token); return this.tickets.listTasks(); }
  @Post('tasks') async createTask(@Body() body:any,@Headers('x-user-session') token:string) { const account=await this.staffAccount(token); return this.tickets.createTask(body||{},account.staffId); }
  @Patch('tasks/:id') async updateTask(@Param('id') id:string,@Body() body:any,@Headers('x-user-session') token:string) { await this.staffAccount(token); return this.tickets.updateTask(id,body||{}); }
}

import { Inject, Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { AdminService } from './admin.service';
import { MailService } from '../mail/mail.service';
import { UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';

@Controller()
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(AdminService) private admin: AdminService, @Inject(MailService) private mail: MailService) {}
  private check(_req:any) { }
  @Get('health') health() { return { ok: true, mailConfigured: this.mail.isConfigured(), storage: 'postgresql' }; }
  @Get('public-state') async publicState() { return { state: await this.admin.publicState() }; }
  @Get('app-state') async appState() { return { state: await this.admin.publicState() }; }
  @Put('app-state') async saveState(@Body() body:any) { await this.admin.saveState(body.state || body); return { saved: true }; }
  @Get('branches') async branches() { return { branches: await this.admin.list('branches') }; }
  @Get('help-topics') async helpTopics() { return { topics: await this.admin.list('help-topics'), departments: await this.admin.list('departments') }; }
  @Get('admin/mail-log') async mailLog(@Req() req:any) { this.check(req); return { messages: await this.mail.listLog() }; }
  @Post('admin/mail-test') async mailTest(@Req() req:any,@Body() body:any) { this.check(req); const to=String(body.to || process.env.MAIL_TEST_TO || process.env.SUPPORT_EMAIL || ''); const result=await this.mail.sendNotice(to,'osTicket React SMTP test','SMTP delivery test completed at '+new Date().toISOString()); return { sent:result.status==='sent',to }; }
  @Patch('admin/ticket-settings') async ticketSettings(@Body() body:any) { await this.admin.saveState({ ticketSettings:body }); return { saved:true }; }

  @Get('admin/departments') async departments() { return { departments:await this.admin.list('departments'),slas:[] }; }
  @Post('admin/departments') async createDepartment(@Body() body:any) { return { department:await this.admin.create('departments',body) }; }
  @Put('admin/departments') async updateDepartmentBody(@Body() body:any) { return { department:await this.admin.update('departments',String(body.id),body) }; }
  @Put('admin/departments/:id') async updateDepartment(@Param('id') id:string,@Body() body:any) { return { department:await this.admin.update('departments',id,body) }; }
  @Delete('admin/departments') removeDepartmentBody(@Body() body:any) { return this.admin.remove('departments',String(body.id)); }
  @Delete('admin/departments/:id') removeDepartment(@Param('id') id:string) { return this.admin.remove('departments',id); }

  @Get('admin/staff') async staff() { return { staff:await this.admin.list('staff'),departments:await this.admin.list('departments'),roles:[] }; }
  @Post('admin/staff') async saveStaff(@Body() body:any) { const row=body.staffId?await this.admin.update('staff',body.staffId,body):await this.admin.create('staff',body); return { saved:true,id:String(row.staff_id) }; }
  @Get('admin/users') async users() { return { users:await this.admin.list('users') }; }
  @Patch('admin/users/verification') verify(@Body() body:any) { return this.admin.updateVerification(body); }
  @Get('admin/directory-users') async directoryUsers() { return { users:await this.admin.list('directory-users') }; }
  @Post('admin/directory-users') async createDirectoryUser(@Body() body:any) { return { user:await this.admin.create('directory-users',body) }; }
  @Put('admin/directory-users') async updateDirectoryUser(@Body() body:any) { return { user:await this.admin.update('directory-users',String(body.id || ''),body) }; }
  @Put('admin/directory-users/:id') async updateDirectoryUserById(@Param('id') id:string,@Body() body:any) { return { user:await this.admin.update('directory-users',id,body) }; }

  @Get('admin/organizations') async organizations() { return { organizations:await this.admin.list('organizations') }; }
  @Post('admin/organizations') async createOrganization(@Body() body:any) { return { organization:await this.admin.create('organizations',body) }; }
  @Put('admin/organizations') async updateOrganizationBody(@Body() body:any) { return { organization:await this.admin.update('organizations',String(body.id),body) }; }
  @Put('admin/organizations/:id') async updateOrganization(@Param('id') id:string,@Body() body:any) { return { organization:await this.admin.update('organizations',id,body) }; }
  @Delete('admin/organizations/:id') removeOrganization(@Param('id') id:string) { return this.admin.remove('organizations',id); }

  @Get('admin/branches') async adminBranches() { return { branches:await this.admin.list('branches-all') }; }
  @Post('admin/branches') async createBranch(@Body() body:any) { return { branch:await this.admin.create('branches',body) }; }
  @Put('admin/branches/:id') async updateBranch(@Param('id') id:string,@Body() body:any) { return { branch:await this.admin.update('branches',id,body) }; }
  @Delete('admin/branches/:id') removeBranch(@Param('id') id:string) { return this.admin.remove('branches',id); }

  @Get('admin/help-topics') async adminTopics() { return { ...(await this.admin.options()), topics:await this.admin.list('help-topics') }; }
  @Post('admin/help-topics') async createTopic(@Body() body:any) { return { topic:await this.admin.create('help-topics',body) }; }
  @Put('admin/help-topics') async updateTopicBody(@Body() body:any) { return { topic:await this.admin.update('help-topics',String(body.id),body) }; }
  @Put('admin/help-topics/:id') async updateTopic(@Param('id') id:string,@Body() body:any) { return { topic:await this.admin.update('help-topics',id,body) }; }
  @Delete('admin/help-topics') removeTopicBody(@Body() body:any) { return this.admin.remove('help-topics',String(body.id)); }
  @Delete('admin/help-topics/:id') removeTopic(@Param('id') id:string) { return this.admin.remove('help-topics',id); }

  @Get('admin/faq-categories') async faqCategories() { return { categories:await this.admin.list('faq-categories') }; }
  @Post('admin/faq-categories') async createFaqCategory(@Body() body:any) { return { category:await this.admin.create('faq-categories',body) }; }
  @Put('admin/faq-categories/:id') async updateFaqCategory(@Param('id') id:string,@Body() body:any) { return { category:await this.admin.update('faq-categories',id,body) }; }
  @Delete('admin/faq-categories/:id') removeFaqCategory(@Param('id') id:string) { return this.admin.remove('faq-categories',id); }
  @Get('admin/faq-articles') async faqArticles() { return { articles:await this.admin.list('faq-articles') }; }
  @Post('admin/faq-articles') async createFaqArticle(@Body() body:any) { return { article:await this.admin.create('faq-articles',body) }; }
  @Put('admin/faq-articles/:id') async updateFaqArticle(@Param('id') id:string,@Body() body:any) { return { article:await this.admin.update('faq-articles',id,body) }; }
  @Delete('admin/faq-articles/:id') removeFaqArticle(@Param('id') id:string) { return this.admin.remove('faq-articles',id); }
}

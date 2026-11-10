import { Inject, BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Patch, Req, Res, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiSecurityService } from '../common/api-security.service';
import { MailService } from '../mail/mail.service';
import { createHash } from 'node:crypto';

@Controller('users')
export class UsersController {
  constructor(@Inject(AuthService) private auth: AuthService, @Inject(ApiSecurityService) private security: ApiSecurityService) {}
  @Post('login') @HttpCode(200)
  async login(@Body() body: any, @Req() req: any) {
    const email = this.security.email(body.email);
    if (!this.security.rateLimit(req.ip, 'user-login:' + email, 10)) throw new UnauthorizedException('Too many login attempts.');
    const result = await this.auth.loginClient(email, String(body.password || ''));
    if (!result.found || !result.authenticated) throw new UnauthorizedException('Invalid email or password.');
    if (result.status !== 'approved') return { found: true, status: result.status };
    return { found: true, status: result.status, user: result.user, sessionToken: this.security.issueSession(email, result.sessionVersion) };
  }
  @Post('register')
  async register(@Body() body: any) {
    const name = this.security.clean(body.name, 128), email = this.security.email(body.email), password = String(body.password || '');
    if (!name || !this.security.validEmail(email) || password.length < 8) throw new BadRequestException('Name, valid email, and password of at least 8 characters are required.');
    const regPhone = this.security.clean(body.phone, 64).replace(/\D/g, '');
    if (regPhone && !/^0[79]\d{8}$/.test(regPhone)) throw new BadRequestException('Phone number must be in the format 0909090909 or 0707070707 (10 digits starting with 09 or 07).');
    await this.auth.register({ name, email, password, phone: regPhone, employeeId: this.security.clean(body.employeeId, 64), branchId: this.security.clean(body.branchId, 32) });
    return { submitted: true, verificationStatus: 'pending' };
  }
  @Get('session')
  async session(@Headers('authorization') authorization: string, @Headers('x-user-session') token: string, @Headers('x-session-token') legacyToken: string) {
    const session = this.security.readSession(token || legacyToken || authorization?.replace(/^Bearer\s+/i, ''));
    const account = session ? await this.auth.validateClient(session.email) : null;
    if (!this.auth.sessionAccount(account, session, 'client')) throw new UnauthorizedException('Session expired.');
    return { status: account!.status, role: account!.role, user: account!.user };
  }
  @Get('profile')
  async profile(@Headers('x-user-session') token: string) { return { user: await this.auth.profileFromSession(token) }; }
  @Patch('profile')
  async updateProfile(@Body() body: any, @Headers('x-user-session') token: string, @Headers('authorization') authorization: string) {
    const session = this.security.readSession(token || authorization?.replace(/^Bearer\s+/i, ''));
    const account = session ? await this.auth.validateClient(session.email) : null;
    if (!this.auth.sessionAccount(account, session, 'client')) throw new UnauthorizedException('Session expired.');
    const phone = this.security.clean(body.phone, 64).replace(/\D/g, '');
    if (phone && !/^0[79]\d{8}$/.test(phone)) throw new BadRequestException('Phone number must be in the format 0909090909 or 0707070707 (10 digits starting with 09 or 07).');
    await this.auth.updateProfile(session!.email, { name: this.security.clean(body.name, 128), phone, org: this.security.clean(body.org, 128), title: this.security.clean(body.title, 128), avatar: typeof body.avatar === 'string' ? body.avatar : undefined });
    return { user: (await this.auth.findClient(session!.email))!.user };
  }
  @Patch('password')
  async password(@Body() body: any, @Headers('x-user-session') token: string, @Headers('authorization') authorization: string, @Res({ passthrough: true }) res: any) {
    const session = this.security.readSession(token || authorization?.replace(/^Bearer\s+/i, ''));
    const account = session ? (await this.auth.validateClient(session.email) || await this.auth.validateStaff(session.email)) : null;
    if (!account || account.status !== 'approved') throw new UnauthorizedException('Session expired.');
    if (String(body.password || '').length < 8) throw new BadRequestException('Password must be at least 8 characters.');
    await this.auth.changePassword(session!.email, body.password, body.currentPassword);
    res.setHeader('x-session-refresh-required', 'true');
    return { updated: true };
  }
}

@Controller('staff')
export class StaffController {
  constructor(@Inject(AuthService) private auth: AuthService, @Inject(ApiSecurityService) private security: ApiSecurityService) {}
  @Post('login') @HttpCode(200)
  async login(@Body() body: any, @Req() req: any) {
    const identity = this.security.clean(body.email || body.username, 254);
    if (!this.security.rateLimit(req.ip, 'staff-login:' + identity.toLowerCase(), 10)) throw new UnauthorizedException('Too many login attempts.');
    const result = await this.auth.loginStaff(identity, String(body.password || ''));
    if (!result.found || !result.authenticated) throw new UnauthorizedException(result.error || 'Invalid username or password.');
    if (result.status !== 'approved') throw new UnauthorizedException('Staff account is disabled.');
    return { user: { ...result.user, role: result.role }, sessionToken: this.security.issueSession(result.user.email, result.sessionVersion) };
  }
  @Get('session')
  async session(@Headers('x-user-session') token: string, @Headers('authorization') authorization: string) {
    const session = this.security.readSession(token || authorization?.replace(/^Bearer\s+/i, ''));
    const account = session ? await this.auth.validateStaff(session.email) : null;
    if (!this.auth.sessionAccount(account, session, 'staff')) throw new UnauthorizedException('Session expired.');
    return { status: account!.status, role: account!.role, user: account!.user };
  }
  @Patch('profile')
  async updateProfile(@Body() body: any, @Headers('x-user-session') token: string) {
    const session = this.security.readSession(token);
    const account = session ? await this.auth.validateStaff(session.email) : null;
    if (!this.auth.sessionAccount(account, session, 'staff')) throw new UnauthorizedException('Session expired.');
    const staffPhone = this.security.clean(body.phone, 64).replace(/\D/g, '');
    if (staffPhone && !/^0[79]\d{8}$/.test(staffPhone)) throw new BadRequestException('Phone number must be in the format 0909090909 or 0707070707 (10 digits starting with 09 or 07).');
    await this.auth.updateStaffProfile(session!.email, {
      name: this.security.clean(body.name, 128),
      phone: staffPhone,
      title: this.security.clean(body.title, 128),
      avatar: typeof body.avatar === 'string' ? body.avatar : undefined,
    });
    return { user: (await this.auth.findStaff(session!.email))!.user };
  }
  @Patch('password')
  async updatePassword(@Body() body: any, @Headers('x-user-session') token: string, @Headers('authorization') authorization: string) {
    const session = this.security.readSession(token || authorization?.replace(/^Bearer\s+/i, ''));
    const account = session ? await this.auth.validateStaff(session.email) : null;
    if (!account || account.status !== 'approved') throw new UnauthorizedException('Session expired.');
    if (String(body.password || '').length < 8) throw new BadRequestException('Password must be at least 8 characters.');
    await this.auth.changePassword(session!.email, body.password, body.currentPassword);
    return { updated: true };
  }
  @Get('assignable') async assignable() { return { staff: await this.auth.listAssignableStaff() }; }
  @Get('departments') async departments() { return { departments: await this.auth.listStaffDepartments(), slas: [] }; }
  @Get('ticket-options') async options() { return this.auth.ticketOptions(); }
}

@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(@Inject(AuthService) private auth: AuthService, @Inject(ApiSecurityService) private security: ApiSecurityService, @Inject(MailService) private mail: MailService) {}
  @Post('request')
  async request(@Body() body: any) {
    const email = this.security.email(body.email);
    if (this.security.validEmail(email)) {
      const token = await this.auth.requestReset(email);
      if (token) await this.mail.sendNotice(email, 'Password reset', 'Use this one-time reset token to set a new password: ' + token);
    }
    return { sent: true };
  }
  @Post('complete')
  async complete(@Body() body: any) {
    const token = String(body.token || ''), password = String(body.password || '');
    if (password.length < 8 || !token) throw new BadRequestException('A reset token and password of at least 8 characters are required.');
    const ok = await this.auth.completeReset(createHash('sha256').update(token).digest('hex'), password);
    if (!ok) throw new UnauthorizedException('Password reset token is invalid or expired.');
    return { updated: true };
  }
}

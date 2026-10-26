import { Inject, CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { ApiSecurityService } from './api-security.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AuthService) private auth: AuthService, @Inject(ApiSecurityService) private security: ApiSecurityService) {}
  async canActivate(context:ExecutionContext) {
    const req=context.switchToHttp().getRequest();
    const path=String(req.route?.path||req.path||'');
    if(path==='/health'||path==='/public-state'||path==='/branches'||path==='/help-topics') return true;
    if(this.security.authorized(req.headers['x-api-key'])) return true;
    const session=this.security.readSession(req.headers['x-user-session']);
    const account=session?await this.auth.validateStaff(session.email):null;
    if(!this.auth.sessionAccount(account,session,'staff')||account?.role!=='admin') throw new UnauthorizedException('Administrator session required.');
    return true;
  }
}

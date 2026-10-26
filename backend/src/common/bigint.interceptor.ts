import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

function serialize(value:any):any {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,serialize(item)]));
  }
  return value;
}
@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(_context:ExecutionContext,next:CallHandler):Observable<any> { return next.handle().pipe(map(serialize)); }
}

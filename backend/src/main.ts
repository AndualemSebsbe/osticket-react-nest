import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BigIntSerializerInterceptor } from './common/bigint.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' });
  app.enableShutdownHooks();
  app.useGlobalInterceptors(new BigIntSerializerInterceptor());
  const port = Number(process.env.API_PORT || 8787);
  await app.listen(port);
  console.log('NestJS API listening on http://localhost:' + port);
}

void bootstrap();

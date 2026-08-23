import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { EdgeExceptionFilter } from './common/filters/http-exception.filter';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 5000);

  app.use(helmet());
  // Trust one hop: the reverse proxy in front of this service, so throttling
  // keys on the real client rather than on the proxy address.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  // The portal calls this service from its own server. A browser never does, so
  // no origin is allowed unless one is configured explicitly.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length > 0) {
    app.enableCors({ origin: allowedOrigins, credentials: true });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new EdgeExceptionFilter());

  setupSwagger(app);

  await app.listen(port);
  Logger.log(`BFF listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();

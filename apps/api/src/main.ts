import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json } from 'express';

import { ApiModule } from './api.module';
import { WinstonLogger } from '@/shared/modules/logger/logger.service';
import { Logger } from '@/shared/utils/logger.utils';
import { addCanonicalAliases } from '@/lib/utils/response-alias.utils';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule, {
    cors: true,
    logger: new WinstonLogger(Logger),
  });

  // Increase JSON body size limit for Overture bulk imports (up to 100MB)
  app.use(json({ limit: '100mb' }));

  // Add non-breaking US-friendly aliases to JSON responses while keeping legacy keys.
  app.use((req, res, next) => {
    // Avoid mutating Swagger/OpenAPI responses.
    if (req.path.startsWith('/api')) {
      return next();
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) =>
      originalJson(addCanonicalAliases(body))) as typeof res.json;
    next();
  });

  const config = new DocumentBuilder()
    .setTitle('Mes adresses API')
    .setDescription('API for managing local address bases')
    .setVersion('2.0')
    .addBearerAuth(
      {
        description: `Please enter the authentication token`,
        name: 'Authorization',
        type: 'http',
        in: 'Header',
      },
      'admin-token',
    )
    .build();
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('v2', {
    exclude: [{ path: '', method: RequestMethod.GET }],
  });
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 5000;
  await app.listen(port, '0.0.0.0');
  console.log(`Listening on 0.0.0.0:${port}`);
}
bootstrap();

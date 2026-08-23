import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Publishes the OpenAPI document at /docs, off unless SWAGGER_ENABLED=true.
 *
 * Worth reading the description below before wiring anything against this API:
 * the two credentials are not interchangeable, and presenting one without the
 * other gets you nothing.
 */
export function setupSwagger(app: INestApplication): void {
  const config = app.get(ConfigService);

  if (config.get<string>('SWAGGER_ENABLED', 'true') !== 'true') {
    Logger.log('OpenAPI documentation is disabled', 'Swagger');
    return;
  }

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Zurich Portal — BFF')
      .setDescription(
        [
          'The only service the customer portal talks to.',
          '',
          '**Every request carries two independent credentials:**',
          '',
          '1. `x-portal-key` — proves the *caller* is our own portal server. This secret',
          '   lives in the Next.JS server process and never reaches a browser.',
          '2. `Authorization: Bearer <google-id-token>` — proves the *end user*. The token',
          '   is verified here against Google JWKS: issuer, audience and signature are',
          '   checked by this service, not taken on the frontend’s word.',
          '',
          'Either credential alone is useless. A leaked portal key buys nothing without a',
          'token Google actually signed for our client id, and a stolen Google token buys',
          'nothing without the key.',
          '',
          'Revealing an email address is audited and throttled far harder than listing.',
        ].join('\n'),
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'The Google ID token obtained by the portal at sign-in.',
        },
        'google-id-token',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'x-portal-key',
          in: 'header',
          description: 'Shared secret proving the caller is the portal server.',
        },
        'portal-key',
      )
      .addTag('users', 'The filtered directory, as the portal sees it')
      .addTag('auth', 'Session verification')
      .addTag('health', 'Liveness')
      .build(),
  );

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'Zurich Portal — BFF',
  });

  Logger.log('OpenAPI documentation available at /docs', 'Swagger');
}

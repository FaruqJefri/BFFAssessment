import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuditModule } from './audit/audit.module';
import { AuthController } from './auth/auth.controller';
import { AuthModule } from './auth/auth.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { CoreModule } from './core/core.module';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    ThrottlerModule.forRoot([
      // Named so a single endpoint can tighten its own budget without loosening
      // the default for everything else. See UsersController.revealEmail.
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'reveal', ttl: 60_000, limit: 20 },
    ]),
    AuthModule,
    AuditModule,
    CoreModule,
    UsersModule,
  ],
  controllers: [AuthController, HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}

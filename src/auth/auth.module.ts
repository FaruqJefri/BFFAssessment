import { Global, Module } from '@nestjs/common';

import { GoogleIdentityService } from './google-identity.service';
import { PortalAuthGuard } from './portal-auth.guard';

@Global()
@Module({
  providers: [GoogleIdentityService, PortalAuthGuard],
  exports: [GoogleIdentityService, PortalAuthGuard],
})
export class AuthModule {}

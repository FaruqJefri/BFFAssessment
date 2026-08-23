import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedRequest } from './portal-auth.guard';
import { PortalUser } from './google-identity.service';

/** The verified end user, as attached by PortalAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PortalUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().portalUser,
);

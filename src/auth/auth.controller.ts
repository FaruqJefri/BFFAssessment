import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { PortalUserDto } from '../users/dto/user-response.dto';
import { CurrentUser } from './current-user.decorator';
import { PortalUser } from './google-identity.service';
import { PortalAuthGuard } from './portal-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  /**
   * Lets the portal confirm that a session it holds is still backed by a token
   * this service considers valid - without the portal having to verify anything
   * itself.
   */
  @Get('me')
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth('google-id-token')
  @ApiSecurity('portal-key')
  @ApiOperation({
    summary: 'Confirm the current identity',
    description:
      'Returns the verified end user. The portal uses this to check a session is still good without doing any verification of its own.',
  })
  @ApiOkResponse({ type: PortalUserDto })
  @ApiUnauthorizedResponse({ description: 'Credentials missing or invalid.' })
  me(@CurrentUser() user: PortalUser): PortalUser {
    return user;
  }
}

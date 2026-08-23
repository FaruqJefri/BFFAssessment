import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/current-user.decorator';
import { PortalUser } from '../auth/google-identity.service';
import { PortalAuthGuard } from '../auth/portal-auth.guard';
import { ListUsersDto } from './dto/list-users.dto';
import { ErrorResponseDto, RevealedEmailDto, UsersPageDto } from './dto/user-response.dto';
import { UsersPage, UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth('google-id-token')
@ApiSecurity('portal-key')
@ApiUnauthorizedResponse({
  description: 'The portal key or the Google ID token is missing or invalid.',
  type: ErrorResponseDto,
})
@Controller('users')
@UseGuards(PortalAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users with masked emails',
    description:
      'Always filtered to first name starting "G" or last name starting "W". There is no parameter to widen it — the rule is not the browser’s to change.',
  })
  @ApiOkResponse({ type: UsersPageDto })
  list(@Query() query: ListUsersDto, @CurrentUser() user: PortalUser): Promise<UsersPage> {
    return this.users.list(query, user);
  }

  /**
   * Deliberately throttled far harder than the list endpoint. Revealing one
   * address is a normal action; revealing thirty in a minute is someone
   * harvesting the directory one click at a time.
   */
  @Get(':id/email')
  @Throttle({ reveal: { ttl: 60_000, limit: 20 } })
  @ApiOperation({
    summary: 'Reveal one email address',
    description:
      'Audited: who asked, for whom, and whether it was allowed. The address itself is deliberately absent from the audit record. Throttled to 20 per minute.',
  })
  @ApiOkResponse({ type: RevealedEmailDto })
  @ApiNotFoundResponse({
    description: 'No such user, or the user is outside the filtered set.',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ description: 'Reveal budget exhausted.' })
  revealEmail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: PortalUser,
  ): Promise<{ id: number; email: string }> {
    return this.users.revealEmail(id, user);
  }
}

import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PortalUser } from '../auth/google-identity.service';
import { CoreApiClient } from '../core/core-api.client';
import { ListUsersDto } from './dto/list-users.dto';

export interface PublicUser {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  maskedEmail: string;
  avatar: string;
}

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface UsersPage {
  data: PublicUser[];
  meta: PageMeta;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly core: CoreApiClient,
    private readonly audit: AuditService,
  ) {}

  list(query: ListUsersDto, actor: PortalUser): Promise<UsersPage> {
    // `filtered` is pinned on, not forwarded. Even a caller that manages to inject
    // the parameter upstream of here cannot widen the result set.
    return this.core.get<UsersPage>('/users', actor.email, {
      page: query.page,
      perPage: query.perPage,
      filtered: true,
    });
  }

  /**
   * Reveals one address. This is the only path by which a real email leaves the
   * platform, so it is the one place an audit entry is mandatory - written after
   * the core API authorises the read, and written again if it refuses.
   */
  async revealEmail(id: number, actor: PortalUser): Promise<{ id: number; email: string }> {
    try {
      const revealed = await this.core.get<{ id: number; email: string }>(
        `/users/${id}/email`,
        actor.email,
      );

      this.audit.record({
        action: 'user.email.reveal',
        actorId: actor.id,
        actorEmail: actor.email,
        subject: id,
        outcome: 'allowed',
      });

      return revealed;
    } catch (error) {
      this.audit.record({
        action: 'user.email.reveal',
        actorId: actor.id,
        actorEmail: actor.email,
        subject: id,
        outcome: 'denied',
      });
      throw error;
    }
  }
}

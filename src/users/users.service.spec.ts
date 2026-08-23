import { HttpException, HttpStatus } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PortalUser } from '../auth/google-identity.service';
import { CoreApiClient } from '../core/core-api.client';
import { UsersService } from './users.service';

const ACTOR: PortalUser = { id: 'google-sub-1', email: 'ada@example.com', name: 'Ada' };

function build() {
  const core = { get: jest.fn() };
  const audit = { record: jest.fn() };

  return {
    core,
    audit,
    service: new UsersService(
      core as unknown as CoreApiClient,
      audit as unknown as AuditService,
    ),
  };
}

describe('UsersService (BFF)', () => {
  describe('list', () => {
    it('pins the business filter on, whatever the caller asked for', async () => {
      const { service, core } = build();
      core.get.mockResolvedValue({ data: [], meta: {} });

      await service.list({ page: 2, perPage: 5 }, ACTOR);

      expect(core.get).toHaveBeenCalledWith('/users', ACTOR.email, {
        page: 2,
        perPage: 5,
        filtered: true,
      });
    });

    it('cannot be talked into requesting the unfiltered directory', async () => {
      const { service, core } = build();
      core.get.mockResolvedValue({ data: [], meta: {} });

      await service.list({ filtered: false } as never, ACTOR);

      expect(core.get.mock.calls[0][2]).toMatchObject({ filtered: true });
    });

    it('does not audit an ordinary listing - no address leaves the platform', async () => {
      const { service, core, audit } = build();
      core.get.mockResolvedValue({ data: [], meta: {} });

      await service.list({}, ACTOR);

      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('revealEmail', () => {
    it('returns the address the core API released', async () => {
      const { service, core } = build();
      core.get.mockResolvedValue({ id: 2, email: 'janet.weaver@reqres.in' });

      await expect(service.revealEmail(2, ACTOR)).resolves.toEqual({
        id: 2,
        email: 'janet.weaver@reqres.in',
      });
      expect(core.get).toHaveBeenCalledWith('/users/2/email', ACTOR.email);
    });

    it('records who revealed which address', async () => {
      const { service, core, audit } = build();
      core.get.mockResolvedValue({ id: 2, email: 'janet.weaver@reqres.in' });

      await service.revealEmail(2, ACTOR);

      expect(audit.record).toHaveBeenCalledWith({
        action: 'user.email.reveal',
        actorId: 'google-sub-1',
        actorEmail: 'ada@example.com',
        subject: 2,
        outcome: 'allowed',
      });
    });

    it('keeps the revealed address out of the audit trail itself', async () => {
      const { service, core, audit } = build();
      core.get.mockResolvedValue({ id: 2, email: 'janet.weaver@reqres.in' });

      await service.revealEmail(2, ACTOR);

      expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain('janet.weaver');
    });

    it('records a refused attempt and still surfaces the failure', async () => {
      const { service, core, audit } = build();
      core.get.mockRejectedValue(
        new HttpException('Resource not found', HttpStatus.NOT_FOUND),
      );

      await expect(service.revealEmail(4, ACTOR)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 4, outcome: 'denied' }),
      );
    });
  });
});

import { Injectable, Logger } from '@nestjs/common';

export interface AuditEvent {
  action: string;
  actorId: string;
  actorEmail: string;
  subject?: string | number;
  correlationId?: string;
  outcome: 'allowed' | 'denied';
}

/**
 * A structured, append-only record of who saw what.
 *
 * In a financial-services deployment this would write to an immutable sink
 * (CloudWatch, Splunk, an append-only table). Here it emits one JSON line per
 * event, which is the shape such a sink expects - the point being that the
 * decision to record is made at the layer that knows the end user, not deeper
 * down where only a service identity is visible.
 *
 * Note what is *not* recorded: the address that was revealed. The audit trail
 * proves access happened without becoming a second copy of the data.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  record(event: AuditEvent): void {
    this.logger.log(JSON.stringify({ ...event, at: new Date().toISOString() }));
  }
}

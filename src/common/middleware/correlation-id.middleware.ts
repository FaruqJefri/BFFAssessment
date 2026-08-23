import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export interface CorrelatedRequest extends Request {
  correlationId: string;
}

/**
 * Stamps every request with a correlation id and echoes it back, so one user
 * action can be traced across the portal, this service, and the core API
 * without correlating on anything that identifies a person.
 *
 * This is middleware rather than an interceptor on purpose: interceptors run
 * *after* guards, so a rejected request would come back with no id attached -
 * and a 401 with no trace is exactly the response you most want to trace.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = request.header('x-correlation-id') ?? randomUUID();

    (request as CorrelatedRequest).correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);

    next();
  }
}

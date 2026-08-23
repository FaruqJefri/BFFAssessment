import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * The last thing that touches a response before it leaves for the portal.
 *
 * Anything we did not raise deliberately collapses to a bare 500. The browser
 * learns that the request failed and nothing about why - stack frames, upstream
 * hostnames and driver messages stay in the logs where they belong.
 */
@Catch()
export class EdgeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(EdgeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { correlationId?: string }>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttp ? this.messageOf(exception) : 'Internal server error';

    if (!isHttp || status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      correlationId: request.correlationId,
    });
  }

  private messageOf(exception: HttpException): string {
    const body = exception.getResponse();

    if (typeof body === 'string') return body;

    const message = (body as { message?: string | string[] }).message ?? exception.message;
    return Array.isArray(message) ? message.join(', ') : message;
  }
}

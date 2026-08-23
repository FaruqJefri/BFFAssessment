import { ArgumentsHost, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

import { EdgeExceptionFilter } from './http-exception.filter';

describe('EdgeExceptionFilter', () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        method: 'GET',
        url: '/users/2/email',
        correlationId: 'corr-1',
      }),
    }),
  } as unknown as ArgumentsHost;

  const filter = new EdgeExceptionFilter();

  beforeEach(() => jest.clearAllMocks());

  it('preserves a deliberate status and attaches the correlation id', () => {
    filter.catch(new NotFoundException('Resource not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'Resource not found',
      correlationId: 'corr-1',
    });
  });

  it('joins validation messages', () => {
    filter.catch(new HttpException({ message: ['bad page', 'bad perPage'] }, 400), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'bad page, bad perPage' }),
    );
  });

  it('collapses an unexpected error to a bare 500', () => {
    filter.catch(new Error('connect ECONNREFUSED 10.0.0.5:5432'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      correlationId: 'corr-1',
    });
  });

  it('does not echo an upstream hostname back to the caller', () => {
    filter.catch(new Error('getaddrinfo ENOTFOUND core-api.internal'), host);

    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('core-api.internal');
  });
});

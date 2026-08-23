import { Request, Response } from 'express';

import { CorrelatedRequest, CorrelationIdMiddleware } from './correlation-id.middleware';

function run(incoming?: string): { request: CorrelatedRequest; setHeader: jest.Mock } {
  const request = {
    header: () => incoming,
  } as unknown as CorrelatedRequest;

  const setHeader = jest.fn();
  const next = jest.fn();

  new CorrelationIdMiddleware().use(
    request as Request,
    { setHeader } as unknown as Response,
    next,
  );

  expect(next).toHaveBeenCalled();
  return { request, setHeader };
}

describe('CorrelationIdMiddleware', () => {
  it('adopts an incoming correlation id so a trace spans services', () => {
    const { request, setHeader } = run('corr-from-portal');

    expect(request.correlationId).toBe('corr-from-portal');
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'corr-from-portal');
  });

  it('mints one when the caller did not supply it', () => {
    const { request } = run();

    expect(request.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('gives each request its own id', () => {
    expect(run().request.correlationId).not.toBe(run().request.correlationId);
  });

  it('echoes the id back on the response', () => {
    const { request, setHeader } = run();
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', request.correlationId);
  });
});

import { HttpService } from '@nestjs/axios';
import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';

import { CoreApiClient } from './core-api.client';

const SERVICE_KEY = 'core-service-key';

function axiosError(status: number, data?: unknown): AxiosError {
  const error = new Error(`Request failed with status ${status}`) as AxiosError;
  error.response = { status, data } as AxiosError['response'];
  return error;
}

function build(overrides: Record<string, unknown> = {}) {
  const http = { request: jest.fn(), post: jest.fn() };

  const settings: Record<string, unknown> = {
    CORE_API_SERVICE_KEY: SERVICE_KEY,
    CORE_API_URL: 'http://127.0.0.1:4000',
    CORE_API_TIMEOUT_MS: 10_000,
    ...overrides,
  };

  const config = {
    get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback),
  } as unknown as ConfigService;

  const tokenResponse = (expiresIn = 900) =>
    of({ data: { accessToken: 'core-jwt', expiresIn } });

  http.post.mockImplementation(() => tokenResponse());

  return { client: new CoreApiClient(http as unknown as HttpService, config), http };
}

describe('CoreApiClient', () => {
  afterEach(() => jest.useRealTimers());

  it('refuses to start without a service key', () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    expect(() => new CoreApiClient({} as HttpService, config)).toThrow(
      'CORE_API_SERVICE_KEY is not configured',
    );
  });

  it('exchanges the service key for a token and calls the core API with it', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(of({ data: { data: [], meta: {} } }));

    await client.get('/users', 'ada@example.com', { page: 1 });

    expect(http.post).toHaveBeenCalledWith(
      '/auth/token',
      { email: 'ada@example.com' },
      expect.objectContaining({ headers: { 'x-api-key': SERVICE_KEY } }),
    );
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/users',
        params: { page: 1 },
        headers: { Authorization: 'Bearer core-jwt' },
      }),
    );
  });

  it('reuses a cached token across calls', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(of({ data: {} }));

    await client.get('/users', 'ada@example.com');
    await client.get('/users', 'ada@example.com');

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('collapses a concurrent burst into a single token exchange', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(of({ data: {} }));

    await Promise.all([
      client.get('/users', 'ada@example.com'),
      client.get('/users', 'ada@example.com'),
      client.get('/users', 'ada@example.com'),
    ]);

    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('re-exchanges once the cached token is close to expiry', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(of({ data: {} }));
    // 40s lifetime minus the 30s skew leaves a 10s usable window.
    http.post.mockReturnValue(of({ data: { accessToken: 'core-jwt', expiresIn: 40 } }));

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    await client.get('/users', 'ada@example.com');

    jest.spyOn(Date, 'now').mockReturnValue(now + 11_000);
    await client.get('/users', 'ada@example.com');

    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('retries exactly once when the core API rejects our service token', async () => {
    const { client, http } = build();
    http.request
      .mockReturnValueOnce(throwError(() => axiosError(HttpStatus.UNAUTHORIZED)))
      .mockReturnValueOnce(of({ data: { ok: true } }));

    await expect(client.get('/users', 'ada@example.com')).resolves.toEqual({ ok: true });
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second consecutive rejection rather than looping', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(throwError(() => axiosError(HttpStatus.UNAUTHORIZED)));

    await expect(client.get('/users', 'ada@example.com')).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
    });
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('preserves a 404 so a missing user stays a missing user', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(throwError(() => axiosError(HttpStatus.NOT_FOUND)));

    await expect(client.get('/users/4/email', 'ada@example.com')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      message: 'Resource not found',
    });
  });

  it('passes a 400 message through so validation feedback survives', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(
      throwError(() =>
        axiosError(HttpStatus.BAD_REQUEST, { message: 'page must be an integer' }),
      ),
    );

    await expect(client.get('/users', 'ada@example.com')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      message: 'page must be an integer',
    });
  });

  it('flattens an upstream 500 into a bad gateway with no internal detail', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(
      throwError(() => axiosError(500, { message: 'ECONNREFUSED 10.0.0.5:5432' })),
    );

    await expect(client.get('/users', 'ada@example.com')).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      message: 'Core services are unavailable',
    });
  });

  it('reports the core API as unavailable when the token exchange itself fails', async () => {
    const { client, http } = build();
    http.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

    await expect(client.get('/users', 'ada@example.com')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  it('never puts the service key on a data request', async () => {
    const { client, http } = build();
    http.request.mockReturnValue(of({ data: {} }));

    await client.get('/users', 'ada@example.com');

    expect(JSON.stringify(http.request.mock.calls[0][0])).not.toContain(SERVICE_KEY);
  });
});

import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';

interface CachedToken {
  value: string;
  /** Epoch millis after which the token is treated as spent. */
  expiresAt: number;
}

/** Refresh this far ahead of real expiry so a request never races the clock. */
const EXPIRY_SKEW_MS = 30_000;

/**
 * The only component that knows how to reach the core API, and the only one
 * holding its service credential. Nothing downstream of here - and certainly
 * nothing in a browser - ever sees `CORE_API_SERVICE_KEY`.
 *
 * Tokens are cached until shortly before they expire, and a concurrent burst of
 * requests shares a single in-flight exchange rather than each minting its own.
 */
@Injectable()
export class CoreApiClient {
  private readonly logger = new Logger(CoreApiClient.name);
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly timeoutMs: number;

  private token?: CachedToken;
  private inFlight?: Promise<string>;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    const serviceKey = config.get<string>('CORE_API_SERVICE_KEY');
    if (!serviceKey) {
      throw new Error('CORE_API_SERVICE_KEY is not configured');
    }

    this.baseUrl = config.get<string>('CORE_API_URL', 'http://127.0.0.1:4000');
    this.serviceKey = serviceKey;
    this.timeoutMs = Number(config.get('CORE_API_TIMEOUT_MS', 10_000));
  }

  async get<T>(path: string, actingFor: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>({ method: 'GET', url: path, params }, actingFor);
  }

  private async request<T>(options: AxiosRequestConfig, actingFor: string): Promise<T> {
    const send = async (token: string): Promise<T> => {
      const response = await firstValueFrom(
        this.http.request<T>({
          baseURL: this.baseUrl,
          timeout: this.timeoutMs,
          ...options,
          headers: { ...options.headers, Authorization: `Bearer ${token}` },
        }),
      );
      return response.data;
    };

    try {
      return await send(await this.accessToken(actingFor));
    } catch (error) {
      // A 401 here means our own service token went stale, not that the end user
      // is unauthorised. Drop it and retry exactly once before giving up.
      if (this.isStatus(error, HttpStatus.UNAUTHORIZED)) {
        this.token = undefined;
        try {
          return await send(await this.accessToken(actingFor));
        } catch (retryError) {
          throw this.translate(retryError);
        }
      }
      throw this.translate(error);
    }
  }

  private async accessToken(actingFor: string): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }

    // Collapse a burst into one exchange.
    this.inFlight ??= this.exchange(actingFor).finally(() => {
      this.inFlight = undefined;
    });

    return this.inFlight;
  }

  private async exchange(actingFor: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ accessToken: string; expiresIn: number }>(
          '/auth/token',
          { email: actingFor },
          {
            baseURL: this.baseUrl,
            timeout: this.timeoutMs,
            headers: { 'x-api-key': this.serviceKey },
          },
        ),
      );

      const { accessToken, expiresIn } = response.data;
      this.token = {
        value: accessToken,
        expiresAt: Date.now() + Math.max(expiresIn * 1000 - EXPIRY_SKEW_MS, 0),
      };

      return accessToken;
    } catch (error) {
      this.logger.error(
        `Core API token exchange failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('Core services are unavailable');
    }
  }

  private isStatus(error: unknown, status: number): boolean {
    return (error as AxiosError)?.response?.status === status;
  }

  /**
   * Turns an upstream failure into an edge-safe HttpException. A 4xx that is
   * meaningful to the caller (404, 400) is preserved; anything else becomes a
   * flat 502 so upstream internals are not described to the browser.
   */
  private translate(error: unknown): HttpException {
    // Something we raised deliberately - a failed token exchange, say - already
    // carries the status we meant. Re-wrapping it would lose that.
    if (error instanceof HttpException) {
      return error;
    }

    const response = (error as AxiosError)?.response;
    const status = response?.status;

    if (status === HttpStatus.NOT_FOUND) {
      return new HttpException('Resource not found', HttpStatus.NOT_FOUND);
    }

    if (status === HttpStatus.BAD_REQUEST) {
      const body = response?.data as { message?: string } | undefined;
      return new HttpException(body?.message ?? 'Invalid request', HttpStatus.BAD_REQUEST);
    }

    this.logger.error(
      `Core API call failed with status ${status ?? 'none'}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return new HttpException('Core services are unavailable', HttpStatus.BAD_GATEWAY);
  }
}

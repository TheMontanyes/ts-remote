import {
  HttpAdapter,
  HttpError,
  HttpInternalRequestConfig,
  HttpRequestConfig,
  HttpResponse,
} from './lib/models';
import { FetchInterceptorManager } from './fetch-interceptor-manager';

const DEFAULT_VALIDATE_STATUS = (status: number): boolean => status >= 200 && status < 300;

/**
 * HTTP adapter built on top of the platform `fetch` — no axios, no external deps.
 *
 * Mirrors the axios-based adapter used in production while keeping the example
 * self-contained.
 */
export class FetchHttpAdapter implements HttpAdapter {
  public readonly interceptorManager: FetchInterceptorManager;

  constructor(
    private readonly baseURL: string = '',
    interceptorManager?: FetchInterceptorManager,
  ) {
    this.interceptorManager = interceptorManager ?? new FetchInterceptorManager();
  }

  getUri(config?: HttpRequestConfig): string {
    const url = config?.url ?? '';
    const base = config?.baseURL ?? this.baseURL;
    return new URL(url, base || undefined).toString();
  }

  async request<T = unknown, R = HttpResponse<T>, D = unknown>(
    config: HttpRequestConfig<D>,
  ): Promise<R> {
    const internalConfig: HttpInternalRequestConfig<D> = {
      ...config,
      headers: config.headers ?? new Headers(),
      validateStatus: config.validateStatus ?? DEFAULT_VALIDATE_STATUS,
    };

    const finalConfig = await this.interceptorManager.applyRequest(
      internalConfig as HttpInternalRequestConfig,
    );

    const uri = this.getUri(finalConfig);

    const init: RequestInit = {
      method: finalConfig.method ?? 'GET',
      headers: finalConfig.headers,
      signal: finalConfig.signal,
      credentials: finalConfig.withCredentials ? 'include' : 'same-origin',
    };

    if (finalConfig.data !== undefined && init.method !== 'GET' && init.method !== 'HEAD') {
      init.body = JSON.stringify(finalConfig.data);
    }

    const res = await fetch(uri, init);
    const data = (await this.parseBody(res, finalConfig.responseType)) as T;

    const response: HttpResponse<T, D> = {
      data,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      config: finalConfig as HttpInternalRequestConfig<D>,
    };

    if (!finalConfig.validateStatus(res.status)) {
      throw new HttpError<T>(
        `Request failed with status ${res.status}`,
        res.status,
        finalConfig as HttpInternalRequestConfig<T>,
        response as HttpResponse<T>,
      );
    }

    const finalResponse = await this.interceptorManager.applyResponse(response as HttpResponse);
    return finalResponse as R;
  }

  options<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, method: 'OPTIONS' });
  }

  get<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, method: 'GET' });
  }

  head<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, method: 'HEAD' });
  }

  patch<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, data, method: 'PATCH' });
  }

  post<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, data, method: 'POST' });
  }

  put<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, data, method: 'PUT' });
  }

  delete<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, method: 'DELETE' });
  }

  patchForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, data, method: 'PATCH' });
  }

  postForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, data, method: 'POST' });
  }

  putForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, url, data, method: 'PUT' });
  }

  isHttpError<T = unknown>(error: unknown): error is HttpError<T> {
    return error instanceof HttpError;
  }

  private async parseBody(
    res: Response,
    responseType?: HttpRequestConfig['responseType'],
  ): Promise<unknown> {
    switch (responseType) {
      case 'text':
        return res.text();
      case 'blob':
        return res.blob();
      case 'arraybuffer':
        return res.arrayBuffer();
      case 'formdata':
        return res.formData();
      case 'json':
      default:
        return res.status === 204 ? null : res.json();
    }
  }
}

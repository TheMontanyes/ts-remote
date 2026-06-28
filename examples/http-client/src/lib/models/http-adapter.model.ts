import { HttpError } from './http-error.model';
import { HttpRequestConfig } from './http-request-config.model';
import { HttpResponse } from './http-response.model';
import type { HttpInterceptorManager } from './http-interceptor-manager.model';

export interface HttpAdapter {
  interceptorManager: HttpInterceptorManager;
  request<T = unknown, R = HttpResponse<T>, D = unknown>(config: HttpRequestConfig<D>): Promise<R>;
  options<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R>;
  get<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R>;
  getUri(config?: HttpRequestConfig): string;
  head<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R>;
  patch<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R>;
  post<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R>;
  put<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R>;
  delete<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R>;
  patchForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R>;
  postForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R>;
  putForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R>;
  isHttpError<T = unknown>(error: unknown): error is HttpError<T>;
}

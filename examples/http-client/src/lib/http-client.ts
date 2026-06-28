import {
  HttpAdapter,
  HttpRequestConfig,
  HttpResponse,
  HttpError,
  HttpInterceptorManager,
} from './models';
import { RequestAbortController } from './request-abort-controller';

class HttpClient {
  private readonly abortController = new RequestAbortController();
  public readonly interceptorManager: HttpInterceptorManager;

  constructor(private readonly httpAdapter: HttpAdapter) {
    this.interceptorManager = this.httpAdapter.interceptorManager;
    this.setupAbortController();
  }

  private setupAbortController(): void {
    this.httpAdapter.interceptorManager.registerRequestInterceptor({
      onFulfilled: (config) => {
        config.signal = this.abortController.createSignal();
        return config;
      },
    });
  }

  abortAll(reason?: unknown): void {
    this.abortController.abortAll(reason);
  }

  abortLast(reason?: unknown): void {
    this.abortController.abortLast(reason);
  }

  abortFirst(reason?: unknown): void {
    this.abortController.abortFirst(reason);
  }

  abortSelected(numberRequest: number, reason?: unknown): void {
    this.abortController.abortSelected(numberRequest, reason);
  }

  request<T = unknown, R = HttpResponse<T>, D = unknown>(config: HttpRequestConfig<D>): Promise<R> {
    return this.httpAdapter.request(config);
  }

  options<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.httpAdapter.options(url, config);
  }

  get<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.httpAdapter.get(url, config);
  }

  getUri(config?: HttpRequestConfig): string {
    return this.httpAdapter.getUri(config);
  }

  head<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.httpAdapter.head(url, config);
  }

  patch<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.httpAdapter.patch(url, data, config);
  }

  post<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.httpAdapter.post(url, data, config);
  }

  put<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data?: D,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.httpAdapter.put(url, data, config);
  }

  delete<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    config?: HttpRequestConfig<D>,
  ): Promise<R> {
    return this.httpAdapter.delete(url, config);
  }

  patchForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R> {
    return this.httpAdapter.patchForm(url, data, config);
  }

  postForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R> {
    return this.httpAdapter.postForm(url, data, config);
  }

  putForm<T = unknown, R = HttpResponse<T>, D = unknown>(
    url: string,
    data: D | undefined,
    config?: HttpRequestConfig<D> | undefined,
  ): Promise<R> {
    return this.httpAdapter.putForm(url, data, config);
  }

  isHttpError<T = unknown>(error: unknown): error is HttpError<T> {
    return this.httpAdapter.isHttpError(error);
  }
}

export { HttpClient };

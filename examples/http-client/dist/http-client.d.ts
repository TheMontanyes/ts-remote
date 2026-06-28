declare module "@infra/http" {
  interface HttpRequestConfig<Data = unknown> {
    url?: string;
    method?: string;
    baseURL?: string;
    data?: Data;
    params?: Record<string, unknown>;
    headers?: Headers;
    timeout?: number;
    signal?: AbortSignal;
    responseType?:
      | "json"
      | "text"
      | "blob"
      | "arraybuffer"
      | "document"
      | "stream"
      | "formdata";
    withCredentials?: boolean;
    maxRedirects?: number;
    validateStatus?: (status: number) => boolean;
  }
  interface HttpInternalRequestConfig<
    Data = unknown,
  > extends HttpRequestConfig<Data> {
    headers: Headers;
    validateStatus: (status: number) => boolean;
  }
  interface HttpResponse<T = unknown, D = unknown> {
    data: T;
    status: number;
    statusText: string;
    headers: Headers;
    config: HttpInternalRequestConfig<D>;
  }
  class HttpError<T = unknown> extends Error {
    readonly status?: number | undefined;
    readonly config?: HttpInternalRequestConfig<T> | undefined;
    readonly response?: HttpResponse<T> | undefined;
    constructor(
      message?: string,
      status?: number | undefined,
      config?: HttpInternalRequestConfig<T> | undefined,
      response?: HttpResponse<T> | undefined,
    );
  }
  interface FulfilledCallback<T> {
    (value: T): T | Promise<T>;
  }
  interface RejectedCallback<E = HttpError> {
    (error: E): E | Promise<E>;
  }
  type UseInterceptorParams<V> = {
    onFulfilled?: FulfilledCallback<V>;
    onRejected?: RejectedCallback;
  };
  interface UseInterceptor<V> {
    (cbs: UseInterceptorParams<V>): InterceptorId;
  }
  type InterceptorId = number;
  interface HttpInterceptorManager {
    registerRequestInterceptor: UseInterceptor<HttpInternalRequestConfig>;
    registerResponseInterceptor: UseInterceptor<HttpResponse>;
    unregisterRequestInterceptor(interceptorId: InterceptorId): void;
    unregisterResponseInterceptor(interceptorId: InterceptorId): void;
    unregisterAllResponseInterceptor(): void;
    unregisterAllRequestInterceptor(): void;
  }
  interface HttpAdapter {
    interceptorManager: HttpInterceptorManager;
    request<T = unknown, R = HttpResponse<T>, D = unknown>(
      config: HttpRequestConfig<D>,
    ): Promise<R>;
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
  class HttpClient {
    readonly interceptorManager: HttpInterceptorManager;
    constructor(httpAdapter: HttpAdapter);
    abortAll(reason?: unknown): void;
    abortLast(reason?: unknown): void;
    abortFirst(reason?: unknown): void;
    abortSelected(numberRequest: number, reason?: unknown): void;
    request<T = unknown, R = HttpResponse<T>, D = unknown>(
      config: HttpRequestConfig<D>,
    ): Promise<R>;
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
  class HttpClientFactory {
    static create(adapter?: HttpAdapter): HttpClient;
    static createWithBaseURL(baseURL: string): HttpClient;
  }
  /**
   * Ready-to-use HTTP client instance backed by the `fetch` adapter.
   */
  const http: HttpClient;
  export {
    HttpClient,
    HttpClientFactory,
    http,
    HttpResponse,
    HttpError,
    HttpRequestConfig,
    HttpInternalRequestConfig,
    HttpAdapter,
  };
}

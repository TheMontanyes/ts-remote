import {
  HttpInterceptorManager,
  HttpInternalRequestConfig,
  HttpResponse,
  InterceptorId,
  UseInterceptorParams,
} from './lib/models';

type Interceptor<V> = UseInterceptorParams<V>;

/**
 * Minimal interceptor manager backed by plain arrays — no external library.
 */
export class FetchInterceptorManager implements HttpInterceptorManager {
  private requestInterceptors = new Map<InterceptorId, Interceptor<HttpInternalRequestConfig>>();
  private responseInterceptors = new Map<InterceptorId, Interceptor<HttpResponse>>();
  private nextId = 1;

  registerRequestInterceptor = (cbs: Interceptor<HttpInternalRequestConfig>): InterceptorId => {
    const id = this.nextId++;
    this.requestInterceptors.set(id, cbs);
    return id;
  };

  registerResponseInterceptor = (cbs: Interceptor<HttpResponse>): InterceptorId => {
    const id = this.nextId++;
    this.responseInterceptors.set(id, cbs);
    return id;
  };

  unregisterRequestInterceptor(interceptorId: InterceptorId): void {
    this.requestInterceptors.delete(interceptorId);
  }

  unregisterResponseInterceptor(interceptorId: InterceptorId): void {
    this.responseInterceptors.delete(interceptorId);
  }

  unregisterAllRequestInterceptor(): void {
    this.requestInterceptors.clear();
  }

  unregisterAllResponseInterceptor(): void {
    this.responseInterceptors.clear();
  }

  async applyRequest(config: HttpInternalRequestConfig): Promise<HttpInternalRequestConfig> {
    let result = config;
    for (const { onFulfilled } of this.requestInterceptors.values()) {
      if (onFulfilled) {
        result = (await onFulfilled(result)) as HttpInternalRequestConfig;
      }
    }
    return result;
  }

  async applyResponse(response: HttpResponse): Promise<HttpResponse> {
    let result = response;
    for (const { onFulfilled } of this.responseInterceptors.values()) {
      if (onFulfilled) {
        result = (await onFulfilled(result)) as HttpResponse;
      }
    }
    return result;
  }
}

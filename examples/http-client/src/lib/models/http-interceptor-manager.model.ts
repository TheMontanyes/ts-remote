import { HttpError } from './http-error.model';
import { HttpInternalRequestConfig } from './http-request-config.model';
import { HttpResponse } from './http-response.model';

export interface FulfilledCallback<T> {
  (value: T): T | Promise<T>;
}

export interface RejectedCallback<E = HttpError> {
  (error: E): E | Promise<E>;
}

export type UseInterceptorParams<V> = {
  onFulfilled?: FulfilledCallback<V>;
  onRejected?: RejectedCallback;
};

export interface UseInterceptor<V> {
  (cbs: UseInterceptorParams<V>): InterceptorId;
}

export type InterceptorId = number;

export interface HttpInterceptorManager {
  registerRequestInterceptor: UseInterceptor<HttpInternalRequestConfig>;
  registerResponseInterceptor: UseInterceptor<HttpResponse>;
  unregisterRequestInterceptor(interceptorId: InterceptorId): void;
  unregisterResponseInterceptor(interceptorId: InterceptorId): void;
  unregisterAllResponseInterceptor(): void;
  unregisterAllRequestInterceptor(): void;
}

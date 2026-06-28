import { HttpInternalRequestConfig } from './http-request-config.model';

export interface HttpResponse<T = unknown, D = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: HttpInternalRequestConfig<D>;
}
